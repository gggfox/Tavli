import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./_generated/server";
import {
	AUDIT_SYSTEM_USER_ID,
	ORDER_PAYMENT_STATE,
	PAYMENT_KIND,
	PAYMENT_REFUND_STATUS,
	PAYMENT_STATUS,
	TABLE,
} from "./constants";
import { ConflictError, fromErrorObject } from "./_shared/errors";
import { appendAuditEvent } from "./_util/audit";
import { isPaymentCreateInFlight, PAYMENT_SUPERSEDE_ERRORS } from "./paymentSupersedeHelpers";
import { DISPUTE_PHASE } from "./stripeWebhookHelpers";

const paymentStatusValidator = v.union(
	v.literal(PAYMENT_STATUS.PENDING),
	v.literal(PAYMENT_STATUS.PROCESSING),
	v.literal(PAYMENT_STATUS.SUCCEEDED),
	v.literal(PAYMENT_STATUS.FAILED),
	v.literal(PAYMENT_STATUS.SUPERSEDED),
	v.literal(PAYMENT_STATUS.CANCELLED)
);

const paymentRefundStatusValidator = v.union(
	v.literal(PAYMENT_REFUND_STATUS.NONE),
	v.literal(PAYMENT_REFUND_STATUS.REQUESTED),
	v.literal(PAYMENT_REFUND_STATUS.SUCCEEDED),
	v.literal(PAYMENT_REFUND_STATUS.PARTIAL),
	v.literal(PAYMENT_REFUND_STATUS.FAILED)
);

const paymentKindValidator = v.union(v.literal(PAYMENT_KIND.ORDER), v.literal(PAYMENT_KIND.TIP));

const orderPaymentStateValidator = v.union(
	v.literal(ORDER_PAYMENT_STATE.UNPAID),
	v.literal(ORDER_PAYMENT_STATE.PENDING),
	v.literal(ORDER_PAYMENT_STATE.PROCESSING),
	v.literal(ORDER_PAYMENT_STATE.PAID),
	v.literal(ORDER_PAYMENT_STATE.FAILED),
	v.literal(ORDER_PAYMENT_STATE.REFUND_REQUESTED),
	v.literal(ORDER_PAYMENT_STATE.REFUNDED),
	v.literal(ORDER_PAYMENT_STATE.REFUND_FAILED)
);

// =============================================================================
// Internal Queries
// =============================================================================
// Used by stripe.ts actions via ctx.runQuery(internal.stripeHelpers.*)

export const getRestaurantInternal = internalQuery({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async (ctx, args) => {
		return await ctx.db.get(args.restaurantId);
	},
});

export const getUserRoleInternal = internalQuery({
	args: { userId: v.string() },
	handler: async (ctx, args) => {
		return await ctx.db
			.query(TABLE.USER_ROLES)
			.withIndex("by_user", (q) => q.eq("userId", args.userId))
			.first();
	},
});

export const getRestaurantByStripeAccountIdInternal = internalQuery({
	args: { stripeAccountId: v.string() },
	handler: async (ctx, args) => {
		return await ctx.db
			.query(TABLE.RESTAURANTS)
			.withIndex("by_stripe_account", (q) => q.eq("stripeAccountId", args.stripeAccountId))
			.first();
	},
});

export const getOrderInternal = internalQuery({
	args: { orderId: v.id(TABLE.ORDERS) },
	handler: async (ctx, args) => {
		return await ctx.db.get(args.orderId);
	},
});

export const getOrderItemInternal = internalQuery({
	args: { orderItemId: v.id(TABLE.ORDER_ITEMS) },
	handler: async (ctx, args) => {
		return await ctx.db.get(args.orderItemId);
	},
});

export const getPaymentInternal = internalQuery({
	args: { paymentId: v.id(TABLE.PAYMENTS) },
	handler: async (ctx, args) => {
		return await ctx.db.get(args.paymentId);
	},
});

export const getPaymentByPaymentIntentIdInternal = internalQuery({
	args: { stripePaymentIntentId: v.string() },
	handler: async (ctx, args) => {
		return await ctx.db
			.query(TABLE.PAYMENTS)
			.withIndex("by_payment_intent", (q) =>
				q.eq("stripePaymentIntentId", args.stripePaymentIntentId)
			)
			.first();
	},
});

