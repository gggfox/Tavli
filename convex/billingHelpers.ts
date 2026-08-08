// =============================================================================
// Platform Subscription — database side (V8)
// =============================================================================
//
// The 2,000 MXN/month platform subscription each restaurant pays Tavli for
// using the product (ADR 008). This is NOT the 12% service fee diners pay on an
// order — that one is `PLATFORM_APPLICATION_FEE_RATE` and lives in the payment
// path. Nothing here touches diner money.
//
// Split for the same reason `stripe.ts` / `stripeHelpers.ts` are split: the
// Stripe SDK forces `convex/billing.ts` into the Node runtime, and Node modules
// cannot host queries or mutations. Everything that reads or writes the
// database lives here and is called through `ctx.runQuery` / `ctx.runMutation`.
// =============================================================================

import { v } from "convex/values";
import { internalMutation, internalQuery, mutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { AUDIT_EVENT, AUDIT_SYSTEM_USER_ID, BILLING_STATUS, TABLE } from "./constants";
import { appendAuditEvent, stampUpdated } from "./_util/audit";
import { getCurrentUserId, requireAdminRole } from "./_util/auth";
import {
	NotFoundError,
	type NotAuthenticatedErrorObject,
	type NotAuthorizedErrorObject,
	type NotFoundErrorObject,
} from "./_shared/errors";
import type { AsyncReturn } from "./_shared/types";

type AuthErrors = NotAuthenticatedErrorObject | NotAuthorizedErrorObject;

// =============================================================================
// Internal queries — called by convex/billing.ts actions and the webhook path
// =============================================================================

/**
 * A soft-deleted restaurant is invisible to every other lookup in
 * `convex/restaurants.ts` (`update`, `getPaymentsEnabled`, the list queries),
 * and it must be invisible here too: it would otherwise keep absorbing
 * subscription patches and receiving Tavli's receipt emails after the operator
 * deleted it. Returning `null` makes the webhook a benign no-op, which is
 * exactly what an unresolvable reference already does.
 *
 * Cancelling the Stripe subscription itself is the delete path's job, not the
 * webhook's: `restaurants.softDelete` schedules
 * `billing.cancelSubscriptionForDeletedRestaurant`, so Stripe stops billing a
 * deleted restaurant instead of invoicing it into this silent no-op.
 */
function isBillable(restaurant: Doc<"restaurants"> | null): restaurant is Doc<"restaurants"> {
	return restaurant != null && restaurant.deletedAt == null;
}

/**
 * Resolves an untrusted id string (a webhook's `client_reference_id` or
 * `metadata.restaurantId`) to a real restaurant. `normalizeId` returns null for
 * anything that isn't a valid id for this table, so a forged payload cannot
 * make an arg validator throw a 500 that echoes our internal shape.
 */
export const getRestaurantByIdStringInternal = internalQuery({
	args: { candidateId: v.string() },
	handler: async (ctx, args): Promise<Doc<"restaurants"> | null> => {
		const restaurantId = ctx.db.normalizeId(TABLE.RESTAURANTS, args.candidateId);
		if (!restaurantId) return null;
		const restaurant = await ctx.db.get(restaurantId);
		return isBillable(restaurant) ? restaurant : null;
	},
});

export const getRestaurantByBillingCustomerIdInternal = internalQuery({
	args: { stripeBillingCustomerId: v.string() },
	handler: async (ctx, args): Promise<Doc<"restaurants"> | null> => {
		const restaurant = await ctx.db
			.query(TABLE.RESTAURANTS)
			.withIndex("by_billing_customer", (q) =>
				q.eq("stripeBillingCustomerId", args.stripeBillingCustomerId)
			)
			.first();
		return isBillable(restaurant) ? restaurant : null;
	},
});

export const getRestaurantBySubscriptionIdInternal = internalQuery({
	args: { stripeSubscriptionId: v.string() },
	handler: async (ctx, args): Promise<Doc<"restaurants"> | null> => {
		const restaurant = await ctx.db
			.query(TABLE.RESTAURANTS)
			.withIndex("by_billing_subscription", (q) =>
				q.eq("stripeSubscriptionId", args.stripeSubscriptionId)
			)
			.first();
		return isBillable(restaurant) ? restaurant : null;
	},
});

/**
 * Everything the platform-fee receipt email needs about a restaurant.
 *
 * Recipient policy: the restaurant's `supportEmail` is the inbox they told us
 * to reach them on, so it wins. The fallback is the OWNER's email from
 * `userRoles` (there is no `users` table — Clerk is the identity store and
 * `userRoles.email` is the mirrored copy). When neither exists the caller skips
 * the send: a hardcoded address would mail Tavli's own invoices to whoever that
 * address belongs to.
 */
export const getBillingEmailContextInternal = internalQuery({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async (
		ctx,
		args
	): Promise<{
		restaurantName: string;
		recipient: string | null;
		defaultLanguage: string | null;
	} | null> => {
		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant) return null;

		const supportEmail = restaurant.supportEmail?.trim();
		if (supportEmail) {
			return {
				restaurantName: restaurant.name,
				recipient: supportEmail,
				defaultLanguage: restaurant.defaultLanguage ?? null,
			};
		}

		const ownerRole = await ctx.db
			.query(TABLE.USER_ROLES)
			.withIndex("by_user", (q) => q.eq("userId", restaurant.ownerId))
			.first();
		const ownerEmail = ownerRole?.email?.trim();

		return {
			restaurantName: restaurant.name,
			recipient: ownerEmail && ownerEmail.length > 0 ? ownerEmail : null,
			defaultLanguage: restaurant.defaultLanguage ?? null,
		};
	},
});

