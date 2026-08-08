// =============================================================================
// Platform Subscription — Stripe Billing actions (ADR 008 / TAVLI-71 Phase 4B)
// =============================================================================
//
// Tavli charges each restaurant a flat 2,000 MXN/month for using the product,
// behind the per-restaurant `platformSubscriptionEnabled` flag. This is a
// Stripe Billing subscription on TAVLI'S OWN platform account, paid by the
// restaurant.
//
// It is **not** the 12% service fee a diner pays on an order. That fee is
// `PLATFORM_APPLICATION_FEE_RATE`, collected per PaymentIntent as an
// application fee on a destination charge (`convex/stripe.ts`). Two different
// payers, two different money paths — never conflate them in code or copy.
//
// ---- Required environment variables (Convex deployment env) ----
//
//   STRIPE_SECRET_KEY              - platform secret key (shared with stripe.ts)
//   STRIPE_PLATFORM_FEE_PRICE_ID   - the recurring monthly Price id for the
//                                    2,000 MXN plan. Dev and production are
//                                    SEPARATE Stripe accounts, so this differs
//                                    per deployment. See
//                                    documentation/runbooks/stripe-go-live.md.
//   RESEND_API_KEY / RESEND_FROM_ADDRESS - receipt delivery
//
// ---- Webhooks ----
//
// The subscription lifecycle arrives on the EXISTING snapshot destination
// `POST /stripe/webhook` (see `convex/stripe.ts#fulfillPayment` and
// `convex/_util/billing.ts`). Not the v2 thin connect destination.
//
// Split from `convex/billingHelpers.ts` because the Stripe SDK forces this
// module into the Node runtime, which cannot host queries or mutations.
// =============================================================================

"use node";

import { v } from "convex/values";
import type Stripe from "stripe";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { action, internalAction } from "./_generated/server";
import { AUDIT_EVENT, isLiveBillingStatus, TABLE } from "./constants";
import { ConflictError, fromErrorObject, NotAuthenticatedError } from "./_shared/errors";
import {
	buildIntegrationErrorLog,
	parseResendErrorSummary,
	redactExternalId,
} from "./_shared/integrationLogging";
import { resolveCurrentPeriodEndMs } from "./_util/billing";
import { getAppUrl, getStripePlatformFeePriceId } from "./_util/env";
import { getStripeClient, requireStripeRestaurantAccess } from "./_util/stripe";
import { resolveInviteLocale } from "./emails/locale";
import { renderPlatformFeeReceiptEmail } from "./emails/renderPlatformFeeReceiptEmail";

/** Stable codes this module surfaces; mapped to copy in `src/global/i18n/keys/errors.ts`. */
export const BILLING_ERRORS = {
	/** The restaurant is not on the platform subscription (flag off). */
	NOT_ENABLED: "ERROR_BILLING_NOT_ENABLED",
	/** A live subscription already exists — a second checkout would double-bill. */
	SUBSCRIPTION_EXISTS: "ERROR_BILLING_SUBSCRIPTION_EXISTS",
	/** Nothing to cancel. */
	NO_SUBSCRIPTION: "ERROR_BILLING_NO_SUBSCRIPTION",
	/** Stripe returned a session without a redirect URL. */
	CHECKOUT_FAILED: "ERROR_BILLING_CHECKOUT_FAILED",
} as const;

/**
 * Where Stripe sends the browser back to. Built server-side from `getAppUrl()`
 * rather than taken as an argument: a caller-supplied `success_url` is an open
 * redirect, and this flow has exactly one sensible destination — the Billing
 * block of the restaurant's settings canvas.
 */
function buildReturnUrls(restaurantId: string): { successUrl: string; cancelUrl: string } {
	const base = `${getAppUrl()}/admin/restaurants?settings=${encodeURIComponent(restaurantId)}`;
	return {
		successUrl: `${base}&billing=success`,
		cancelUrl: `${base}&billing=cancelled`,
	};
}

/**
 * Get-or-create the restaurant's PLATFORM-side Stripe Customer.
 *
 * Distinct from `stripeCustomers` (`_util/stripe.ts#getOrCreateStripeCustomerId`),
 * which holds a DINER's Customer for card-on-file. This one is the restaurant
 * as Tavli's paying customer, and lives on `restaurants.stripeBillingCustomerId`.
 *
 * Race-safe twice over, like its diner counterpart: the
 * `billing-customer:<restaurantId>` idempotency key makes two concurrent
 * `customers.create` calls return the same Customer, and the mutation lets the
 * first stored row win — so the caller must use the id returned here.
 */
