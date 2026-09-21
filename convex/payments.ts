/**
 * V8-side queries and mutations for the payments table.
 *
 * Live in their own file because `stripe.ts` is a `"use node"` action module
 * and can't host `internalQuery`/`internalMutation` definitions.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { appendAuditEvent } from "./_util/audit";
import { requireRestaurantManagerOrAbove } from "./_util/auth";
import { raiseOperatorAlert } from "./_util/operatorAlerts";
import {
	AUDIT_EVENT,
	AUDIT_SYSTEM_USER_ID,
	OPERATOR_ALERT_KIND,
	OPERATOR_ALERT_SEVERITY,
	ORDER_PAYMENT_RECONCILE_MIN_AGE_MS,
	PAYMENT_KIND,
	PAYMENT_REFUND_STATUS,
	PAYMENT_STATUS,
	TABLE,
} from "./constants";
import { formatMoneyCents } from "./_shared/money";
import { hasFeeBreakdown, paymentMoneyBreakdown } from "./paymentMoneyHelpers";
import { stuckPaymentReconcileAges, stuckPaymentSweepKind } from "./paymentReconcileHelpers";

/**
 * Internal export query: returns denormalized payment rows whose bucketing
 * timestamp falls in the given calendar year. Bucketing uses `succeededAt`
 * when present (the cleanest "this payment cleared on day X" signal); rows
 * without a `succeededAt` fall back to `createdAt`.
 *
 * The action that calls this query is responsible for translating timestamps
 * into the restaurant's local month index.
 */
export const internalListPaymentsForExportYear = internalQuery({
	args: {
		actingUserId: v.string(),
		restaurantId: v.id(TABLE.RESTAURANTS),
		yearStartMs: v.number(),
		yearEndMs: v.number(),
	},
	handler: async (ctx, args) => {
		const [, aerr] = await requireRestaurantManagerOrAbove(
			ctx,
			args.actingUserId,
			args.restaurantId
		);
		if (aerr) throw new Error("Unauthorized");

		const payments = await ctx.db
			.query(TABLE.PAYMENTS)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();

		// Pad bucketing window by 36h so rows near a timezone-boundary midnight
		// still flow through; the action does the precise tz-aware month bucketing.
		const PAD_MS = 36 * 60 * 60 * 1000;
		const lowerBound = args.yearStartMs - PAD_MS;
		const upperBound = args.yearEndMs + PAD_MS;

		const filtered = payments.filter((p) => {
			const bucketingMs = p.succeededAt ?? p.createdAt;
			return bucketingMs >= lowerBound && bucketingMs <= upperBound;
		});

		const tableNumberCache = new Map<Id<"tables">, number>();
		const orderCache = new Map<
			Id<"orders">,
			{ tableId: Id<"tables"> | null; dailyOrderNumber: number | null }
		>();

		const denormRows = await Promise.all(
			filtered.map(async (payment) => {
				// Tab (session-level) payments have no single order behind them.
				let orderInfo: { tableId: Id<"tables"> | null; dailyOrderNumber: number | null } = {
					tableId: null,
					dailyOrderNumber: null,
				};
				if (payment.orderId) {
					const cached = orderCache.get(payment.orderId);
					if (cached) {
						orderInfo = cached;
					} else {
						const order = await ctx.db.get(payment.orderId);
						orderInfo = {
							tableId: order?.tableId ?? null,
							dailyOrderNumber: order?.dailyOrderNumber ?? null,
						};
						orderCache.set(payment.orderId, orderInfo);
					}
				}

				let tableNumber: number | null = null;
				if (orderInfo.tableId) {
					if (tableNumberCache.has(orderInfo.tableId)) {
						tableNumber = tableNumberCache.get(orderInfo.tableId) ?? null;
					} else {
						const table = await ctx.db.get(orderInfo.tableId);
						if (table) {
							tableNumber = table.tableNumber;
							tableNumberCache.set(orderInfo.tableId, tableNumber);
						}
					}
				}

				// ADR 008 split, so the export can reconcile what the diner paid
				// against what the restaurant received. `subtotalCents` /
				// `serviceFeeCents` / `netToRestaurantCents` are null on legacy
				// (pre-pivot) rows, which never recorded the fee.
				const money = paymentMoneyBreakdown(payment);
				const hasSplit = hasFeeBreakdown(payment);

				return {
					id: payment._id as string,
					orderId: (payment.orderId as string | undefined) ?? "",
					sessionId: (payment.sessionId as string | undefined) ?? "",
					dailyOrderNumber: orderInfo.dailyOrderNumber,
					tableNumber,
					kind: payment.kind ?? "",
					status: payment.status,
					refundStatus: payment.refundStatus,
					attemptNumber: payment.attemptNumber,
					amountCents: payment.amount,
					subtotalCents: hasSplit ? money.restaurantRevenue : null,
					serviceFeeCents: money.serviceFee,
					netToRestaurantCents: money.netToRestaurant,
					gratuityCents: payment.gratuityAmount ?? null,
					currency: payment.currency,
					succeededAt: payment.succeededAt ?? null,
					failedAt: payment.failedAt ?? null,
					refundRequestedAt: payment.refundRequestedAt ?? null,
					refundedAt: payment.refundedAt ?? null,
					createdAt: payment.createdAt,
					stripePaymentIntentId: payment.stripePaymentIntentId ?? "",
					stripeChargeId: payment.stripeChargeId ?? "",
					stripeRefundId: payment.stripeRefundId ?? "",
					failureCode: payment.failureCode ?? "",
					failureMessage: payment.failureMessage ?? "",
				};
			})
		);

		return denormRows;
	},
});