// =============================================================================
// Internal mutations — every billing field write lands here, and audits
// =============================================================================

/**
 * Stores the platform-side Stripe Customer, first writer wins.
 *
 * Returns the id that is actually persisted, never the caller's: two concurrent
 * checkouts both reach Stripe with the same `billing-customer:<restaurantId>`
 * idempotency key and get the same Customer back, but a caller that raced a
 * different code path must still follow the stored row.
 */
export const attachBillingCustomerInternal = internalMutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		stripeBillingCustomerId: v.string(),
	},
	handler: async (ctx, args): Promise<string> => {
		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant) throw new Error("Restaurant not found");
		if (restaurant.stripeBillingCustomerId) return restaurant.stripeBillingCustomerId;

		await ctx.db.patch(args.restaurantId, {
			stripeBillingCustomerId: args.stripeBillingCustomerId,
			...stampUpdated(AUDIT_SYSTEM_USER_ID),
		});
		return args.stripeBillingCustomerId;
	},
});

/**
 * Single writer for the cached subscription snapshot: id, status, period end
 * and pending cancellation.
 *
 * One mutation rather than an attach/update pair because Stripe does not
 * promise an order — `customer.subscription.created` can land before
 * `checkout.session.completed`, and whichever arrives first must both bind the
 * subscription and cache its status. The audit event follows from the data: the
 * first write that binds a new subscription id is
 * `RESTAURANT_SUBSCRIPTION_CREATED`, every later one is a status change, and an
 * explicit `auditEventType` (used by the cancel action) overrides both.
 */
export const syncSubscriptionInternal = internalMutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		stripeSubscriptionId: v.string(),
		billingStatus: v.string(),
		billingCurrentPeriodEnd: v.optional(v.number()),
		cancelAtPeriodEnd: v.optional(v.boolean()),
		/** Overrides the created/status-changed inference. */
		auditEventType: v.optional(v.string()),
		/** Staff member who asked for the change; system for webhooks. */
		userId: v.optional(v.string()),
	},
	handler: async (ctx, args): Promise<void> => {
		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant) throw new Error("Restaurant not found");

		const isFirstBind = restaurant.stripeSubscriptionId !== args.stripeSubscriptionId;
		const userId = args.userId ?? AUDIT_SYSTEM_USER_ID;

		await ctx.db.patch(args.restaurantId, {
			stripeSubscriptionId: args.stripeSubscriptionId,
			billingStatus: args.billingStatus,
			billingCurrentPeriodEnd: args.billingCurrentPeriodEnd ?? restaurant.billingCurrentPeriodEnd,
			billingCancelAtPeriodEnd:
				args.cancelAtPeriodEnd ??
				(isFirstBind ? false : (restaurant.billingCancelAtPeriodEnd ?? false)),
			...stampUpdated(userId),
		});

		const eventType =
			args.auditEventType ??
			(isFirstBind
				? AUDIT_EVENT.RESTAURANT_SUBSCRIPTION_CREATED
				: AUDIT_EVENT.RESTAURANT_SUBSCRIPTION_STATUS_CHANGED);

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.RESTAURANTS,
			aggregateId: args.restaurantId,
			restaurantId: args.restaurantId,
			eventType,
			payload: {
				stripeSubscriptionId: args.stripeSubscriptionId,
				billingStatus: args.billingStatus,
				previousBillingStatus: restaurant.billingStatus ?? null,
				billingCurrentPeriodEnd: args.billingCurrentPeriodEnd ?? null,
				cancelAtPeriodEnd: args.cancelAtPeriodEnd ?? null,
			},
			userId,
		});
	},
});

/**
 * `customer.subscription.deleted`: the subscription is gone for good. The
 * subscription id is cleared so a fresh checkout can bind a new one, and the
 * per-restaurant flag is left ALONE — whether Tavli still bills this restaurant
 * is an operator decision, not Stripe's.
 */