/**
 * Resolves the `paymentId` / `restaurantId` a PaymentIntent carries in its
 * metadata into real documents (TAVLI-105).
 *
 * Every intent Tavli creates stamps both — `createOrderPaymentIntent`,
 * `createTabPaymentIntent` and `createTipCharge` alike — which is what lets the
 * webhook find a payment row whose `stripePaymentIntentId` has not landed yet.
 *
 * Takes plain strings, not `v.id(...)`, and goes through `normalizeId`. That is
 * the whole point: metadata is arbitrary text off the wire, and handing a
 * `v.id(TABLE.PAYMENTS)` validator a string that is not an id of that table
 * THROWS. A throw inside `fulfillPayment` means a non-2xx, which means Stripe
 * redelivers the same event for days and throws again every time. A value that
 * does not normalize is simply not one of our rows, and the caller treats it as
 * such.
 *
 * The restaurant is resolved rather than passed through so an operator alert
 * can never be filed against an id that names nothing.
 */
export const resolveStripeMetadataRefsInternal = internalQuery({
	args: {
		paymentId: v.optional(v.string()),
		restaurantId: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const paymentId = args.paymentId ? ctx.db.normalizeId(TABLE.PAYMENTS, args.paymentId) : null;
		const restaurantId = args.restaurantId
			? ctx.db.normalizeId(TABLE.RESTAURANTS, args.restaurantId)
			: null;

		const restaurant = restaurantId ? await ctx.db.get(restaurantId) : null;
		return {
			payment: paymentId ? await ctx.db.get(paymentId) : null,
			restaurantId: restaurant?._id ?? null,
		};
	},
});

export const listPaymentsByOrderInternal = internalQuery({
	args: { orderId: v.id(TABLE.ORDERS) },
	handler: async (ctx, args) => {
		const payments = await ctx.db
			.query(TABLE.PAYMENTS)
			.withIndex("by_order", (q) => q.eq("orderId", args.orderId))
			.collect();

		return payments.sort((a, b) => {
			if (a.attemptNumber !== b.attemptNumber) {
				return b.attemptNumber - a.attemptNumber;
			}
			return b.createdAt - a.createdAt;
		});
	},
});

export const getLatestPaymentByOrderInternal = internalQuery({
	args: { orderId: v.id(TABLE.ORDERS) },
	handler: async (ctx, args) => {
		const payments = await ctx.db
			.query(TABLE.PAYMENTS)
			.withIndex("by_order", (q) => q.eq("orderId", args.orderId))
			.collect();

		return (
			payments
				.sort((a, b) => {
					if (a.attemptNumber !== b.attemptNumber) {
						return b.attemptNumber - a.attemptNumber;
					}
					return b.createdAt - a.createdAt;
				})
				.at(0) ?? null
		);
	},
});

export const getProcessedStripeWebhookEventInternal = internalQuery({
	args: { eventId: v.string() },
	handler: async (ctx, args) => {
		return await ctx.db
			.query(TABLE.STRIPE_WEBHOOK_EVENTS)
			.withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
			.first();
	},
});

// =============================================================================
// Internal Mutations
// =============================================================================

export const saveStripeAccountId = internalMutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		stripeAccountId: v.string(),
	},
	handler: async (ctx, args) => {
		await ctx.db.patch(args.restaurantId, {
			stripeAccountId: args.stripeAccountId,
			updatedAt: Date.now(),
		});
	},
});

export const updateOnboardingStatus = internalMutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		stripeOnboardingComplete: v.boolean(),
	},
	handler: async (ctx, args) => {
		await ctx.db.patch(args.restaurantId, {
			stripeOnboardingComplete: args.stripeOnboardingComplete,
			updatedAt: Date.now(),
		});
	},
});

/**
 * Unlinks a restaurant from its Stripe connected account by clearing
 * `stripeAccountId` and `stripeOnboardingComplete`. Used by the Reset Stripe
 * Setup flow so a new account (e.g. with a different country) can be created.
 * The Stripe account itself is closed separately in the action layer.
 */
export const clearStripeConnection = internalMutation({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async (ctx, args) => {
		await ctx.db.patch(args.restaurantId, {
			stripeAccountId: undefined,
			stripeOnboardingComplete: undefined,
			updatedAt: Date.now(),
		});
	},
});