// ============================================================================
// Post-visit tips (ADR 008, TAVLI-71 Phase 3B)
// ============================================================================

/**
 * The saved card for one-tap charges: the payment method persisted by the
 * member's latest succeeded pay-at-submit charge in this session
 * (`setup_future_usage: "off_session"` attached it to their platform-level
 * Stripe Customer). Kind-"order" payments carry `orderId` (not `sessionId`),
 * so the lookup walks the session's orders.
 *
 * Read by `stripe.createTipCharge` to try the one-tap path before falling back
 * to Elements.
 */
export const getSavedCardForSessionMemberInternal = internalQuery({
	args: {
		sessionId: v.id(TABLE.SESSIONS),
		userId: v.string(),
	},
	returns: v.union(v.string(), v.null()),
	handler: async (ctx, args): Promise<string | null> => {
		const orders = await ctx.db
			.query(TABLE.ORDERS)
			.withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
			.collect();

		let best: { paidAt: number; paymentMethodId: string } | null = null;
		for (const order of orders) {
			if (order.paidByUserId !== args.userId || !order.activePaymentId) continue;
			const payment = await ctx.db.get(order.activePaymentId);
			if (
				payment?.status === PAYMENT_STATUS.SUCCEEDED &&
				payment.kind === PAYMENT_KIND.ORDER &&
				payment.stripePaymentMethodId
			) {
				const paidAt = payment.succeededAt ?? payment.createdAt;
				if (!best || paidAt > best.paidAt) {
					best = { paidAt, paymentMethodId: payment.stripePaymentMethodId };
				}
			}
		}
		return best?.paymentMethodId ?? null;
	},
});

/**
 * The caller's in-flight tip payment for a session, if any — the double-submit
 * guard for `stripe.createTipCharge`. Multiple tips per member are allowed
 * (re-tipping), but only one may be pending/processing at a time; a fresh call
 * while one is in flight reuses it instead of charging twice.
 */
export const getActiveTipPaymentInternal = internalQuery({
	args: {
		sessionId: v.id(TABLE.SESSIONS),
		userId: v.string(),
	},
	handler: async (ctx, args): Promise<Doc<"payments"> | null> => {
		const payments = await ctx.db
			.query(TABLE.PAYMENTS)
			.withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
			.collect();

		let latest: Doc<"payments"> | null = null;
		for (const payment of payments) {
			if (payment.kind !== PAYMENT_KIND.TIP) continue;
			if (payment.paidByUserId !== args.userId) continue;
			if (
				payment.status !== PAYMENT_STATUS.PENDING &&
				payment.status !== PAYMENT_STATUS.PROCESSING
			) {
				continue;
			}
			if (!latest || payment.createdAt > latest.createdAt) latest = payment;
		}
		return latest;
	},
});

/**
 * Candidates for the stuck-payment sweep (TAVLI-106): order and tip payments
 * left in `processing` because the confirming webhook never arrived.
 *
 * **One indexed range, no scan.** `by_status_updated` is `(status, updatedAt)`,
 * so `eq(processing).lt(updatedAt, cutoff)` is a single contiguous range, read
 * oldest-first and capped by `take(limit)`.
 *
 * **Two different ages, on purpose.**
 * - The RANGE uses `updatedAt`, because every patch to a payment row bumps it
 *   (`stripeHelpers.updatePayment` does it even for a status-preserving write).
 *   So the bound means "untouched for N minutes" — which is precisely the
 *   symptom of a dropped webhook, and a better trigger than true age: a row
 *   that is still being written to is a row something is still handling.
 * - The per-kind MINIMUM is applied here too, against `updatedAt`, for the same
 *   reason. The range itself can only carry one cutoff, so it uses the shortest
 *   of the per-kind minimums (an order's five minutes) and tips are held back
 *   to their own thirty in code. The alternative — a second index range per
 *   kind — buys nothing: the age bound is what keeps the read small, and both
 *   ranges would overlap almost entirely.
 * - TRUE age, from `createdAt`, is the sweep's business rather than this
 *   query's: `stripe.reconcileStuckPayments` computes it off the returned rows
 *   to decide when a straggler becomes an operator alert. That one has to be
 *   `createdAt` — a late `stripeChargeId` write must not buy a stuck payment
 *   another fifteen minutes of silence.
 *
 * Two kinds of row are dropped after the read rather than before it:
 * - **Legacy tab payments** (no `kind`, `sessionId` set) — `reconcileStuck`
 *   `TabPayments` owns those, because settling one must also unlock the
 *   session. See `stuckPaymentSweepKind` for the full discriminator.
 * - **Rows with no `stripePaymentIntentId`** — there is nothing to retrieve
 *   from Stripe. A `processing` row always has one (`attachIntentToPayment` is
 *   what moves a row into `processing`), so this is a belt-and-braces guard
 *   rather than an expected case.
 *
 * Filtering after the `take` means the batch bound counts rows read, not rows
 * returned, which is the bound that actually matters for the query's cost.
 */
