/**
 * Webhook handlers for the platform subscription (ADR 008 / TAVLI-71 Phase 4B).
 *
 * Plain TypeScript functions, not Convex declarations — the same arrangement as
 * `convex/_util/stripe.ts`: `convex/stripe.ts` owns the single verified webhook
 * entry point and delegates each event type here.
 *
 * ---- Routing, and why it is NOT the connect endpoint ----
 *
 * Everything in this file is a **platform-account v1 snapshot event**. The
 * restaurant's subscription is a Stripe Billing object on Tavli's own account,
 * not on the restaurant's connected account, so these events are delivered to
 * `POST /stripe/webhook` (the "fat"/snapshot destination) alongside
 * `payment_intent.*`. `POST /stripe/connect-webhook` takes v2 THIN events for
 * `v2.core.account*` only — a subscription event will never appear there, and
 * subscribing it there would silently never fire.
 *
 * ---- The two fees are not the same thing ----
 *
 * This is the 2,000 MXN/month each restaurant pays Tavli. The 12% a diner pays
 * on an order is `PLATFORM_APPLICATION_FEE_RATE`, charged per PaymentIntent in
 * `convex/stripe.ts`. Nothing here touches an order, a payment row, or a diner.
 */

import type Stripe from "stripe";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { BILLING_STATUS } from "../constants";

/** Minimal shape of the action context these helpers need. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BillingWebhookCtx = any;

/** Stripe expands some references; we only ever want the id. */
function idOf(reference: string | { id: string } | null | undefined): string | null {
	if (!reference) return null;
	return typeof reference === "string" ? reference : reference.id;
}

/**
 * Period end lives on the subscription ITEM since Stripe API 2025-03-31.basil
 * (we pin `2026-05-27.dahlia`); `Subscription.current_period_end` no longer
 * exists. Our subscriptions carry a single item, but taking the max keeps this
 * honest if a second item is ever added.
 */
export function resolveCurrentPeriodEndMs(subscription: Stripe.Subscription): number | undefined {
	const ends = (subscription.items?.data ?? [])
		.map((item) => item.current_period_end)
		.filter((value): value is number => typeof value === "number");
	if (ends.length === 0) return undefined;
	return Math.max(...ends) * 1000;
}

/**
 * Resolves the restaurant a Billing object belongs to, in descending order of
 * trust: the id we stamped into metadata, then the subscription we already
 * stored, then the customer we already stored.
 *
 * Returning `null` is a normal outcome, not an error: the platform Stripe
 * account also carries subscriptions that have nothing to do with Tavli
 * restaurants, and a webhook for one of those must be a benign no-op.
 */
export async function resolveBillingRestaurant(
	ctx: BillingWebhookCtx,
	refs: {
		metadataRestaurantId?: string | null;
		stripeSubscriptionId?: string | null;
		stripeBillingCustomerId?: string | null;
	}
): Promise<Doc<"restaurants"> | null> {
	if (refs.metadataRestaurantId) {
		const byMetadata: Doc<"restaurants"> | null = await ctx.runQuery(
			internal.billingHelpers.getRestaurantByIdStringInternal,
			{ candidateId: refs.metadataRestaurantId }
		);
		if (byMetadata) return byMetadata;
	}

	if (refs.stripeSubscriptionId) {
		const bySubscription: Doc<"restaurants"> | null = await ctx.runQuery(
			internal.billingHelpers.getRestaurantBySubscriptionIdInternal,
			{ stripeSubscriptionId: refs.stripeSubscriptionId }
		);
		if (bySubscription) return bySubscription;
	}

	if (refs.stripeBillingCustomerId) {
		const byCustomer: Doc<"restaurants"> | null = await ctx.runQuery(
			internal.billingHelpers.getRestaurantByBillingCustomerIdInternal,
			{ stripeBillingCustomerId: refs.stripeBillingCustomerId }
		);
		if (byCustomer) return byCustomer;
	}

	return null;
}

/**
 * `checkout.session.completed` — binds the subscription the diner-facing app
 * never sees: this Checkout Session was opened by restaurant staff to pay
 * Tavli. Sessions in any other mode (`payment`, `setup`) belong to someone
 * else's flow and are ignored.
 */
export async function handleSubscriptionCheckoutCompleted(
	ctx: BillingWebhookCtx,
	session: Stripe.Checkout.Session
): Promise<void> {
	if (session.mode !== "subscription") return;

	const stripeSubscriptionId = idOf(session.subscription);
	if (!stripeSubscriptionId) return;

	const restaurant = await resolveBillingRestaurant(ctx, {
		metadataRestaurantId: session.client_reference_id ?? session.metadata?.restaurantId,
		stripeSubscriptionId,
		stripeBillingCustomerId: idOf(session.customer),
	});
	if (!restaurant) return;

	await ctx.runMutation(internal.billingHelpers.syncSubscriptionInternal, {
		restaurantId: restaurant._id as Id<"restaurants">,
		stripeSubscriptionId,
		// The Checkout Session says the subscription exists but not its status;
		// `customer.subscription.created` carries that and lands separately, and
		// Stripe does not guarantee the two arrive in order. So when we have no
		// cached status yet, write the PESSIMISTIC one: a subscription that is
		// really `incomplete` must not be cached as `active` for the window
		// between the two events. `customer.subscription.created/updated` upgrades
		// it the moment it lands.
		billingStatus: restaurant.billingStatus ?? BILLING_STATUS.INCOMPLETE,
	});
}