/**
 * Updates onboarding status by looking up the restaurant via its Stripe account ID.
 * Used by webhook handlers that only know the Stripe account ID, not our internal ID.
 */
export const updateOnboardingByAccountId = internalMutation({
	args: {
		stripeAccountId: v.string(),
		stripeOnboardingComplete: v.boolean(),
	},
	handler: async (ctx, args) => {
		const restaurant = await ctx.db
			.query(TABLE.RESTAURANTS)
			.withIndex("by_stripe_account", (q) => q.eq("stripeAccountId", args.stripeAccountId))
			.first();
		if (restaurant) {
			await ctx.db.patch(restaurant._id, {
				stripeOnboardingComplete: args.stripeOnboardingComplete,
				updatedAt: Date.now(),
			});
		}
	},
});

export const savePaymentIntentId = internalMutation({
	args: {
		orderId: v.id(TABLE.ORDERS),
		stripePaymentIntentId: v.string(),
	},
	handler: async (ctx, args) => {
		await ctx.db.patch(args.orderId, {
			stripePaymentIntentId: args.stripePaymentIntentId,
			updatedAt: Date.now(),
		});
	},
});

export const createPayment = internalMutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		/** Absent on kind "tip" rows, which are session-scoped (`sessionId` only). */
		orderId: v.optional(v.id(TABLE.ORDERS)),
		/** Set on kind "tip" rows (the visit grouping); order rows carry `orderId` only. */
		sessionId: v.optional(v.id(TABLE.SESSIONS)),
		amount: v.number(),
		// ADR 008 breakdown: new-model rows satisfy amount === subtotalAmount +
		// feeAmount. Absent on legacy rows. Tip rows carry subtotal 0 / fee 0 and
		// the whole amount in `gratuityAmount`.
		subtotalAmount: v.optional(v.number()),
		feeAmount: v.optional(v.number()),
		/** Tip portion in smallest currency unit (kind "tip": equals `amount`). */
		gratuityAmount: v.optional(v.number()),
		kind: v.optional(paymentKindValidator),
		paidByUserId: v.optional(v.string()),
		currency: v.string(),
		status: paymentStatusValidator,
		refundStatus: paymentRefundStatusValidator,
		attemptNumber: v.number(),
		orderUpdatedAtSnapshot: v.optional(v.number()),
		stripePaymentIntentId: v.optional(v.string()),
		stripeChargeId: v.optional(v.string()),
		stripeRefundId: v.optional(v.string()),
		latestStripeEventId: v.optional(v.string()),
		failureCode: v.optional(v.string()),
		failureMessage: v.optional(v.string()),
		succeededAt: v.optional(v.number()),
		failedAt: v.optional(v.number()),
		refundRequestedAt: v.optional(v.number()),
		refundedAt: v.optional(v.number()),
		/**
		 * The attempt the calling action stood down at Stripe and retired before
		 * asking for this row (TAVLI-104). Omitted when it saw no live attempt.
		 * Re-checked inside this transaction — see the handler.
		 */
		supersededPaymentId: v.optional(v.id(TABLE.PAYMENTS)),
	},
	handler: async (ctx, args) => {
		const now = Date.now();
		const { supersededPaymentId, ...row } = args;

		// TRANSACTIONAL double-tap guard (TAVLI-104 review round 1).
		//
		// The action already stood the previous attempt down at Stripe and
		// refused to proceed if it was still in flight — but it did that against
		// a snapshot it read seconds earlier. Two members tapping Pay 300ms apart
		// both read "no live attempt", both stand nothing down, and both insert.
		// The question has to be asked again HERE, inside the transaction that
		// does the inserting, where Convex's OCC can serialise the answer: the
		// lookup reads the order document (or the session's payment rows), and
		// the loser's own write to that same document makes one of the two
		// transactions retry and see the other's row.
		//
		// `supersededPaymentId` is what the action believed the live attempt was
		// and has already retired. Anything else live means somebody else got
		// here first.
		const live = await findLiveAttempt(ctx, row);
		if (live && (live._id !== supersededPaymentId || isPaymentCreateInFlight(live, now))) {
			throw fromErrorObject(new ConflictError(PAYMENT_SUPERSEDE_ERRORS.IN_PROGRESS).toObject());
		}

		const paymentId = await ctx.db.insert(TABLE.PAYMENTS, {
			...row,
			createdAt: now,
			updatedAt: now,
		});

		// The order's pointer moves in the SAME transaction as the insert, not in
		// a follow-up call from the action. That is what gives the guard above
		// something to collide on: two concurrent taps both read and write this
		// document, so OCC has to order them, and the second one re-runs and
		// finds the first one's row.
		if (row.orderId) {
			const order = await ctx.db.get(row.orderId);
			if (order) {
				await ctx.db.patch(row.orderId, {
					paymentState: ORDER_PAYMENT_STATE.PENDING,
					activePaymentId: paymentId,
					updatedAt: order.updatedAt,
				});
			}
		}

		return paymentId;
	},
});

