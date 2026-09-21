import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import {
	AUDIT_SYSTEM_USER_ID,
	ORDER_PAYMENT_STATE,
	PAYMENT_KIND,
	PAYMENT_REFUND_STATUS,
	PAYMENT_STATUS,
	STRIPE_ACCOUNT_STATUS,
	TABLE,
} from "./constants";
import { appendAuditEvent } from "./_util/audit";
import { restoreLedgerForRefund } from "./disputes";

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

const stripeAccountStatusValidator = v.union(
	v.literal(STRIPE_ACCOUNT_STATUS.ACTIVE),
	v.literal(STRIPE_ACCOUNT_STATUS.RESTRICTED),
	v.literal(STRIPE_ACCOUNT_STATUS.CLOSED)
);

const paymentKindValidator = v.union(
	v.literal(PAYMENT_KIND.ORDER),
	v.literal(PAYMENT_KIND.TIP),
	v.literal(PAYMENT_KIND.SUBSTITUTION)
);

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
			// A brand-new account id starts with no status of its own. Clearing it
			// is what lets a restaurant whose previous account Stripe CLOSED
			// onboard again — `closed` is terminal per account id, not per
			// restaurant, and the next status refresh writes the new one's.
			stripeAccountStatus: undefined,
			updatedAt: Date.now(),
		});
	},
});

export const updateOnboardingStatus = internalMutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		stripeOnboardingComplete: v.boolean(),
		stripeAccountStatus: v.optional(stripeAccountStatusValidator),
	},
	handler: async (ctx, args) => {
		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant) return;
		if (isClosedAndStaysClosed(restaurant.stripeAccountStatus, args.stripeAccountStatus)) return;

		await ctx.db.patch(args.restaurantId, {
			stripeOnboardingComplete: args.stripeOnboardingComplete,
			...(args.stripeAccountStatus !== undefined && {
				stripeAccountStatus: args.stripeAccountStatus,
			}),
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
			// The admin Reset is the documented way out of a `closed` account, so
			// the status has to go with the link it described.
			stripeAccountStatus: undefined,
			updatedAt: Date.now(),
		});
	},
});

/**
 * Whether a status write must be dropped because the account is already closed.
 *
 * Stripe does not reopen a closed account, but it does keep delivering
 * `v2.core.account[...]` events about one, and `getAccountStatus` keeps being
 * called from the admin page. Without this guard any of those could patch
 * `stripeOnboardingComplete: true` back onto a dead account and re-open the
 * payment gates. Only an explicit `closed` write (the closure handler itself,
 * replayed) gets through; leaving the state is the admin Reset's job, or
 * `saveStripeAccountId` with a new account id.
 */
function isClosedAndStaysClosed(
	current: string | undefined,
	incoming: string | undefined
): boolean {
	return current === STRIPE_ACCOUNT_STATUS.CLOSED && incoming !== STRIPE_ACCOUNT_STATUS.CLOSED;
}

/**
 * Updates onboarding status by looking up the restaurant via its Stripe account ID.
 * Used by webhook handlers that only know the Stripe account ID, not our internal ID.
 */
export const updateOnboardingByAccountId = internalMutation({
	args: {
		stripeAccountId: v.string(),
		stripeOnboardingComplete: v.boolean(),
		stripeAccountStatus: v.optional(stripeAccountStatusValidator),
	},
	handler: async (ctx, args) => {
		const restaurant = await ctx.db
			.query(TABLE.RESTAURANTS)
			.withIndex("by_stripe_account", (q) => q.eq("stripeAccountId", args.stripeAccountId))
			.first();
		if (!restaurant) return;
		if (isClosedAndStaysClosed(restaurant.stripeAccountStatus, args.stripeAccountStatus)) return;

		await ctx.db.patch(restaurant._id, {
			stripeOnboardingComplete: args.stripeOnboardingComplete,
			...(args.stripeAccountStatus !== undefined && {
				stripeAccountStatus: args.stripeAccountStatus,
			}),
			updatedAt: Date.now(),
		});
	},
});