/**
 * `customer.subscription.created` / `.updated` — caches status, period end and
 * a pending cancellation. `.deleted` is handled by
 * `handleSubscriptionDeleted`: it clears rather than caches.
 */
export async function handleSubscriptionLifecycle(
	ctx: BillingWebhookCtx,
	subscription: Stripe.Subscription
): Promise<void> {
	const restaurant = await resolveBillingRestaurant(ctx, {
		metadataRestaurantId: subscription.metadata?.restaurantId,
		stripeSubscriptionId: subscription.id,
		stripeBillingCustomerId: idOf(subscription.customer),
	});
	if (!restaurant) return;

	await ctx.runMutation(internal.billingHelpers.syncSubscriptionInternal, {
		restaurantId: restaurant._id as Id<"restaurants">,
		stripeSubscriptionId: subscription.id,
		billingStatus: subscription.status,
		billingCurrentPeriodEnd: resolveCurrentPeriodEndMs(subscription),
		cancelAtPeriodEnd: subscription.cancel_at_period_end,
	});
}

/**
 * `customer.subscription.deleted` — the subscription is over. The
 * per-restaurant `platformSubscriptionEnabled` flag is intentionally left
 * untouched: whether Tavli still bills this restaurant is an operator decision.
 */
export async function handleSubscriptionDeleted(
	ctx: BillingWebhookCtx,
	subscription: Stripe.Subscription
): Promise<void> {
	const restaurant = await resolveBillingRestaurant(ctx, {
		metadataRestaurantId: subscription.metadata?.restaurantId,
		stripeSubscriptionId: subscription.id,
		stripeBillingCustomerId: idOf(subscription.customer),
	});
	if (!restaurant) return;

	await ctx.runMutation(internal.billingHelpers.clearSubscriptionInternal, {
		restaurantId: restaurant._id as Id<"restaurants">,
		stripeSubscriptionId: subscription.id,
		billingStatus: subscription.status ?? BILLING_STATUS.CANCELED,
	});
}

/** The subscription an invoice was generated for, or null for one-off invoices. */
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
	const details = invoice.parent?.subscription_details;
	return idOf(details?.subscription ?? null);
}

/**
 * `invoice.paid` — audits the payment and schedules Tavli's own receipt to the
 * restaurant. The amount comes off the INVOICE, never off
 * `PLATFORM_MONTHLY_FEE_MXN_CENTS`: proration and Price changes make the
 * constant wrong for any specific invoice.
 */
export async function handleSubscriptionInvoicePaid(
	ctx: BillingWebhookCtx,
	invoice: Stripe.Invoice
): Promise<void> {
	const stripeSubscriptionId = invoiceSubscriptionId(invoice);
	if (!stripeSubscriptionId) return;

	const restaurant = await resolveBillingRestaurant(ctx, {
		stripeSubscriptionId,
		stripeBillingCustomerId: idOf(invoice.customer),
	});
	if (!restaurant) return;

	const restaurantId = restaurant._id as Id<"restaurants">;
	await ctx.runMutation(internal.billingHelpers.recordInvoicePaidInternal, {
		restaurantId,
		stripeInvoiceId: invoice.id,
		invoiceNumber: invoice.number ?? undefined,
		amountPaidCents: invoice.amount_paid,
		currency: invoice.currency.toUpperCase(),
		periodStart: invoice.period_start * 1000,
		periodEnd: invoice.period_end * 1000,
		hostedInvoiceUrl: invoice.hosted_invoice_url ?? undefined,
	});

	// Scheduled, not awaited: a Resend outage must not fail the webhook and
	// make Stripe redeliver an event we already recorded.
	await ctx.scheduler.runAfter(0, internal.billing.sendPlatformFeeReceiptEmail, {
		restaurantId,
		stripeInvoiceId: invoice.id,
		invoiceNumber: invoice.number ?? undefined,
		amountPaidCents: invoice.amount_paid,
		currency: invoice.currency.toUpperCase(),
		periodStart: invoice.period_start * 1000,
		periodEnd: invoice.period_end * 1000,
		hostedInvoiceUrl: invoice.hosted_invoice_url ?? undefined,
	});
}

/**
 * `invoice.payment_failed` — audits the failure and flips the cached status to
 * `past_due` so the settings UI asks for a new card. Stripe keeps retrying on
 * its own dunning schedule; nothing here retries.
 */
export async function handleSubscriptionInvoicePaymentFailed(
	ctx: BillingWebhookCtx,
	invoice: Stripe.Invoice
): Promise<void> {
	const stripeSubscriptionId = invoiceSubscriptionId(invoice);
	if (!stripeSubscriptionId) return;

	const restaurant = await resolveBillingRestaurant(ctx, {
		stripeSubscriptionId,
		stripeBillingCustomerId: idOf(invoice.customer),
	});
	if (!restaurant) return;

	await ctx.runMutation(internal.billingHelpers.recordInvoicePaymentFailedInternal, {
		restaurantId: restaurant._id as Id<"restaurants">,
		stripeInvoiceId: invoice.id,
		amountDueCents: invoice.amount_due,
		currency: invoice.currency.toUpperCase(),
		hostedInvoiceUrl: invoice.hosted_invoice_url ?? undefined,
	});
}
