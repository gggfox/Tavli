/**
 * V8-side queries and mutations for the payments table.
 *
 * Live in their own file because `stripe.ts` is a `"use node"` action module
 * and can't host `internalQuery`/`internalMutation` definitions.
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { appendAuditEvent } from "./_util/audit";
import { requireRestaurantManagerOrAbove } from "./_util/auth";
import {
	AUDIT_EVENT,
	AUDIT_SYSTEM_USER_ID,
	PAYMENT_KIND,
	PAYMENT_STATUS,
	TABLE,
} from "./constants";
import { hasFeeBreakdown, paymentMoneyBreakdown } from "./paymentMoneyHelpers";

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