/**
 * The live payment attempt for whatever this new row is about to pay for, or
 * `null`. "Live" is `pending` or `processing` — a terminal row cannot be
 * charged and does not block anything.
 *
 * Two scopes, because the two kinds of row are grouped differently (ADR 008):
 * an order row is the one the ORDER points at, while a tip row is per member
 * per visit and has no pointer to read, so it is found the same way
 * `payments.getActiveTipPaymentInternal` finds it.
 */
async function findLiveAttempt(
	ctx: MutationCtx,
	row: { orderId?: Id<"orders">; sessionId?: Id<"sessions">; kind?: string; paidByUserId?: string }
): Promise<Doc<"payments"> | null> {
	const isLive = (payment: Doc<"payments">) =>
		payment.status === PAYMENT_STATUS.PENDING || payment.status === PAYMENT_STATUS.PROCESSING;

	if (row.orderId) {
		const order = await ctx.db.get(row.orderId);
		if (!order?.activePaymentId) return null;
		const active = await ctx.db.get(order.activePaymentId);
		return active && isLive(active) ? active : null;
	}

	if (row.kind === PAYMENT_KIND.TIP && row.sessionId && row.paidByUserId) {
		const sessionPayments = await ctx.db
			.query(TABLE.PAYMENTS)
			.withIndex("by_session", (q) => q.eq("sessionId", row.sessionId))
			.collect();
		let latest: Doc<"payments"> | null = null;
		for (const payment of sessionPayments) {
			if (payment.kind !== PAYMENT_KIND.TIP) continue;
			if (payment.paidByUserId !== row.paidByUserId) continue;
			if (!isLive(payment)) continue;
			if (!latest || payment.createdAt > latest.createdAt) latest = payment;
		}
		return latest;
	}

	return null;
}

/**
 * Records the PaymentIntent a payment row was charged on, WITHOUT ever moving
 * the row backwards (TAVLI-105).
 *
 * This is the create-path half of the same race the webhook's metadata fallback
 * fixes, and it is the more dangerous half. `createTipCharge` charges the saved
 * card with `off_session: true, confirm: true`, so by the time
 * `paymentIntents.create` returns, `payment_intent.succeeded` may already have
 * been delivered and — now that the fallback can find the row without an intent
 * id — may already have SETTLED it. The blind
 * `updatePayment({ status: "processing", stripePaymentIntentId })` that used to
 * run here would then overwrite `succeeded` with `processing`, permanently: the
 * tip is uncredited, Stripe's redeliveries are already deduped, and the diner's
 * retry is refused because an in-flight attempt exists. Fixing the webhook
 * without fixing this would have moved the bug rather than closed it.
 *
 * So the status only ever moves PENDING → PROCESSING. A row that has reached
 * `succeeded`, `failed`, `superseded` or `cancelled` keeps that status and only
 * gains the ids, which are facts about the charge and safe to record either way.
 *
 * A row already naming a DIFFERENT intent is not touched at all: two intents
 * cannot both be the one that charged it, and the webhook is the half that knows
 * which. Logged rather than thrown — this runs after the money has moved, and
 * throwing would show the diner an error for a charge that went through.
 */