export const listStuckPayments = internalQuery({
	args: {
		/** The sweep's clock, passed in so the query stays a pure function of it. */
		now: v.number(),
		limit: v.number(),
	},
	handler: async (ctx, args): Promise<Doc<"payments">[]> => {
		const rows = await ctx.db
			.query(TABLE.PAYMENTS)
			.withIndex("by_status_updated", (q) =>
				q
					.eq("status", PAYMENT_STATUS.PROCESSING)
					.lt("updatedAt", args.now - ORDER_PAYMENT_RECONCILE_MIN_AGE_MS)
			)
			.take(args.limit);

		return rows.filter((payment) => {
			if (!payment.stripePaymentIntentId) return false;
			const kind = stuckPaymentSweepKind(payment);
			if (kind === null) return false;
			return args.now - payment.updatedAt >= stuckPaymentReconcileAges(kind).minAgeMs;
		});
	},
});

/**
 * Webhook half of the post-visit tip path (`payment_intent.succeeded`, kind
 * "tip" — see `_util/stripe.ts`). Marks the payment succeeded and records the
 * `sessions.tipPaid` audit event.
 *
 * Deliberately does NOT close the session (the diner does that from the
 * close-out screen, and may add another tip first) and does NOT touch
 * `session.tipAmount` — that field belongs to the legacy tab settlement;
 * per-member tips live on their `payments` rows and are aggregated into the
 * tip pool from there (`convex/tips.ts`).
 *
 * Idempotent: a replayed event finds the payment already succeeded and
 * returns without a second audit event.
 */
export const confirmTipPayment = internalMutation({
	args: {
		paymentId: v.id(TABLE.PAYMENTS),
		stripePaymentIntentId: v.string(),
		stripeChargeId: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const payment = await ctx.db.get(args.paymentId);
		if (!payment) throw new Error(`Payment ${args.paymentId} not found`);
		if (payment.kind !== PAYMENT_KIND.TIP || !payment.sessionId) {
			throw new Error(`Payment ${args.paymentId} is not a tip payment`);
		}

		// Idempotent replay: the money is already recorded.
		if (payment.status === PAYMENT_STATUS.SUCCEEDED) return;

		// A RETIRED attempt is never credited (TAVLI-104 review round 2). This row
		// was superseded or cancelled — the member's tip was charged by the attempt
		// that replaced it — and settling it here would credit the server twice
		// off one gesture, with both rows booking into the tip pool. The charge is
		// real, so it is not ignored: `handlePaymentIntentSuccess` routes a retired
		// tip row to `refundRetiredTipCharge` instead, which sends it back.
		if (
			payment.status === PAYMENT_STATUS.SUPERSEDED ||
			payment.status === PAYMENT_STATUS.CANCELLED
		) {
			console.error("[payments.confirmTipPayment] REFUSING TO SETTLE A RETIRED TIP ROW", {
				paymentId: payment._id,
				status: payment.status,
			});
			return;
		}

		const now = Date.now();
		await ctx.db.patch(payment._id, {
			status: PAYMENT_STATUS.SUCCEEDED,
			stripePaymentIntentId: args.stripePaymentIntentId,
			...(args.stripeChargeId !== undefined && { stripeChargeId: args.stripeChargeId }),
			succeededAt: now,
			updatedAt: now,
			updatedBy: AUDIT_SYSTEM_USER_ID,
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.SESSIONS,
			aggregateId: payment.sessionId,
			eventType: AUDIT_EVENT.SESSION_TIP_PAID,
			restaurantId: payment.restaurantId,
			payload: {
				paymentId: payment._id,
				amount: payment.amount,
				paidByUserId: payment.paidByUserId,
			},
			userId: payment.paidByUserId ?? AUDIT_SYSTEM_USER_ID,
			idempotencyKey: args.stripePaymentIntentId,
		});
	},
});

