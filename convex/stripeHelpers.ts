import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import {
	ORDER_PAYMENT_STATE,
	PAYMENT_REFUND_STATUS,
	PAYMENT_STATUS,
	TABLE,
} from "./constants";

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
			.withIndex("by_payment_intent", (q) => q.eq("stripePaymentIntentId", args.stripePaymentIntentId))
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

		return payments
			.sort((a, b) => {
				if (a.attemptNumber !== b.attemptNumber) {
					return b.attemptNumber - a.attemptNumber;
				}
				return b.createdAt - a.createdAt;
			})
			.at(0) ?? null;
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