export const attachIntentToPayment = internalMutation({
	args: {
		paymentId: v.id(TABLE.PAYMENTS),
		stripePaymentIntentId: v.string(),
		/** The saved card, on the one-tap path. */
		stripePaymentMethodId: v.optional(v.string()),
	},
	/**
	 * `attached: false` means this intent is NOT the row's intent — the row is
	 * gone, holds another one, or was retired. The caller must not go on to hand
	 * its client secret to the diner or re-point the order at it (sign-off nit).
	 */
	returns: v.object({ attached: v.boolean() }),
	handler: async (ctx, args): Promise<{ attached: boolean }> => {
		const payment = await ctx.db.get(args.paymentId);
		if (!payment) return { attached: false };

		if (
			payment.stripePaymentIntentId &&
			payment.stripePaymentIntentId !== args.stripePaymentIntentId
		) {
			console.error("[stripeHelpers.attachIntentToPayment] INTENT ID CONFLICT", {
				paymentId: payment._id,
				paymentKind: payment.kind ?? "legacy",
				status: payment.status,
			});
			return { attached: false };
		}

		// A RETIRED row does not get the intent id at all (TAVLI-104 review round
		// 1). This is the late return: the row was superseded or cancelled while
		// its own `paymentIntents.create` was still running, and the call has now
		// come back with an intent nobody is waiting for. Writing the id onto the
		// row would hand the webhook's metadata fallback a target — and
		// `confirmTipPayment` settles anything that is not already SUCCEEDED, so
		// the retired attempt would be credited alongside the one that replaced
		// it. That is the double tip, arriving by the back door.
		//
		// Instead the intent is stood down at Stripe by id. If it is unconfirmed
		// it dies there and no money ever moves; if it already charged, the
		// stand-down raises a severe alert, because that is money a human has to
		// decide about. The row keeps its retired status either way.
		if (
			payment.status === PAYMENT_STATUS.SUPERSEDED ||
			payment.status === PAYMENT_STATUS.CANCELLED
		) {
			console.error("[stripeHelpers.attachIntentToPayment] INTENT ARRIVED FOR A RETIRED ROW", {
				paymentId: payment._id,
				paymentKind: payment.kind ?? "legacy",
				status: payment.status,
			});
			await ctx.scheduler.runAfter(0, internal.stripe.standDownSupersededIntent, {
				paymentId: payment._id,
				stripePaymentIntentId: args.stripePaymentIntentId,
			});
			return { attached: false };
		}

		await ctx.db.patch(args.paymentId, {
			stripePaymentIntentId: args.stripePaymentIntentId,
			...(args.stripePaymentMethodId !== undefined && {
				stripePaymentMethodId: args.stripePaymentMethodId,
			}),
			// Forward only. Anything past PENDING has already been decided, by the
			// webhook or by a superseding attempt, and that decision stands.
			...(payment.status === PAYMENT_STATUS.PENDING && { status: PAYMENT_STATUS.PROCESSING }),
			updatedAt: Date.now(),
		});
		return { attached: true };
	},
});

/**
 * Records a create-path failure WITHOUT ever undoing a settlement (TAVLI-105,
 * review round 2). The failure twin of {@link attachIntentToPayment}.
 *
 * The scenario this closes is the ugliest version of the off-session race.
 * `createTipCharge` calls `paymentIntents.create` with `confirm: true`; Stripe
 * charges the card and then the RESPONSE is lost — a timeout on the call and on
 * both `maxNetworkRetries` replays. The money has moved, Stripe delivers
 * `payment_intent.succeeded`, and the webhook settles the tip through the
 * metadata fallback. Only then does the action's `catch` run, and a blind
 * `updatePayment({ status: "failed" })` would take a SUCCEEDED row to FAILED:
 * the credit gone, the event already deduped so no redelivery can restore it,
 * and — because the action rethrows — the diner told to try again, which is a
 * second charge for the same tip.
 *
 * So FAILED is written only from PENDING or PROCESSING. SUCCEEDED is reported
 * back instead of overwritten, and callers on the racy path return success
 * rather than rethrowing. SUPERSEDED and CANCELLED are left alone too: a
 * superseding attempt owns the row by then, and resurrecting it as "the failed
 * attempt" would confuse the retry logic that superseded it.
 */