/**
 * Sends back a tip charge that landed on a retired attempt (TAVLI-104 review
 * round 2).
 *
 * The situation: a member's tip create outlived the in-flight window, a second
 * tap superseded the row and charged its own intent, and then the FIRST intent
 * charged the card too. Two charges, one gesture. The replacement is the tip the
 * member meant to leave; this one is not owed at all.
 *
 * Refunded automatically, unlike a charge on a served order. That branch holds
 * the money because refunding it would hand back payment for food the diner has
 * already eaten — a gratuity has no such counterpart. Nobody was served twice,
 * so nobody is owed twice.
 *
 * What is written here, and why:
 * - the intent and charge ids, which the row was deliberately never given
 *   (`attachIntentToPayment` refuses a retired row, and the webhook's metadata
 *   fallback no longer attaches to one) — but the refund needs them, and the
 *   audit trail deserves to say which charge this was;
 * - `refundStatus: requested`, so the window before the refund lands reads as
 *   "collected, refund on its way";
 * - the status stays SUPERSEDED / CANCELLED. It is the truth: the attempt was
 *   retired. Moving it to SUCCEEDED would put it back in the tip pool, which is
 *   the very thing this exists to prevent.
 *
 * Idempotent: a row that already carries a refund request or a refund is left
 * alone, so a redelivery cannot schedule a second one.
 */
export const refundRetiredTipCharge = internalMutation({
	args: {
		paymentId: v.id(TABLE.PAYMENTS),
		stripePaymentIntentId: v.string(),
		stripeChargeId: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const payment = await ctx.db.get(args.paymentId);
		if (!payment) return;
		if (
			payment.status !== PAYMENT_STATUS.SUPERSEDED &&
			payment.status !== PAYMENT_STATUS.CANCELLED
		) {
			return;
		}
		if (payment.refundStatus !== PAYMENT_REFUND_STATUS.NONE || payment.stripeRefundId) return;

		console.error(
			"[payments.refundRetiredTipCharge] REFUNDING A TIP CHARGED ON A RETIRED ATTEMPT",
			{
				paymentId: payment._id,
				status: payment.status,
				amount: payment.amount,
			}
		);

		const now = Date.now();
		await ctx.db.patch(payment._id, {
			stripePaymentIntentId: args.stripePaymentIntentId,
			...(args.stripeChargeId !== undefined && { stripeChargeId: args.stripeChargeId }),
			refundStatus: PAYMENT_REFUND_STATUS.REQUESTED,
			refundRequestedAt: now,
			failureMessage: "Charged against a retired tip attempt; refunded automatically",
			updatedAt: now,
			updatedBy: AUDIT_SYSTEM_USER_ID,
		});

		// Same kind and same key as the stand-down's alert for this row, so the
		// operator gets ONE open item per payment however many ways the problem
		// announces itself.
		await raiseOperatorAlert(ctx, {
			kind: OPERATOR_ALERT_KIND.CHARGE_NEEDS_REVIEW,
			severity: OPERATOR_ALERT_SEVERITY.SEVERE,
			restaurantId: payment.restaurantId,
			paymentId: payment._id,
			stripeObjectId: args.stripePaymentIntentId,
			messageParams: {
				collected: formatMoneyCents(payment.amount),
				currency: payment.currency.toUpperCase(),
			},
			dedupeKey: `charge_on_retired_attempt:${payment._id}`,
		});

		await ctx.scheduler.runAfter(0, internal.stripe.refundStrandedCharge, {
			paymentId: payment._id,
		});
	},
});

/**
 * Failure half (`payment_intent.payment_failed`, kind "tip"): the payment row
 * is marked failed so the diner can retry from the close-out screen — the next
 * `createTipCharge` supersedes the failed row with a fresh attempt.
 */
export const failTipPayment = internalMutation({
	args: {
		paymentId: v.id(TABLE.PAYMENTS),
		stripePaymentIntentId: v.string(),
		failureCode: v.optional(v.string()),
		failureMessage: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const payment = await ctx.db.get(args.paymentId);
		if (!payment || payment.kind !== PAYMENT_KIND.TIP) return;
		if (payment.status === PAYMENT_STATUS.SUCCEEDED) return;

		const now = Date.now();
		await ctx.db.patch(payment._id, {
			status: PAYMENT_STATUS.FAILED,
			stripePaymentIntentId: args.stripePaymentIntentId,
			...(args.failureCode !== undefined && { failureCode: args.failureCode }),
			...(args.failureMessage !== undefined && { failureMessage: args.failureMessage }),
			failedAt: now,
			updatedAt: now,
			updatedBy: AUDIT_SYSTEM_USER_ID,
		});
	},
});