async function getOrCreateBillingCustomerId(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	ctx: any,
	stripeClient: Stripe,
	restaurant: Doc<"restaurants">
): Promise<string> {
	if (restaurant.stripeBillingCustomerId) return restaurant.stripeBillingCustomerId;

	const customer: Stripe.Customer = await stripeClient.customers.create(
		{
			name: restaurant.name,
			email: restaurant.supportEmail?.trim() || undefined,
			metadata: { restaurantId: restaurant._id },
		},
		{ idempotencyKey: `billing-customer:${restaurant._id}` }
	);

	return await ctx.runMutation(internal.billingHelpers.attachBillingCustomerInternal, {
		restaurantId: restaurant._id,
		stripeBillingCustomerId: customer.id,
	});
}

// =============================================================================
// 1. Start the subscription
// =============================================================================

/**
 * Opens a Stripe-hosted Checkout Session in `subscription` mode for the monthly
 * platform fee and returns its URL.
 *
 * Guarded by `requireStripeRestaurantAccess` — the same owner-or-platform-admin
 * check the Connect onboarding actions use — because this commits the
 * restaurant to a recurring charge.
 *
 * The Price comes from `STRIPE_PLATFORM_FEE_PRICE_ID`, not from
 * `PLATFORM_MONTHLY_FEE_MXN_CENTS`: the constant is display copy, the Stripe
 * Price is what gets charged.
 *
 * TODO(TAVLI-71): swapping the card on a LIVE subscription needs a Stripe
 * Billing Portal session (`billingPortal.sessions.create`), not this action —
 * a second Checkout would create a second subscription, which is exactly what
 * the `ERROR_BILLING_SUBSCRIPTION_EXISTS` guard below refuses. Until then a
 * `past_due` restaurant pays through the hosted invoice link Stripe emails.
 */
export const createSubscriptionCheckout = action({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
	},
	handler: async (ctx, args): Promise<{ url: string }> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw fromErrorObject(new NotAuthenticatedError().toObject());

		const restaurant = await requireStripeRestaurantAccess(ctx, args.restaurantId);

		if (!restaurant.platformSubscriptionEnabled) {
			throw fromErrorObject(new ConflictError(BILLING_ERRORS.NOT_ENABLED).toObject());
		}

		// A restaurant that already pays must not be able to start a second
		// subscription; fixing a failed card is a payment-method update, not a
		// new plan.
		if (restaurant.stripeSubscriptionId && isLiveBillingStatus(restaurant.billingStatus)) {
			throw fromErrorObject(new ConflictError(BILLING_ERRORS.SUBSCRIPTION_EXISTS).toObject());
		}

		// Throws ERROR_BILLING_PRICE_NOT_CONFIGURED when the deployment has no Price.
		const priceId = getStripePlatformFeePriceId();
		const { successUrl, cancelUrl } = buildReturnUrls(args.restaurantId);

		const stripeClient = getStripeClient();
		const customerId = await getOrCreateBillingCustomerId(ctx, stripeClient, restaurant);

		try {
			const session = await stripeClient.checkout.sessions.create({
				mode: "subscription",
				customer: customerId,
				line_items: [{ price: priceId, quantity: 1 }],
				success_url: successUrl,
				cancel_url: cancelUrl,
				// Both stamped so every later webhook — session, subscription and
				// invoice — can name the restaurant without a lookup table.
				client_reference_id: args.restaurantId,
				metadata: { restaurantId: args.restaurantId },
				subscription_data: { metadata: { restaurantId: args.restaurantId } },
			});

			if (!session.url) {
				throw fromErrorObject(new ConflictError(BILLING_ERRORS.CHECKOUT_FAILED).toObject());
			}
			return { url: session.url };
		} catch (error) {
			console.error(
				"[billing.createSubscriptionCheckout]",
				buildIntegrationErrorLog(error, {
					integration: "stripe-billing",
					operation: "checkout.sessions.create",
					restaurantId: args.restaurantId,
				})
			);
			throw error;
		}
	},
});

// =============================================================================
// 2. Cancel at period end
// =============================================================================

/**
 * Schedules the subscription to stop at the end of the paid period.
 *
 * Deliberately NOT an immediate cancel: the restaurant paid for this month, so
 * they keep the month. Stripe answers with the updated subscription, which is
 * cached straight away so the settings UI shows the pending cancellation
 * without waiting for the `customer.subscription.updated` webhook.
 */