/**
 * Records that Stripe closed (or rejected) a connected account — TAVLI-65.
 *
 * Three things happen together, which is why this is one mutation rather than
 * a `updateOnboardingByAccountId` call with different arguments:
 *
 * 1. `stripeOnboardingComplete: false` shuts the payment gates that read it.
 * 2. `stripeAccountStatus: "closed"` is the only record that distinguishes a
 *    closed account from a restaurant that never had one, and it is what the
 *    admin page and the gates' error message both key off.
 * 3. `stripeAccountId` is **kept**. The operator's next step is to look the
 *    account up in the Stripe Dashboard, and an unlink here would throw away
 *    the only handle on it. (The admin Reset does unlink — deliberately, as the
 *    prelude to onboarding a replacement.)
 *
 * Returns the restaurant, so the caller can attach it to the operator alert
 * without a second round trip. `null` means no restaurant in this deployment
 * claims that account id — dev and staging share one Stripe test account, so a
 * closure fired by another environment lands here too.
 */
export const markStripeAccountClosedByAccountId = internalMutation({
	args: { stripeAccountId: v.string() },
	handler: async (ctx, args): Promise<{ restaurantId: Id<"restaurants"> } | null> => {
		const restaurant = await ctx.db
			.query(TABLE.RESTAURANTS)
			.withIndex("by_stripe_account", (q) => q.eq("stripeAccountId", args.stripeAccountId))
			.first();
		if (!restaurant) return null;

		await ctx.db.patch(restaurant._id, {
			stripeOnboardingComplete: false,
			stripeAccountStatus: STRIPE_ACCOUNT_STATUS.CLOSED,
			updatedAt: Date.now(),
		});
		return { restaurantId: restaurant._id };
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
		/** Set on kind "substitution" rows (the visit grouping) and kind "tip" rows; order rows carry `orderId` only. */
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
		/** Set on kind "substitution" rows: the proposal whose delta this pays. */
		substitutionProposalId: v.optional(v.id(TABLE.SUBSTITUTION_PROPOSALS)),
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
		 * Dispute recovery withheld from this payment's transfer (TAVLI-102).
		 * Set by `createPaymentIntent` on ORDER rows only; the ledger itself is
		 * drawn down later, when the charge settles.
		 */
		disputeRecoveryAmount: v.optional(v.number()),
		disputeRecoveryIds: v.optional(v.array(v.id(TABLE.DISPUTE_RECOVERIES))),
	},
	handler: async (ctx, args) => {
		const now = Date.now();
		return await ctx.db.insert(TABLE.PAYMENTS, {
			...args,
			createdAt: now,
			updatedAt: now,
		});
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

		if (args.isFullyRefunded && payment.orderId) {
			const order = await ctx.db.get(payment.orderId);
			if (order) {
				await ctx.db.patch(order._id, {
					paymentState: ORDER_PAYMENT_STATE.REFUNDED,
					updatedAt: now,
					updatedBy: AUDIT_SYSTEM_USER_ID,
				});
			}
		}

		// A refund on a payment that repaid a lost dispute has to give the ledger
		// its debt back (TAVLI-102): Stripe returns the diner's whole charge out
		// of the platform balance and reverses only the already-reduced transfer,
		// so Tavli recovered nothing. Same transaction as the refund record, so
		// the two can never disagree.
		await restoreLedgerForRefund(ctx, {
			paymentId: args.paymentId,
			amountRefunded: args.amountRefunded,
		});

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
 * `recordChargeDispute` lived here until TAVLI-102 and is now
 * `disputes.recordDisputeEventInternal`.
 *
 * It moved because the mutation stopped being "persist these facts": a dispute
 * event now opens or credits back a recovery ledger row, maintains two
 * aggregates, notifies the restaurant's managers, mails them, and raises an
 * operator alert. That belongs beside the ledger it maintains rather than in
 * the general-purpose Stripe helper file — and the move is what lets the
 * webhook handlers and the ledger share one definition of what a phase means.
 */