export const clearSubscriptionInternal = internalMutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		stripeSubscriptionId: v.string(),
		billingStatus: v.optional(v.string()),
	},
	handler: async (ctx, args): Promise<void> => {
		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant) throw new Error("Restaurant not found");

		await ctx.db.patch(args.restaurantId, {
			stripeSubscriptionId: undefined,
			billingStatus: args.billingStatus ?? BILLING_STATUS.CANCELED,
			billingCurrentPeriodEnd: undefined,
			billingCancelAtPeriodEnd: false,
			...stampUpdated(AUDIT_SYSTEM_USER_ID),
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.RESTAURANTS,
			aggregateId: args.restaurantId,
			restaurantId: args.restaurantId,
			eventType: AUDIT_EVENT.RESTAURANT_SUBSCRIPTION_CANCELLED,
			payload: {
				stripeSubscriptionId: args.stripeSubscriptionId,
				billingStatus: args.billingStatus ?? BILLING_STATUS.CANCELED,
			},
			userId: AUDIT_SYSTEM_USER_ID,
		});
	},
});

/**
 * `invoice.paid`. The amount audited is the invoice's own `amount_paid`, never
 * `PLATFORM_MONTHLY_FEE_MXN_CENTS` — proration, coupons and Price changes all
 * make the constant a lie for a specific invoice.
 */
export const recordInvoicePaidInternal = internalMutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		stripeInvoiceId: v.string(),
		invoiceNumber: v.optional(v.string()),
		amountPaidCents: v.number(),
		currency: v.string(),
		periodStart: v.number(),
		periodEnd: v.number(),
		hostedInvoiceUrl: v.optional(v.string()),
	},
	handler: async (ctx, args): Promise<void> => {
		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant) throw new Error("Restaurant not found");

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.RESTAURANTS,
			aggregateId: args.restaurantId,
			restaurantId: args.restaurantId,
			eventType: AUDIT_EVENT.RESTAURANT_SUBSCRIPTION_INVOICE_PAID,
			payload: {
				stripeInvoiceId: args.stripeInvoiceId,
				invoiceNumber: args.invoiceNumber ?? null,
				amountPaidCents: args.amountPaidCents,
				currency: args.currency,
				periodStart: args.periodStart,
				periodEnd: args.periodEnd,
				hostedInvoiceUrl: args.hostedInvoiceUrl ?? null,
			},
			userId: AUDIT_SYSTEM_USER_ID,
			idempotencyKey: `subscription-invoice-paid:${args.stripeInvoiceId}`,
		});
	},
});

/**
 * `invoice.payment_failed`. Marks the restaurant `past_due` so the settings UI
 * asks for a new card, unless Stripe already moved the subscription somewhere
 * terminal (a `canceled` subscription must not be resurrected as `past_due`).
 */
export const recordInvoicePaymentFailedInternal = internalMutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		stripeInvoiceId: v.string(),
		amountDueCents: v.number(),
		currency: v.string(),
		hostedInvoiceUrl: v.optional(v.string()),
	},
	handler: async (ctx, args): Promise<void> => {
		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant) throw new Error("Restaurant not found");

		const terminal: readonly string[] = [
			BILLING_STATUS.CANCELED,
			BILLING_STATUS.INCOMPLETE_EXPIRED,
		];
		if (!terminal.includes(restaurant.billingStatus ?? "")) {
			await ctx.db.patch(args.restaurantId, {
				billingStatus: BILLING_STATUS.PAST_DUE,
				...stampUpdated(AUDIT_SYSTEM_USER_ID),
			});
		}

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.RESTAURANTS,
			aggregateId: args.restaurantId,
			restaurantId: args.restaurantId,
			eventType: AUDIT_EVENT.RESTAURANT_SUBSCRIPTION_PAYMENT_FAILED,
			payload: {
				stripeInvoiceId: args.stripeInvoiceId,
				amountDueCents: args.amountDueCents,
				currency: args.currency,
				hostedInvoiceUrl: args.hostedInvoiceUrl ?? null,
			},
			userId: AUDIT_SYSTEM_USER_ID,
			idempotencyKey: `subscription-invoice-failed:${args.stripeInvoiceId}`,
		});
	},
});

// =============================================================================
// Public mutation — the per-restaurant flag
// =============================================================================

/**
 * Arms or disarms the platform subscription for one restaurant.
 *
 * Platform admins only: this decides whether Tavli bills that restaurant
 * 2,000 MXN/month, which is a commercial decision the restaurant's own owner
 * must not be able to make for themselves. Disarming hides the billing UI and
 * blocks new checkouts; it deliberately does NOT cancel a live subscription —
 * cancelling is `billing.cancelSubscription`, so a mis-click cannot silently
 * stop a paid subscription.
 */
export const setPlatformSubscriptionEnabled = mutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		enabled: v.boolean(),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<Id<"restaurants">, AuthErrors | NotFoundErrorObject> {
		const [userId, authError] = await getCurrentUserId(ctx);
		if (authError) return [null, authError];

		const [, roleError] = await requireAdminRole(ctx, userId);
		if (roleError) return [null, roleError];

		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant || restaurant.deletedAt != null) {
			return [null, new NotFoundError("Restaurant not found").toObject()];
		}

		await ctx.db.patch(args.restaurantId, {
			platformSubscriptionEnabled: args.enabled,
			...stampUpdated(userId),
		});

		return [args.restaurantId, null];
	},
});