export const cancelSubscription = action({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
	},
	handler: async (
		ctx,
		args
	): Promise<{ cancelAtPeriodEnd: boolean; currentPeriodEnd: number | null }> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw fromErrorObject(new NotAuthenticatedError().toObject());

		const restaurant = await requireStripeRestaurantAccess(ctx, args.restaurantId);

		const subscriptionId = restaurant.stripeSubscriptionId;
		if (!subscriptionId) {
			throw fromErrorObject(new ConflictError(BILLING_ERRORS.NO_SUBSCRIPTION).toObject());
		}

		const stripeClient = getStripeClient();
		let subscription: Stripe.Subscription;
		try {
			subscription = await stripeClient.subscriptions.update(subscriptionId, {
				cancel_at_period_end: true,
			});
		} catch (error) {
			console.error(
				"[billing.cancelSubscription]",
				buildIntegrationErrorLog(error, {
					integration: "stripe-billing",
					operation: "subscriptions.update",
					restaurantId: args.restaurantId,
				})
			);
			throw error;
		}

		const currentPeriodEnd = resolveCurrentPeriodEndMs(subscription);
		await ctx.runMutation(internal.billingHelpers.syncSubscriptionInternal, {
			restaurantId: args.restaurantId,
			stripeSubscriptionId: subscription.id,
			billingStatus: subscription.status,
			billingCurrentPeriodEnd: currentPeriodEnd,
			cancelAtPeriodEnd: subscription.cancel_at_period_end,
			auditEventType: AUDIT_EVENT.RESTAURANT_SUBSCRIPTION_CANCEL_SCHEDULED,
			userId: identity.subject,
		});

		return {
			cancelAtPeriodEnd: subscription.cancel_at_period_end,
			currentPeriodEnd: currentPeriodEnd ?? null,
		};
	},
});

// =============================================================================
// 3. Tavli's own receipt for a paid invoice
// =============================================================================

/**
 * Emails the restaurant Tavli's receipt for a paid platform-fee invoice.
 * Scheduled by the `invoice.paid` webhook handler — never called from the UI.
 *
 * Unlike the diner receipt (branded as the restaurant, sent via Tavli), this
 * one IS from Tavli: Tavli is the issuer and the restaurant is the customer.
 *
 * Recipient: the restaurant's `supportEmail`, falling back to the owner's email
 * from `userRoles`. When neither exists the send is skipped and logged — there
 * is deliberately no hardcoded fallback address.
 */
export const sendPlatformFeeReceiptEmail = internalAction({
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
		const context = await ctx.runQuery(internal.billingHelpers.getBillingEmailContextInternal, {
			restaurantId: args.restaurantId,
		});
		if (!context || !context.recipient) {
			console.warn(
				"[billing.sendPlatformFeeReceiptEmail] no recipient (supportEmail and owner email both unset)",
				{ restaurantId: redactExternalId(args.restaurantId) }
			);
			return;
		}

		const apiKey = process.env.RESEND_API_KEY;
		const from = process.env.RESEND_FROM_ADDRESS ?? process.env.RESEND_FROM;
		if (!apiKey || !from) {
			console.warn("[billing.sendPlatformFeeReceiptEmail] RESEND_API_KEY or RESEND_FROM missing.");
			return;
		}

		const { subject, html, text } = await renderPlatformFeeReceiptEmail({
			locale: resolveInviteLocale(context.defaultLanguage),
			restaurantName: context.restaurantName,
			invoiceNumber: args.invoiceNumber ?? null,
			amountPaidCents: args.amountPaidCents,
			currency: args.currency,
			periodStartMs: args.periodStart,
			periodEndMs: args.periodEnd,
			hostedInvoiceUrl: args.hostedInvoiceUrl ?? null,
		});

		const res = await fetch("https://api.resend.com/emails", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ from, to: [context.recipient], subject, html, text }),
		});

		if (!res.ok) {
			// Fire-and-forget like the invite email: the invoice is already
			// audited, and throwing here would make Stripe redeliver the webhook.
			const responseText = await res.text();
			console.error("[billing.sendPlatformFeeReceiptEmail] Resend error:", {
				integration: "resend",
				operation: "sendPlatformFeeReceiptEmail",
				stripeInvoiceId: redactExternalId(args.stripeInvoiceId),
				...parseResendErrorSummary(res.status, responseText),
			});
		}
	},
});