export const failPaymentUnlessSettled = internalMutation({
	args: {
		paymentId: v.id(TABLE.PAYMENTS),
		failureCode: v.optional(v.string()),
		failureMessage: v.optional(v.string()),
	},
	returns: v.object({ alreadySucceeded: v.boolean() }),
	handler: async (ctx, args): Promise<{ alreadySucceeded: boolean }> => {
		const payment = await ctx.db.get(args.paymentId);
		if (!payment) return { alreadySucceeded: false };

		// The charge went through and something else already recorded it. The
		// caller needs to know, because "throw" and "return success" are very
		// different things to show a diner who has been charged.
		if (payment.status === PAYMENT_STATUS.SUCCEEDED) return { alreadySucceeded: true };

		if (payment.status !== PAYMENT_STATUS.PENDING && payment.status !== PAYMENT_STATUS.PROCESSING) {
			return { alreadySucceeded: false };
		}

		const now = Date.now();
		await ctx.db.patch(args.paymentId, {
			status: PAYMENT_STATUS.FAILED,
			...(args.failureCode !== undefined && { failureCode: args.failureCode }),
			...(args.failureMessage !== undefined && { failureMessage: args.failureMessage }),
			failedAt: now,
			updatedAt: now,
		});
		return { alreadySucceeded: false };
	},
});

export const updatePayment = internalMutation({
	args: {
		paymentId: v.id(TABLE.PAYMENTS),
		status: v.optional(paymentStatusValidator),
		refundStatus: v.optional(paymentRefundStatusValidator),
		/** Saved card persisted on success for later one-tap charges (ADR 008). */
		stripePaymentMethodId: v.optional(v.string()),
		stripePaymentIntentId: v.optional(v.string()),
		stripeChargeId: v.optional(v.string()),
		stripeRefundId: v.optional(v.string()),
		latestStripeEventId: v.optional(v.string()),
		failureCode: v.optional(v.string()),
		failureMessage: v.optional(v.string()),
		succeededAt: v.optional(v.number()),
		failedAt: v.optional(v.number()),
		refundRequestedAt: v.optional(v.number()),
		refundedAt: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const payment = await ctx.db.get(args.paymentId);
		if (!payment) return;

		await ctx.db.patch(args.paymentId, {
			...(args.status !== undefined && { status: args.status }),
			...(args.refundStatus !== undefined && { refundStatus: args.refundStatus }),
			...(args.stripePaymentMethodId !== undefined && {
				stripePaymentMethodId: args.stripePaymentMethodId,
			}),
			...(args.stripePaymentIntentId !== undefined && {
				stripePaymentIntentId: args.stripePaymentIntentId,
			}),
			...(args.stripeChargeId !== undefined && { stripeChargeId: args.stripeChargeId }),
			...(args.stripeRefundId !== undefined && { stripeRefundId: args.stripeRefundId }),
			...(args.latestStripeEventId !== undefined && {
				latestStripeEventId: args.latestStripeEventId,
			}),
			...(args.failureCode !== undefined && { failureCode: args.failureCode }),
			...(args.failureMessage !== undefined && { failureMessage: args.failureMessage }),
			...(args.succeededAt !== undefined && { succeededAt: args.succeededAt }),
			...(args.failedAt !== undefined && { failedAt: args.failedAt }),
			...(args.refundRequestedAt !== undefined && {
				refundRequestedAt: args.refundRequestedAt,
			}),
			...(args.refundedAt !== undefined && { refundedAt: args.refundedAt }),
			updatedAt: Date.now(),
		});
	},
});

export const updateOrderPaymentSummary = internalMutation({
	args: {
		orderId: v.id(TABLE.ORDERS),
		paymentState: v.optional(orderPaymentStateValidator),
		activePaymentId: v.optional(v.id(TABLE.PAYMENTS)),
		stripePaymentIntentId: v.optional(v.string()),
		paidAt: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		await ctx.db.patch(args.orderId, {
			...(args.paymentState !== undefined && { paymentState: args.paymentState }),
			...(args.activePaymentId !== undefined && { activePaymentId: args.activePaymentId }),
			...(args.stripePaymentIntentId !== undefined && {
				stripePaymentIntentId: args.stripePaymentIntentId,
			}),
			...(args.paidAt !== undefined && { paidAt: args.paidAt }),
		});
	},
});

export const recordStripeWebhookEvent = internalMutation({
	args: {
		eventId: v.string(),
		eventType: v.string(),
		paymentId: v.optional(v.id(TABLE.PAYMENTS)),
	},
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query(TABLE.STRIPE_WEBHOOK_EVENTS)
			.withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
			.first();
		if (existing) {
			return existing._id;
		}

		const now = Date.now();
		return await ctx.db.insert(TABLE.STRIPE_WEBHOOK_EVENTS, {
			eventId: args.eventId,
			eventType: args.eventType,
			paymentId: args.paymentId,
			processedAt: now,
			createdAt: now,
		});
	},
});

