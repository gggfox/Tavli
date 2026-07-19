import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import {
	AUDIT_SYSTEM_USER_ID,
	ORDER_PAYMENT_STATE,
	PAYMENT_REFUND_STATUS,
	PAYMENT_STATUS,
	TABLE,
} from "./constants";
import { appendAuditEvent } from "./_util/audit";
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
		orderId: v.id(TABLE.ORDERS),
		amount: v.number(),
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

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.PAYMENTS,
			aggregateId: args.paymentId,
			eventType: "payments.refundRecorded",
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