// =============================================================================
// Refund & Dispute webhook persistence (charge.refunded / charge.dispute.*)
// =============================================================================
// See `convex/stripeWebhookHelpers.ts` for the routing rationale (these events
// land on the STANDARD webhook because the platform is the losses_collector on
// destination charges). The node-side handlers in `convex/_util/stripe.ts`
// resolve the payment from the charge's PaymentIntent, then call these.

/**
 * Records refund facts derived from a `charge.refunded` event onto the payment.
 * Idempotent: re-applying the same facts is a harmless no-op, and duplicate
 * webhook deliveries are already short-circuited upstream via
 * `stripeWebhookEvents`. Full refunds also flip the linked order to "refunded"
 * (session/tab payments have no dedicated refunded state, so only the payment
 * record is updated there). Also surfaces manual Stripe-dashboard refunds.
 */
export const recordChargeRefund = internalMutation({
	args: {
		paymentId: v.id(TABLE.PAYMENTS),
		amountRefunded: v.number(),
		amountCaptured: v.number(),
		isFullyRefunded: v.boolean(),
		stripeRefundId: v.optional(v.string()),
		refundedAtMs: v.optional(v.number()),
		latestStripeEventId: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const payment = await ctx.db.get(args.paymentId);
		if (!payment) return;

		const now = Date.now();
		const refundStatus = args.isFullyRefunded
			? PAYMENT_REFUND_STATUS.SUCCEEDED
			: PAYMENT_REFUND_STATUS.PARTIAL;

		await ctx.db.patch(args.paymentId, {
			refundStatus,
			amountRefunded: args.amountRefunded,
			...(args.stripeRefundId !== undefined && { stripeRefundId: args.stripeRefundId }),
			...(args.latestStripeEventId !== undefined && {
				latestStripeEventId: args.latestStripeEventId,
			}),
			...(args.isFullyRefunded && { refundedAt: args.refundedAtMs ?? now }),
			updatedAt: now,
			updatedBy: AUDIT_SYSTEM_USER_ID,
		});

		// Only a payment that actually settled THIS ORDER can un-settle it. Three
		// conditions, and each one is load-bearing:
		//
		// - `status === SUCCEEDED`: a refund can land on a row that never
		//   settled. The amount-mismatch path (TAVLI-69) fails the row and asks an
		//   operator to refund the charge at Stripe, and that refund arrives here
		//   as `charge.refunded`. Flipping the order to REFUNDED then would be a
		//   lie in the worst direction — the diner never paid for it, so the order
		//   must stay unpaid and payable, not look like money that came and went.
		// - `order.activePaymentId === payment._id`: SUCCEEDED is no longer
		//   enough on its own (TAVLI-104). A charge the webhook could not place is
		//   now marked SUCCEEDED — it is true, Stripe collected — and refunded
		//   automatically, and that refund comes back through here. The order it
		//   names was left UNPAID and still owed, or is paid by a DIFFERENT
		//   payment; either way this row is not the one that settled it, and
		//   REFUNDED would erase an order the diner still has to pay for, or
		//   un-settle one that is genuinely paid.
		// - `paymentState` is PAID or REFUND_REQUESTED: the only two states a
		//   full refund can legitimately move to REFUNDED.
		//
		// The refund facts are recorded on the payment row above either way.
		if (args.isFullyRefunded && payment.orderId && payment.status === PAYMENT_STATUS.SUCCEEDED) {
			const order = await ctx.db.get(payment.orderId);
			const settledThisOrder =
				order?.activePaymentId === args.paymentId &&
				(order.paymentState === ORDER_PAYMENT_STATE.PAID ||
					order.paymentState === ORDER_PAYMENT_STATE.REFUND_REQUESTED);
			if (order && settledThisOrder) {
				await ctx.db.patch(order._id, {
					paymentState: ORDER_PAYMENT_STATE.REFUNDED,
					updatedAt: now,
					updatedBy: AUDIT_SYSTEM_USER_ID,
				});
			}
		}

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.PAYMENTS,
			aggregateId: args.paymentId,
			eventType: "payments.refundRecorded",
			restaurantId: payment.restaurantId,
			payload: {
				amountRefunded: args.amountRefunded,
				amountCaptured: args.amountCaptured,
				isFullyRefunded: args.isFullyRefunded,
				refundStatus,
				stripeRefundId: args.stripeRefundId,
			},
			userId: AUDIT_SYSTEM_USER_ID,
			idempotencyKey: args.latestStripeEventId
				? `charge.refunded:${args.latestStripeEventId}`
				: undefined,
		});
	},
});

/**
 * Upserts dispute facts from a `charge.dispute.created` / `charge.dispute.closed`
 * event into `stripeDisputes` (one row per Stripe dispute id) and appends an
 * audit event next to the resolved payment. Inserts on `created`, patches on
 * `closed`; re-delivery of either phase is idempotent.
 */
export const recordChargeDispute = internalMutation({
	args: {
		stripeDisputeId: v.string(),
		phase: v.union(v.literal(DISPUTE_PHASE.CREATED), v.literal(DISPUTE_PHASE.CLOSED)),
		reason: v.string(),
		status: v.string(),
		amount: v.number(),
		currency: v.string(),
		eventTimeMs: v.number(),
		restaurantId: v.optional(v.id(TABLE.RESTAURANTS)),
		paymentId: v.optional(v.id(TABLE.PAYMENTS)),
		orderId: v.optional(v.id(TABLE.ORDERS)),
		sessionId: v.optional(v.id(TABLE.SESSIONS)),
		stripeChargeId: v.optional(v.string()),
		stripePaymentIntentId: v.optional(v.string()),
		latestStripeEventId: v.optional(v.string()),
	},
	handler: async (ctx, args): Promise<Id<"stripeDisputes">> => {
		const now = Date.now();
		const existing = await ctx.db
			.query(TABLE.STRIPE_DISPUTES)
			.withIndex("by_dispute_id", (q) => q.eq("stripeDisputeId", args.stripeDisputeId))
			.first();

		let disputeId: Id<"stripeDisputes">;
		if (existing) {
			await ctx.db.patch(existing._id, {
				reason: args.reason,
				status: args.status,
				amount: args.amount,
				currency: args.currency,
				...(args.phase === DISPUTE_PHASE.CREATED && existing.openedAt === undefined
					? { openedAt: args.eventTimeMs }
					: {}),
				...(args.phase === DISPUTE_PHASE.CLOSED ? { closedAt: args.eventTimeMs } : {}),
				updatedAt: now,
			});
			disputeId = existing._id;
		} else {
			disputeId = await ctx.db.insert(TABLE.STRIPE_DISPUTES, {
				stripeDisputeId: args.stripeDisputeId,
				restaurantId: args.restaurantId,
				paymentId: args.paymentId,
				orderId: args.orderId,
				sessionId: args.sessionId,
				stripeChargeId: args.stripeChargeId,
				stripePaymentIntentId: args.stripePaymentIntentId,
				reason: args.reason,
				status: args.status,
				amount: args.amount,
				currency: args.currency,
				...(args.phase === DISPUTE_PHASE.CREATED
					? { openedAt: args.eventTimeMs }
					: { closedAt: args.eventTimeMs }),
				createdAt: now,
				updatedAt: now,
			});
		}

		await appendAuditEvent(ctx, {
			aggregateType: args.paymentId ? TABLE.PAYMENTS : TABLE.STRIPE_DISPUTES,
			aggregateId: args.paymentId ?? disputeId,
			eventType:
				args.phase === DISPUTE_PHASE.CREATED ? "payments.disputeOpened" : "payments.disputeClosed",
			// Best-effort like the dispute row itself: absent when the charge could
			// not be linked back to one of our restaurants.
			restaurantId: args.restaurantId ?? null,
			payload: {
				stripeDisputeId: args.stripeDisputeId,
				reason: args.reason,
				status: args.status,
				amount: args.amount,
				currency: args.currency,
			},
			userId: AUDIT_SYSTEM_USER_ID,
			idempotencyKey: args.latestStripeEventId
				? `charge.dispute.${args.phase}:${args.latestStripeEventId}`
				: undefined,
		});

		return disputeId;
	},
});
