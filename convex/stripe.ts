// =============================================================================
// Stripe Connect V2 Integration
// =============================================================================
//
// This module implements a Stripe Connect integration using the V2 Accounts API.
// It covers:
//   1. Creating Connected Accounts (V2) with platform-managed fees/losses
//   2. Onboarding via V2 Account Links
//   3. Checking account status via V2 Accounts retrieve
//   4. Listening for V2 thin events (requirements & capability changes)
//   5. PaymentIntent-backed checkout for restaurant orders
//   6. Refunds for cancelled orders
//
// ---- Required Environment Variables (set in Convex Dashboard) ----
//
//   STRIPE_SECRET_KEY            - Your Stripe platform secret key (sk_test_... or sk_live_...).
//                                  Find it at https://dashboard.stripe.com/apikeys
//
//   STRIPE_WEBHOOK_SECRET        - Webhook signing secret for payment events
//                                  (payment_intent.succeeded, payment_intent.payment_failed).
//                                  Created when you add a webhook endpoint in the Stripe Dashboard
//                                  or via `stripe listen --forward-to <url>`.
//
//   STRIPE_CONNECT_WEBHOOK_SECRET - Webhook signing secret for V2 thin events
//                                   (account requirements & capability changes).
//                                   Created when you add a thin-event destination in the Dashboard.
//
// ---- Local Development: Forwarding Webhooks ----
//
//   For payment webhooks:
//     stripe listen --forward-to http://localhost:3210/stripe/webhook
//
//   For V2 thin events (connected account changes):
//     stripe listen --thin-events \
//       'v2.core.account[requirements].updated,v2.core.account[.recipient].capability_status_updated' \
//       --forward-thin-to http://localhost:3210/stripe/connect-webhook
//
// =============================================================================

"use node";

import { v } from "convex/values";
import type Stripe from "stripe";
import { api, internal } from "./_generated/api";
import { computeOrderCharge } from "./_shared/tip";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalAction } from "./_generated/server";
import {
	AUDIT_SYSTEM_USER_ID,
	ORDER_PAYMENT_STATE,
	ORDER_STATUS,
	PAYMENT_FAILURE_CODE,
	PAYMENT_KIND,
	PAYMENT_REFUND_STATUS,
	PAYMENT_STATUS,
	PLATFORM_APPLICATION_FEE_RATE,
	TAB_RECONCILE_ALERT_AGE_MS,
	TAB_RECONCILE_MIN_AGE_MS,
	TABLE,
} from "./constants";
import {
	ConflictError,
	type ConflictErrorObject,
	fromErrorObject,
	NotAuthenticatedError,
	type NotAuthenticatedErrorObject,
	NotAuthorizedError,
	type NotAuthorizedErrorObject,
	type NotFoundErrorObject,
} from "./_shared/errors";
import { buildIntegrationErrorLog, redactExternalId } from "./_shared/integrationLogging";
import type { AsyncReturn } from "./_shared/types";
import {
	buildLineRefundIdempotencyKey,
	computeLineRefundAmount,
	ORDER_REFUND_BLOCK_REASON,
	type OrderRefundBlockReason,
} from "./orderRefundHelpers";
import { decideTabReconciliation } from "./sessionHelpers";
import {
	handleSubscriptionCheckoutCompleted,
	handleSubscriptionDeleted,
	handleSubscriptionInvoicePaid,
	handleSubscriptionInvoicePaymentFailed,
	handleSubscriptionLifecycle,
} from "./_util/billing";
import { DINER_SESSION_ERRORS } from "./_util/dinerSession";
import { getDeploymentMarker } from "./_util/env";
import {
	getOrCreateStripeCustomerId,
	getStripeClient,
	handleAccountStatusChange,
	handleChargeDisputeClosed,
	handleChargeDisputeCreated,
	handleChargeRefunded,
	handlePaymentIntentFailure,
	handlePaymentIntentSuccess,
	inferV2AccountStatus,
	requireStripeRestaurantAccess,
} from "./_util/stripe";

// =============================================================================
// 1. Connected Account Creation (V2 API)
// =============================================================================

/**
 * Creates a new Stripe Connected Account using the V2 Accounts API.
 *
 * Key design decisions:
 * - Uses `dashboard: 'express'` so the connected account gets a Stripe-hosted dashboard.
 * - The platform is responsible for both fee collection and loss coverage
 *   (`fees_collector: 'application'`, `losses_collector: 'application'`).
 * - Requests the `stripe_transfers` capability under `recipient` configuration
 *   so the connected account can receive transfers from the platform.
 * - Does NOT pass a top-level `type` — the V2 API determines the account type
 *   from the configuration provided.
 *
 * If the restaurant already has a Stripe account, it returns the existing ID
 * without creating a duplicate.
 */
export const createConnectAccount = action({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
	},
	handler: async (ctx, args): Promise<{ stripeAccountId: string }> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw fromErrorObject(new NotAuthenticatedError().toObject());

		const restaurant = await requireStripeRestaurantAccess(ctx, args.restaurantId);

		if (restaurant.stripeAccountId) {
			return { stripeAccountId: restaurant.stripeAccountId };
		}

		const stripeClient = getStripeClient();
		const account = await stripeClient.v2.core.accounts.create({
			display_name: restaurant.name,
			contact_email: identity.email ?? "",
			identity: { country: "mx" },
			dashboard: "express",
			defaults: {
				responsibilities: {
					fees_collector: "application",
					losses_collector: "application",
				},
			},
			configuration: {
				merchant: {
					capabilities: {
						card_payments: { requested: true },
					},
				},
				recipient: {
					capabilities: {
						stripe_balance: {
							stripe_transfers: { requested: true },
						},
					},
				},
			},
		});

		await ctx.runMutation(internal.stripeHelpers.saveStripeAccountId, {
			restaurantId: args.restaurantId,
			stripeAccountId: account.id,
		});

		return { stripeAccountId: account.id };
	},
});

/**
 * Disconnects a restaurant from its Stripe Connected Account so onboarding
 * can be restarted from scratch (e.g. to recover from a partially-completed
 * flow that picked the wrong country, since Stripe locks the account country
 * after creation).
 *
 * Best-effort closes the Stripe account via `v2.core.accounts.close` passing
 * every configuration the account was created with. If Stripe rejects the
 * close (already closed, network error, etc.) we still clear the Convex link
 * so the user can retry, and surface `closedStripeAccount: false` to the UI.
 *
 * The caller will then see `connected: false` from `getAccountStatus` and the
 * UI re-renders the "Onboard to collect payments" button.
 */
export const resetStripeConnection = action({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
	},
	handler: async (
		ctx,
		args
	): Promise<{ closedStripeAccount: boolean; closedStripeAccountId: string | null }> => {
		const restaurant = await requireStripeRestaurantAccess(ctx, args.restaurantId);

		if (!restaurant.stripeAccountId) {
			return { closedStripeAccount: false, closedStripeAccountId: null };
		}

		let closedStripeAccount = false;
		try {
			const stripeClient = getStripeClient();
			await stripeClient.v2.core.accounts.close(restaurant.stripeAccountId, {
				applied_configurations: ["merchant", "recipient"],
			});
			closedStripeAccount = true;
		} catch (err) {
			console.error(
				"[stripe.resetStripeConnection]",
				buildIntegrationErrorLog(err, {
					integration: "stripe",
					operation: "closeAccount",
					eventId: restaurant.stripeAccountId,
				})
			);
		}

		await ctx.runMutation(internal.stripeHelpers.clearStripeConnection, {
			restaurantId: args.restaurantId,
		});

		return {
			closedStripeAccount,
			closedStripeAccountId: restaurant.stripeAccountId,
		};
	},
});

// =============================================================================
// 2. Account Onboarding via V2 Account Links
// =============================================================================

/**
 * Creates an Account Link that redirects the restaurant owner to Stripe's
 * hosted onboarding flow. Uses the V2 Account Links API.
 *
 * The `use_case` specifies:
 * - `type: 'account_onboarding'` — this is for initial onboarding
 * - `configurations: ['recipient']` — matches the configuration we set during
 *   account creation so Stripe collects the right information
 * - `refresh_url` — where Stripe redirects if the link expires
 * - `return_url` — where Stripe redirects after the user completes onboarding
 *   (includes accountId as a query param so we can refresh status)
 */
export const createAccountLink = action({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		returnUrl: v.string(),
		refreshUrl: v.string(),
	},
	handler: async (ctx, args) => {
		const restaurant = await requireStripeRestaurantAccess(ctx, args.restaurantId);
		if (!restaurant?.stripeAccountId) {
			throw new Error("Restaurant has no Stripe account. Create one first.");
		}

		const stripeClient = getStripeClient();
		const returnUrl = new URL(args.returnUrl);
		returnUrl.searchParams.set("accountId", restaurant.stripeAccountId);

		const accountLink = await stripeClient.v2.core.accountLinks.create({
			account: restaurant.stripeAccountId,
			use_case: {
				type: "account_onboarding",
				account_onboarding: {
					configurations: ["recipient", "merchant"],
					refresh_url: args.refreshUrl,
					return_url: returnUrl.toString(),
				},
			},
		});

		return { url: accountLink.url };
	},
});

// =============================================================================
// 3. Account Status Check (V2 API)
// =============================================================================

/**
 * Retrieves the current status of a connected account using the V2 API.
 *
 * Returns a status object the frontend uses to decide what to show:
 * - `connected` — whether a Stripe account exists at all
 * - `readyToReceivePayments` — the stripe_transfers capability is "active"
 * - `onboardingComplete` — no outstanding "currently_due" or "past_due" requirements
 * - `requirementsStatus` — raw status string for display (e.g. "currently_due")
 *
 * Per the plan, we always fetch status from the API directly rather than
 * relying on cached DB values, ensuring the UI reflects the latest state.
 */
export const getAccountStatus = action({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
	},
	handler: async (ctx, args) => {
		const restaurant = await requireStripeRestaurantAccess(ctx, args.restaurantId);
		if (!restaurant?.stripeAccountId) {
			return {
				connected: false,
				readyToReceivePayments: false,
				onboardingComplete: false,
				requirementsStatus: null as string | null,
			};
		}

		const stripeClient = getStripeClient();
		const { readyToReceivePayments, requirementsStatus, onboardingComplete, isComplete } =
			await inferV2AccountStatus(stripeClient, restaurant.stripeAccountId);

		if (isComplete !== restaurant.stripeOnboardingComplete) {
			await ctx.runMutation(internal.stripeHelpers.updateOnboardingStatus, {
				restaurantId: args.restaurantId,
				stripeOnboardingComplete: isComplete,
			});
		}

		return {
			connected: true,
			readyToReceivePayments,
			onboardingComplete,
			requirementsStatus,
		};
	},
});

// =============================================================================
// 4. V2 Thin Events Webhook Handler
// =============================================================================

/**
 * Handles V2 "thin" webhook events for connected account changes.
 *
 * Thin events contain only a reference (event ID + type), not the full payload.
 * To get the details, we must fetch the full event from Stripe using
 * `stripeClient.v2.core.events.retrieve()`.
 *
 * We handle two event types:
 *
 * 1. `v2.core.account[requirements].updated`
 *    Fired when an account's requirements change (e.g. regulators add new
 *    verification needs). We re-check the requirements status and update
 *    our DB accordingly.
 *
 * 2. `v2.core.account[configuration.recipient].capability_status_updated`
 *    Fired when a capability's status changes (e.g. stripe_transfers goes
 *    from "pending" to "active"). We check if the account is now ready
 *    to receive payments.
 *
 * Setup in Stripe Dashboard:
 *   1. Go to Developers > Webhooks > + Add destination
 *   2. In "Events from", select "Connected accounts"
 *   3. Select "Show advanced options" > Payload style: "Thin"
 *   4. Search for "v2" events and select the two types above
 */
export const handleThinEvent = internalAction({
	args: {
		payloadString: v.string(),
		signatureHeader: v.string(),
	},
	handler: async (ctx, args) => {
		const stripeClient = getStripeClient();

		// PLACEHOLDER: Set STRIPE_CONNECT_WEBHOOK_SECRET in your Convex Dashboard.
		// This is the signing secret for your thin-event webhook endpoint,
		// separate from the standard webhook secret.
		const webhookSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
		if (!webhookSecret) {
			throw new Error(
				"STRIPE_CONNECT_WEBHOOK_SECRET is not set. " +
					"Add it to your Convex deployment environment variables. " +
					"You get this secret when creating a webhook endpoint in the Stripe Dashboard."
			);
		}

		let eventNotification: ReturnType<typeof stripeClient.parseEventNotification>;
		try {
			eventNotification = stripeClient.parseEventNotification(
				args.payloadString,
				args.signatureHeader,
				webhookSecret
			);
		} catch (error) {
			console.error(
				"[stripe.handleThinEvent]",
				buildIntegrationErrorLog(error, {
					integration: "stripe-connect-webhook",
					operation: "parseEventNotification",
				})
			);
			throw error;
		}

		try {
			switch (eventNotification.type) {
				case "v2.core.account[requirements].updated":
				case "v2.core.account[configuration.recipient].capability_status_updated": {
					const accountId = eventNotification.related_object?.id;
					if (accountId) {
						await handleAccountStatusChange(ctx, stripeClient, accountId);
					}
					break;
				}
				default: {
					console.log(`Unhandled thin event type: ${eventNotification.type}`);
				}
			}
		} catch (error) {
			console.error(
				"[stripe.handleThinEvent]",
				buildIntegrationErrorLog(error, {
					integration: "stripe-connect-webhook",
					operation: "processEvent",
					eventType: eventNotification.type,
					eventId: eventNotification.id,
				})
			);
			throw error;
		}
	},
});

// =============================================================================
// 5. Standard Webhook Handler (Payment Events)
// =============================================================================

/**
 * Handles standard Stripe webhook events for payment processing.
 *
 * Listens for:
 * - `payment_intent.succeeded` — a payment intent was confirmed
 * - `payment_intent.payment_failed` — a payment intent failed
 * - `charge.refunded` — a charge was fully or partially refunded (app- or
 *   dashboard-initiated); records refund facts on the payment
 * - `charge.dispute.created` — a chargeback was opened; records dispute facts
 * - `charge.dispute.closed` — a chargeback was resolved; updates dispute facts
 * - `account.updated` — legacy V1 account status updates
 * - `checkout.session.completed` — a restaurant finished platform-subscription
 *   checkout (`mode: "subscription"`); binds the subscription
 * - `customer.subscription.created` / `.updated` / `.deleted` — platform
 *   subscription lifecycle; caches status and period end
 * - `invoice.paid` / `invoice.payment_failed` — platform-subscription billing;
 *   audits and (on paid) schedules Tavli's receipt to the restaurant
 *
 * The last six are the 2,000 MXN/month platform subscription (ADR 008), not the
 * diner-paid 12% service fee — see `convex/_util/billing.ts`.
 *
 * These event types must be enabled on the standard webhook destination in the
 * Stripe Dashboard (ties into TAVLI-46). Because our checkout uses destination
 * charges with the platform as losses_collector, refund/dispute events are
 * platform-account events delivered here rather than to the V2 connect endpoint.
 *
 * Each event is recorded in `stripeWebhookEvents` so duplicate deliveries
 * are no-ops.
 */
export const fulfillPayment = internalAction({
	args: {
		payloadString: v.string(),
		signatureHeader: v.string(),
	},
	handler: async (ctx, args) => {
		const stripeClient = getStripeClient();

		// PLACEHOLDER: Set STRIPE_WEBHOOK_SECRET in your Convex Dashboard.
		// You get this when creating a webhook endpoint or running `stripe listen`.
		const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
		if (!webhookSecret) {
			throw new Error(
				"STRIPE_WEBHOOK_SECRET is not set. " +
					"Add it to your Convex deployment environment variables. " +
					"You get this secret when creating a webhook endpoint or running `stripe listen`."
			);
		}

		let event: Stripe.Event;
		try {
			event = stripeClient.webhooks.constructEvent(
				args.payloadString,
				args.signatureHeader,
				webhookSecret
			);
		} catch (error) {
			console.error(
				"[stripe.fulfillPayment]",
				buildIntegrationErrorLog(error, {
					integration: "stripe-webhook",
					operation: "constructEvent",
				})
			);
			throw error;
		}

		try {
			const processedEvent = await ctx.runQuery(
				internal.stripeHelpers.getProcessedStripeWebhookEventInternal,
				{
					eventId: event.id,
				}
			);
			if (processedEvent) {
				return;
			}

			let paymentId: Id<"payments"> | undefined;

			// =================================================================
			// IDEMPOTENCY INVARIANT — read before adding a case below.
			//
			// The `stripeWebhookEvents` dedup above is CHECK-THEN-ACT ACROSS
			// TRANSACTIONS: the `getProcessedStripeWebhookEventInternal` query
			// and the `recordStripeWebhookEvent` mutation at the end of this
			// handler are separate transactions, with every handler's work in
			// between. Two deliveries of the same event that overlap in that
			// window therefore BOTH see no dedup row and BOTH dispatch. Stripe
			// retries on any non-2xx for days, and an action that fails after a
			// partial success is retried too, so this is a real interleaving,
			// not a theoretical one. The dedup row narrows the window; it does
			// not close it.
			//
			// So idempotency lives in the handlers, and EVERY handler must be
			// idempotent in its own right. For the payment paths that means an
			// early return when the payment row is already in a terminal state
			// (`SUCCEEDED` / `FAILED`) rather than re-applying the transition:
			// `orders.confirmPayment`, `sessions.confirmTabPayment` and
			// `payments.confirmTipPayment` each open with that check, and
			// `appendAuditEvent` is additionally keyed on the PaymentIntent id
			// so a settlement cannot be audited twice.
			//
			// ANY NEW CASE ADDED HERE MUST KEEP THAT PROPERTY. Re-running a
			// handler must be observably a no-op, not a second charge recorded,
			// a second refund persisted, a second order number burned, or a
			// second email scheduled. Where the work is not naturally
			// idempotent, guard it on a terminal state or an idempotency key —
			// do not assume this switch runs once per event.
			// =================================================================
			switch (event.type) {
				case "payment_intent.succeeded": {
					paymentId = await handlePaymentIntentSuccess(ctx, event.data.object);
					break;
				}

				case "payment_intent.payment_failed": {
					paymentId = await handlePaymentIntentFailure(ctx, event.data.object);
					break;
				}

				// Destination charges live on the platform account and the platform is
				// the losses_collector, so refunds and disputes settle against the
				// platform balance and their events arrive HERE (not the V2 connect
				// thin-event endpoint). See convex/stripeWebhookHelpers.ts.
				case "charge.refunded": {
					paymentId = await handleChargeRefunded(ctx, event.data.object, event.id);
					break;
				}

				case "charge.dispute.created": {
					paymentId = await handleChargeDisputeCreated(
						ctx,
						event.data.object,
						event.id,
						event.created * 1000
					);
					break;
				}

				case "charge.dispute.closed": {
					paymentId = await handleChargeDisputeClosed(
						ctx,
						event.data.object,
						event.id,
						event.created * 1000
					);
					break;
				}

				// -----------------------------------------------------------------
				// Platform subscription (ADR 008 / TAVLI-71 Phase 4B).
				// These are Stripe Billing objects on TAVLI'S OWN account — the
				// 2,000 MXN/month a restaurant pays us — so they are v1 snapshot
				// events and belong on THIS destination, never on the v2 thin
				// connect endpoint. They carry no `payments` row, so `paymentId`
				// stays undefined and the dedup record is written on event id
				// alone. See convex/_util/billing.ts.
				// -----------------------------------------------------------------
				case "checkout.session.completed": {
					await handleSubscriptionCheckoutCompleted(ctx, event.data.object);
					break;
				}

				case "customer.subscription.created":
				case "customer.subscription.updated": {
					await handleSubscriptionLifecycle(ctx, event.data.object);
					break;
				}

				case "customer.subscription.deleted": {
					await handleSubscriptionDeleted(ctx, event.data.object);
					break;
				}

				case "invoice.paid": {
					await handleSubscriptionInvoicePaid(ctx, event.data.object);
					break;
				}

				case "invoice.payment_failed": {
					await handleSubscriptionInvoicePaymentFailed(ctx, event.data.object);
					break;
				}

				case "account.updated": {
					// Legacy V1 account update event — kept for backward compatibility
					const account = event.data.object;
					const isComplete = !!(
						"charges_enabled" in account &&
						account.charges_enabled &&
						"payouts_enabled" in account &&
						account.payouts_enabled
					);
					await ctx.runMutation(internal.stripeHelpers.updateOnboardingByAccountId, {
						stripeAccountId: account.id,
						stripeOnboardingComplete: isComplete,
					});
					break;
				}
			}

			// The dedup row is written even when nothing was settled, and that is
			// deliberate (TAVLI-105). An event we could not place is not a
			// transient failure: the handlers looked for the payment row by
			// `stripePaymentIntentId` AND by `metadata.paymentId`, so a redelivery
			// would ask the same two questions and get the same two answers, for
			// as long as Stripe keeps trying (days). Withholding the row to force
			// retries buys nothing and hides the real ones behind a permanent 500.
			//
			// What used to make this dangerous was that recording the event was
			// also the END of it — a tip charge that beat its own webhook was
			// dropped here in silence. It is no longer silent: an intent carrying a
			// `paymentId` we stamped that cannot be placed raises a severe
			// `charge_unmatched` alert (money taken with no record), and an intent
			// with no `paymentId` at all — somebody else's, on shared test keys —
			// is logged and ignored. See `resolvePaymentForIntent`.
			await ctx.runMutation(internal.stripeHelpers.recordStripeWebhookEvent, {
				eventId: event.id,
				eventType: event.type,
				paymentId,
			});
		} catch (error) {
			console.error(
				"[stripe.fulfillPayment]",
				buildIntegrationErrorLog(error, {
					integration: "stripe-webhook",
					operation: "processEvent",
					eventType: event.type,
					eventId: event.id,
				})
			);
			throw error;
		}
	},
});

// =============================================================================
// 6. Refund
// =============================================================================

/**
 * Refunds a PaymentIntent, in full or in part.
 *
 * A tab payment covers several orders, so cancelling one of them refunds only
 * that order's share — hence the optional `amount` and the caller-supplied
 * idempotency key. Legacy per-order payments call this with neither and get the
 * original full-refund behaviour.
 *
 * `reverse_transfer` and `refund_application_fee` stay `true` for partials:
 * Stripe reverses the transfer and refunds the application fee **proportionally
 * to the refunded amount**, and requires the two together for destination
 * charges. Note this proportional behaviour does *not* hold for multicapture
 * PaymentIntents — we never set `capture_method: "manual"`, and enabling it
 * would silently break partial refunds here.
 */
export const createRefund = internalAction({
	args: {
		paymentId: v.id(TABLE.PAYMENTS),
		/** Order whose share is refunded. Required for tab payments, which carry no `orderId`. */
		orderId: v.optional(v.id(TABLE.ORDERS)),
		/** Smallest currency unit. Omit for a full refund. */
		amount: v.optional(v.number()),
		/** Defaults to the legacy payment-scoped key. */
		idempotencyKey: v.optional(v.string()),
		/**
		 * Leave `order.paymentState` alone (ADR 008 line refunds). A single
		 * removed line refunds while the order keeps cooking, so flipping the order
		 * through refund_requested → refunded here would be wrong; the caller
		 * (`refundOrderItem`) records per-line outcome itself. Payment-level
		 * refund fields are still maintained either way.
		 */
		skipOrderStatePatch: v.optional(v.boolean()),
	},
	handler: async (
		ctx,
		args
	): Promise<{ refundId: string; status: string | null; amount: number }> => {
		const payment: Doc<"payments"> | null = await ctx.runQuery(
			internal.stripeHelpers.getPaymentInternal,
			{
				paymentId: args.paymentId,
			}
		);
		if (!payment?.stripePaymentIntentId) {
			throw new Error("Payment does not have a Stripe payment intent");
		}
		const targetOrderId = args.orderId ?? payment.orderId;
		if (!targetOrderId) {
			throw new Error("Refund requires an order: payment has no orderId and none was supplied");
		}
		const patchOrderState = args.skipOrderStatePatch !== true;

		// A partial refund leaves money on the charge, so the payment is `partial`
		// rather than `succeeded`. This matches what the `charge.refunded` webhook
		// will independently derive via `computeRefundFacts` moments later — if
		// the two disagreed the status would flap.
		const isPartial = args.amount !== undefined && args.amount < payment.amount;

		await ctx.runMutation(internal.stripeHelpers.updatePayment, {
			paymentId: args.paymentId,
			refundStatus: PAYMENT_REFUND_STATUS.REQUESTED,
			refundRequestedAt: Date.now(),
		});
		if (patchOrderState) {
			await ctx.runMutation(internal.stripeHelpers.updateOrderPaymentSummary, {
				orderId: targetOrderId,
				paymentState: ORDER_PAYMENT_STATE.REFUND_REQUESTED,
			});
		}

		const stripeClient = getStripeClient();
		try {
			const refund: Stripe.Refund = await stripeClient.refunds.create(
				{
					payment_intent: payment.stripePaymentIntentId,
					// Omit the key entirely for a full refund — Stripe treats an
					// explicit `undefined` differently from an absent field.
					...(args.amount !== undefined && { amount: args.amount }),
					reverse_transfer: true,
					refund_application_fee: true,
				},
				{
					idempotencyKey: args.idempotencyKey ?? `refund:${args.paymentId}`,
				}
			);

			const succeeded = refund.status === "succeeded";
			await ctx.runMutation(internal.stripeHelpers.updatePayment, {
				paymentId: args.paymentId,
				refundStatus: succeeded
					? isPartial
						? PAYMENT_REFUND_STATUS.PARTIAL
						: PAYMENT_REFUND_STATUS.SUCCEEDED
					: PAYMENT_REFUND_STATUS.REQUESTED,
				stripeRefundId: refund.id,
				...(succeeded && { refundedAt: Date.now() }),
			});
			if (patchOrderState) {
				await ctx.runMutation(internal.stripeHelpers.updateOrderPaymentSummary, {
					orderId: targetOrderId,
					paymentState: succeeded
						? ORDER_PAYMENT_STATE.REFUNDED
						: ORDER_PAYMENT_STATE.REFUND_REQUESTED,
				});
			}

			// Stripe always echoes `amount`, but fall back rather than return
			// `undefined` — the caller records this figure through a validated
			// mutation, and a validator error there would misreport a refund that
			// has already moved money as a failure.
			return {
				refundId: refund.id,
				status: refund.status,
				amount: refund.amount ?? args.amount ?? payment.amount,
			};
		} catch (error) {
			await ctx.runMutation(internal.stripeHelpers.updatePayment, {
				paymentId: args.paymentId,
				refundStatus: PAYMENT_REFUND_STATUS.FAILED,
				failureMessage: error instanceof Error ? error.message : "Refund failed",
			});
			if (patchOrderState) {
				await ctx.runMutation(internal.stripeHelpers.updateOrderPaymentSummary, {
					orderId: targetOrderId,
					paymentState: ORDER_PAYMENT_STATE.REFUND_FAILED,
				});
			}
			throw error;
		}
	},
});

/**
 * Cancels an order and refunds the diner that order's share, synchronously.
 *
 * Order of operations is **cancel first, then refund**. If Stripe fails the
 * order is still cancelled and flagged `refund_failed`, so the kitchen stops
 * cooking and the money is loudly surfaced for manual follow-up. Refunding
 * first would risk returning money for a dish that keeps cooking.
 *
 * Double-cancel is impossible: `updateStatus` rejects a transition out of
 * `cancelled` (no such key in `VALID_TRANSITIONS`), so two managers clicking at
 * once cannot produce two refunds — before Stripe idempotency is even reached.
 */
export type CancelOrderAndRefundResult = {
	orderId: Id<"orders">;
	refunded: boolean;
	/** Smallest currency unit refunded. `0` when nothing was refunded. */
	amountRefunded: number;
	/** The order payment's refund id. `null` when nothing was refunded. */
	stripeRefundId: string | null;
	/** Set when the order was cancelled but no refund was due. */
	skippedReason: OrderRefundBlockReason | null;
};

type CancelOrderAndRefundErrors =
	| NotAuthenticatedErrorObject
	| NotAuthorizedErrorObject
	| NotFoundErrorObject
	| ConflictErrorObject;

export const cancelOrderAndRefund = action({
	args: { orderId: v.id(TABLE.ORDERS) },
	handler: async (
		ctx,
		args
	): AsyncReturn<CancelOrderAndRefundResult, CancelOrderAndRefundErrors> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return [null, new NotAuthenticatedError().toObject()];
		}
		const userId = identity.subject;

		// Cancel first. This also performs the manager check and the transition
		// guard, so an unauthorised or invalid request never reaches Stripe.
		const [, cancelError] = await ctx.runMutation(api.orders.updateStatus, {
			orderId: args.orderId,
			newStatus: "cancelled",
		});
		if (cancelError) return [null, cancelError];

		const { plan, blocked } = await ctx.runQuery(
			internal.orderRefundHelpers.resolveOrderRefundPlanInternal,
			{ orderId: args.orderId }
		);
		if (!plan) {
			// An unpaid order is the normal case here — cancelling is the whole
			// job. The other reasons mean money may be owed, so they surface as
			// errors rather than a silent success.
			if (blocked === ORDER_REFUND_BLOCK_REASON.NOT_PAID) {
				return [
					{
						orderId: args.orderId,
						refunded: false,
						amountRefunded: 0,
						stripeRefundId: null,
						skippedReason: blocked,
					},
					null,
				];
			}
			return [
				null,
				new ConflictError(
					blocked === ORDER_REFUND_BLOCK_REASON.NOTHING_REFUNDABLE
						? "ERROR_REFUND_ALREADY_ISSUED"
						: "ERROR_REFUND_PAYMENT_UNRESOLVED"
				).toObject(),
			];
		}

		// Only the Stripe call is guarded. Recording the outcome runs *after* the
		// catch, because once money has moved, an error while writing our own
		// records must not be reported as "refund failed" — that would send staff
		// to re-issue a refund the diner already received.
		let refund: { refundId: string; status: string | null; amount: number };
		try {
			refund = await ctx.runAction(internal.stripe.createRefund, {
				paymentId: plan.paymentId,
				orderId: plan.orderId,
				// Omit `amount` when the order's share is the whole charge (the
				// legacy per-order case) so the Stripe call is byte-identical to
				// what shipped before partial refunds existed.
				...(plan.isFullRefund ? {} : { amount: plan.amount }),
				idempotencyKey: plan.idempotencyKey,
			});
		} catch (error) {
			console.error(
				"[stripe.cancelOrderAndRefund] REFUND FAILED",
				buildIntegrationErrorLog(error, {
					integration: "stripe",
					operation: "cancelOrderAndRefund",
				})
			);
			await ctx.runMutation(internal.orderRefundHelpers.recordOrderRefundOutcomeInternal, {
				orderId: args.orderId,
				succeeded: false,
				amount: plan.amount,
				failureMessage: error instanceof Error ? error.message : "Refund failed",
				userId,
			});
			return [null, new ConflictError("ERROR_REFUND_FAILED").toObject()];
		}

		await ctx.runMutation(internal.orderRefundHelpers.recordOrderRefundOutcomeInternal, {
			orderId: args.orderId,
			succeeded: true,
			amount: refund.amount,
			userId,
			stripeRefundId: refund.refundId,
		});

		return [
			{
				orderId: args.orderId,
				refunded: true,
				amountRefunded: refund.amount,
				stripeRefundId: refund.refundId,
				skippedReason: null,
			},
			null,
		];
	},
});

/**
 * Refunds a single line removed from a **paid** order (ADR 008). Scheduled by
 * `orders.cancelOrderItem` after it stamps the line, so the kitchen-facing
 * removal commits transactionally and the Stripe call happens out-of-band —
 * mirroring the cancel-first ordering of {@link cancelOrderAndRefund}.
 *
 * Amount: `lineTotal + round(lineTotal × fee rate)` clamped to the payment's
 * remaining balance; when removing the line cancelled the whole order (last
 * live line) the **entire remaining balance** comes back instead, which
 * structurally retires the per-order rounding residue (see
 * `computeLineRefundAmount`).
 * That math only holds for a fee-inclusive ADR 008 payment (kind "order",
 * `subtotalAmount` set) covering exactly this order, so anything else — a tab
 * payment whose balance is many orders plus the tip, a pre-fee per-order
 * intent — is refused here even if a caller schedules it.
 *
 * `reverse_transfer` / `refund_application_fee` stay on via `createRefund` —
 * correct by construction now: the fee share of every refund is genuinely the
 * diner's money on a fee-inclusive charge.
 *
 * Idempotent: the order item's `refundedAt` short-circuits a replayed
 * schedule before Stripe is reached, and the (payment, orderItem) idempotency
 * key dedupes at Stripe below that.
 *
 * Order-state policy lives in `recordOrderItemRefundOutcomeInternal`: a
 * cooking order stays `paid` (only the item + audit + payment record the
 * refund); a last-live-line refund follows refund_requested → refunded; any
 * failure surfaces as `refund_failed`, mirroring `cancelOrderAndRefund`.
 */
export const refundOrderItem = internalAction({
	args: {
		orderId: v.id(TABLE.ORDERS),
		orderItemId: v.id(TABLE.ORDER_ITEMS),
		paymentId: v.id(TABLE.PAYMENTS),
	},
	handler: async (ctx, args): Promise<void> => {
		const order: Doc<"orders"> | null = await ctx.runQuery(
			internal.stripeHelpers.getOrderInternal,
			{
				orderId: args.orderId,
			}
		);
		const item: Doc<"orderItems"> | null = await ctx.runQuery(
			internal.stripeHelpers.getOrderItemInternal,
			{ orderItemId: args.orderItemId }
		);
		const payment: Doc<"payments"> | null = await ctx.runQuery(
			internal.stripeHelpers.getPaymentInternal,
			{ paymentId: args.paymentId }
		);
		if (!order || !item || !payment) {
			console.error("[stripe.refundOrderItem] order/item/payment missing", {
				orderId: args.orderId,
				orderItemId: args.orderItemId,
				paymentId: args.paymentId,
			});
			return;
		}

		// Idempotent no-op: this line's money already went back.
		if (item.refundedAt !== undefined) return;

		if (item.cancelledAt === undefined) {
			console.error(
				`[stripe.refundOrderItem] item ${args.orderItemId} is not cancelled — nothing to refund`
			);
			return;
		}
		if (payment.status !== PAYMENT_STATUS.SUCCEEDED) {
			console.error(
				`[stripe.refundOrderItem] payment ${args.paymentId} is ${payment.status}, not succeeded`
			);
			return;
		}

		// Vintage guard (defense in depth — `cancelOrderItem` refuses to schedule
		// against legacy money): the line-refund math below is only correct for a
		// fee-inclusive ADR 008 payment covering exactly this order. Against a
		// legacy tab payment the fee top-up refunds money the diner never paid and
		// the last-live-line sweep would refund every *other* order's subtotal
		// plus the tip.
		if (payment.kind !== PAYMENT_KIND.ORDER || payment.subtotalAmount === undefined) {
			console.error(
				`[stripe.refundOrderItem] payment ${args.paymentId} is not a fee-inclusive ` +
					`order payment (kind ${payment.kind ?? "legacy"}) — refusing the line refund`
			);
			return;
		}

		// The scheduling mutation flips the order to "cancelled" in the same
		// transaction when the removed line was the last live one, so the order's
		// status is the reliable signal — no flag to drift on a replay.
		const isLastLiveLine = order.status === "cancelled";

		// The staff member who removed the line owns the money trail.
		const actorUserId = item.cancelledBy ?? AUDIT_SYSTEM_USER_ID;

		const amount = computeLineRefundAmount({
			lineTotal: item.lineTotal,
			feeRate: PLATFORM_APPLICATION_FEE_RATE,
			paymentAmount: payment.amount,
			paymentAmountRefunded: payment.amountRefunded,
			isLastLiveLine,
		});

		if (amount <= 0) {
			console.error(
				`[stripe.refundOrderItem] payment ${args.paymentId} has no refundable balance ` +
					`left for item ${args.orderItemId}`
			);
			return;
		}

		let refund: { refundId: string; status: string | null; amount: number };
		try {
			refund = await ctx.runAction(internal.stripe.createRefund, {
				paymentId: args.paymentId,
				orderId: args.orderId,
				amount,
				idempotencyKey: buildLineRefundIdempotencyKey(args.paymentId, args.orderItemId),
				skipOrderStatePatch: true,
			});
		} catch (error) {
			const failureMessage = error instanceof Error ? error.message : "Refund failed";
			console.error(
				"[stripe.refundOrderItem] REFUND FAILED",
				buildIntegrationErrorLog(error, {
					integration: "stripe",
					operation: "refundOrderItem",
				})
			);
			await ctx.runMutation(internal.orderRefundHelpers.recordOrderItemRefundOutcomeInternal, {
				orderId: args.orderId,
				orderItemId: args.orderItemId,
				succeeded: false,
				amount,
				isLastLiveLine,
				userId: actorUserId,
				failureMessage,
			});
			// Recorded as refund_failed — do not rethrow, or the scheduler retry
			// would race the manual follow-up this state exists to trigger.
			return;
		}

		await ctx.runMutation(internal.orderRefundHelpers.recordOrderItemRefundOutcomeInternal, {
			orderId: args.orderId,
			orderItemId: args.orderItemId,
			succeeded: true,
			amount: refund.amount,
			isLastLiveLine,
			userId: actorUserId,
			paymentId: args.paymentId,
			stripeRefundId: refund.refundId,
		});
	},
});

// =============================================================================
// 7. Payment Intent (In-App Checkout Flow)
// =============================================================================

/**
 * Creates the pay-at-submit PaymentIntent for one order (ADR 008) — the
 * primary payment path. The diner pays `subtotal + 12% service fee` in-app via
 * Stripe Elements; the kitchen only sees the order once the webhook confirms
 * the charge (`orders.confirmPayment`).
 *
 * Money model (destination charge):
 * - `amount = order.totalAmount + round(totalAmount × PLATFORM_APPLICATION_FEE_RATE)`
 * - `application_fee_amount` is exactly that fee — customer-borne, on top, so
 *   the restaurant nets its full subtotal.
 * - `on_behalf_of` the restaurant's connected account (merchant of record).
 * - `setup_future_usage: "off_session"` saves the card on the diner's
 *   platform-level Customer for later one-tap tips.
 *
 * Accepts orders in `draft` (normal flow) and `awaiting_payment` (a diner who
 * committed to cash and changed their mind). Any session member can pay for
 * their own round — membership, not opener-ship, is the gate.
 */
export const createPaymentIntent = action({
	args: {
		orderId: v.id(TABLE.ORDERS),
		/**
		 * Tip as a whole percentage of the **subtotal** (TAVLI-99). Omitted
		 * means no tip, which keeps every pre-existing caller working.
		 */
		tipPercent: v.optional(v.number()),
	},
	handler: async (
		ctx,
		args
	): Promise<{ clientSecret: string | null; paymentId: Id<"payments"> }> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			throw fromErrorObject(new NotAuthenticatedError().toObject());
		}

		const ownedOrderId = await ctx.runQuery(internal.orders.verifyOrderForPaymentInternal, {
			orderId: args.orderId,
			userId: identity.subject,
		});
		if (!ownedOrderId) {
			throw fromErrorObject(new NotAuthorizedError(DINER_SESSION_ERRORS.ACCESS_DENIED).toObject());
		}

		const order: Doc<"orders"> | null = await ctx.runQuery(
			internal.stripeHelpers.getOrderInternal,
			{ orderId: args.orderId }
		);
		if (!order) throw new Error("Order not found");
		if (order.status !== "draft" && order.status !== ORDER_STATUS.AWAITING_PAYMENT) {
			throw new Error("Order is not payable");
		}
		if (order.totalAmount <= 0) throw new Error("Order total must be greater than zero");

		const restaurant: Doc<"restaurants"> | null = await ctx.runQuery(
			internal.stripeHelpers.getRestaurantInternal,
			{ restaurantId: order.restaurantId }
		);
		if (!restaurant?.stripeAccountId || !restaurant.stripeOnboardingComplete) {
			throw new Error("Restaurant is not set up for payments");
		}

		// Integer cents throughout: the fee rounds half-up on the subtotal, and
		// the diner's charge is the sum. `payments` rows record the split so
		// revenue aggregates read `subtotalAmount`, never `amount` (ADR 008).
		const { subtotalAmount, feeAmount, gratuityAmount, amount } = computeOrderCharge(
			order.totalAmount,
			PLATFORM_APPLICATION_FEE_RATE,
			args.tipPercent ?? 0
		);
		const currency = restaurant.currency.toLowerCase();

		const stripeClient = getStripeClient();
		const customerId = await getOrCreateStripeCustomerId(ctx, stripeClient, identity.subject);

		const latestPayment: Doc<"payments"> | null = order.activePaymentId
			? await ctx.runQuery(internal.stripeHelpers.getPaymentInternal, {
					paymentId: order.activePaymentId,
				})
			: await ctx.runQuery(internal.stripeHelpers.getLatestPaymentByOrderInternal, {
					orderId: args.orderId,
				});
		// `subtotalAmount === order.totalAmount` (not `amount`): an edited order
		// must supersede the intent, and comparing subtotals also retires any
		// legacy fee-less processing row instead of reusing it.
		const canReuseExistingIntent =
			latestPayment?.status === PAYMENT_STATUS.PROCESSING &&
			latestPayment.orderUpdatedAtSnapshot === order.updatedAt &&
			latestPayment.subtotalAmount === order.totalAmount &&
			// The tip has to be part of this or changing it silently pays the
			// old amount: the order has not been edited, so `updatedAt` and the
			// subtotal both still match, and the stale intent looks reusable.
			// The diner moves the slider, watches the total update, taps Pay,
			// and is charged what the slider said a minute ago. `?? 0` because
			// rows written before this feature carry no gratuity at all.
			(latestPayment.gratuityAmount ?? 0) === gratuityAmount &&
			latestPayment.currency === currency &&
			!!latestPayment.stripePaymentIntentId;

		if (canReuseExistingIntent && latestPayment?.stripePaymentIntentId) {
			const existingIntent: Stripe.PaymentIntent = await stripeClient.paymentIntents.retrieve(
				latestPayment.stripePaymentIntentId
			);
			if (
				existingIntent.status !== "succeeded" &&
				existingIntent.status !== "canceled" &&
				existingIntent.client_secret
			) {
				await ctx.runMutation(internal.stripeHelpers.updateOrderPaymentSummary, {
					orderId: args.orderId,
					paymentState: ORDER_PAYMENT_STATE.PROCESSING,
					activePaymentId: latestPayment._id,
					stripePaymentIntentId: latestPayment.stripePaymentIntentId,
				});

				return {
					clientSecret: existingIntent.client_secret,
					paymentId: latestPayment._id,
				};
			}
		}

		if (
			latestPayment &&
			latestPayment.status !== PAYMENT_STATUS.SUCCEEDED &&
			latestPayment.status !== PAYMENT_STATUS.SUPERSEDED &&
			latestPayment.status !== PAYMENT_STATUS.CANCELLED
		) {
			await ctx.runMutation(internal.stripeHelpers.updatePayment, {
				paymentId: latestPayment._id,
				status: PAYMENT_STATUS.SUPERSEDED,
			});
		}

		const attemptNumber = latestPayment ? latestPayment.attemptNumber + 1 : 1;
		const paymentId: Id<"payments"> = await ctx.runMutation(internal.stripeHelpers.createPayment, {
			restaurantId: order.restaurantId,
			orderId: args.orderId,
			amount,
			subtotalAmount,
			feeAmount,
			...(gratuityAmount > 0 && { gratuityAmount }),
			kind: PAYMENT_KIND.ORDER,
			paidByUserId: identity.subject,
			currency,
			status: PAYMENT_STATUS.PENDING,
			refundStatus: PAYMENT_REFUND_STATUS.NONE,
			attemptNumber,
			orderUpdatedAtSnapshot: order.updatedAt,
		});

		await ctx.runMutation(internal.stripeHelpers.updateOrderPaymentSummary, {
			orderId: args.orderId,
			paymentState: ORDER_PAYMENT_STATE.PENDING,
			activePaymentId: paymentId,
		});

		const deploymentMarker = getDeploymentMarker();

		try {
			const paymentIntent: Stripe.PaymentIntent = await stripeClient.paymentIntents.create(
				{
					amount,
					currency,
					customer: customerId,
					setup_future_usage: "off_session",
					// Deliberately NOT `amount`. The tip is inside `amount` and
					// must not be inside the fee: the schema's invariant is that
					// the service fee never applies to tips, so 100% of a
					// gratuity reaches the restaurant through the destination
					// charge — exactly as it did when tips were their own charge
					// at close-out.
					application_fee_amount: feeAmount,
					transfer_data: {
						destination: restaurant.stripeAccountId,
					},
					on_behalf_of: restaurant.stripeAccountId,
					metadata: {
						orderId: args.orderId,
						restaurantId: order.restaurantId,
						sessionId: order.sessionId,
						paymentId,
						// Which deployment's `paymentId` this is (TAVLI-105). Several
						// deployments share one Stripe test account, so the webhook needs
						// this to tell a charge it cannot account for from a charge that
						// was never its business.
						...(deploymentMarker && { deployment: deploymentMarker }),
						kind: PAYMENT_KIND.ORDER,
						subtotalAmount: String(subtotalAmount),
						feeAmount: String(feeAmount),
						gratuityAmount: String(gratuityAmount),
					},
				},
				{
					idempotencyKey: `order-payment:${paymentId}`,
				}
			);

			// `attachIntentToPayment`, not a blind patch: the status only moves
			// PENDING -> PROCESSING, so a webhook that already settled this row
			// cannot be overwritten (TAVLI-105). This path creates an unconfirmed
			// intent, so the diner cannot have paid yet and the guard is belt and
			// braces — but the four create paths should not differ in whether they
			// can clobber a settlement.
			await ctx.runMutation(internal.stripeHelpers.attachIntentToPayment, {
				paymentId,
				stripePaymentIntentId: paymentIntent.id,
			});
			await ctx.runMutation(internal.stripeHelpers.updateOrderPaymentSummary, {
				orderId: args.orderId,
				paymentState: ORDER_PAYMENT_STATE.PROCESSING,
				activePaymentId: paymentId,
				stripePaymentIntentId: paymentIntent.id,
			});

			return {
				clientSecret: paymentIntent.client_secret,
				paymentId,
			};
		} catch (error) {
			// Guarded like the tip paths: FAILED is written only from
			// PENDING/PROCESSING, never over a settlement. This intent is created
			// unconfirmed — the diner has no client secret until the lines above
			// return — so the race is not reachable here; the guard exists so the
			// invariant holds at every create site rather than at some of them.
			const { alreadySucceeded } = await ctx.runMutation(
				internal.stripeHelpers.failPaymentUnlessSettled,
				{
					paymentId,
					failureMessage:
						error instanceof Error ? error.message : "Failed to create payment intent",
				}
			);
			// The order summary follows the payment row: flipping a PAID order to
			// `failed` would be the same erasure one level up.
			if (!alreadySucceeded) {
				await ctx.runMutation(internal.stripeHelpers.updateOrderPaymentSummary, {
					orderId: args.orderId,
					paymentState: ORDER_PAYMENT_STATE.FAILED,
					activePaymentId: paymentId,
				});
			}
			// Rethrown either way, unlike the tip paths: an order payment sheet the
			// diner never opened has nothing to show them, and `paymentState` already
			// says `paid`, so the caller re-reading the order sees the truth.
			throw error;
		}
	},
});

/**
 * Abandons the order's active card intent (ADR 008) — the diner backed out of
 * the payment sheet or is switching to cash. Cancels the PaymentIntent at
 * Stripe and clears the order's payment pointer
 * (`orders.cancelActivePaymentInternal`), so `requestPayInPerson`'s
 * in-flight-payment guard unblocks.
 *
 * Membership-verified exactly like {@link createPaymentIntent}. Mirrors
 * `sessions.cancelTabPayment`, with one extra rule: an intent that already
 * `succeeded` at Stripe is left alone — the webhook will settle the order
 * moments later, and clearing the pointer would orphan the charge.
 *
 * Two booleans, because `cancelled: false` alone is ambiguous and the caller
 * has to branch on the difference:
 * - `cancelled` — an intent was actually stood down here.
 * - `settled` — the charge WON the race and the order is about to be paid.
 *   The caller must stop: `orders.requestPayInPerson` would reject with
 *   ERROR_ORDER_PAYMENT_IN_FLIGHT, so a cash switch at this moment has to
 *   yield to the webhook rather than fire a doomed mutation. Every other
 *   "nothing to cancel" outcome (no active payment, payment already failed or
 *   cancelled) reports `settled: false` and the cash switch proceeds.
 */
export const cancelOrderPaymentIntent = action({
	args: {
		orderId: v.id(TABLE.ORDERS),
	},
	handler: async (ctx, args): Promise<{ cancelled: boolean; settled: boolean }> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			throw fromErrorObject(new NotAuthenticatedError().toObject());
		}

		const ownedOrderId = await ctx.runQuery(internal.orders.verifyOrderForPaymentInternal, {
			orderId: args.orderId,
			userId: identity.subject,
		});
		if (!ownedOrderId) {
			throw fromErrorObject(new NotAuthorizedError(DINER_SESSION_ERRORS.ACCESS_DENIED).toObject());
		}

		const order: Doc<"orders"> | null = await ctx.runQuery(
			internal.stripeHelpers.getOrderInternal,
			{ orderId: args.orderId }
		);
		if (!order?.activePaymentId) return { cancelled: false, settled: false };

		const payment: Doc<"payments"> | null = await ctx.runQuery(
			internal.stripeHelpers.getPaymentInternal,
			{ paymentId: order.activePaymentId }
		);
		if (
			!payment ||
			(payment.status !== PAYMENT_STATUS.PENDING && payment.status !== PAYMENT_STATUS.PROCESSING)
		) {
			return { cancelled: false, settled: payment?.status === PAYMENT_STATUS.SUCCEEDED };
		}

		// Cancel at Stripe first, then clear our records — the reverse order
		// would leave a live intent a stale client secret could still confirm.
		if (payment.stripePaymentIntentId) {
			const stripeClient = getStripeClient();
			const intent: Stripe.PaymentIntent = await stripeClient.paymentIntents.retrieve(
				payment.stripePaymentIntentId
			);
			if (intent.status === "succeeded") {
				// The charge won the race; let the webhook settle the order.
				return { cancelled: false, settled: true };
			}
			if (intent.status !== "canceled") {
				try {
					await stripeClient.paymentIntents.cancel(payment.stripePaymentIntentId);
				} catch (error) {
					console.error(
						"[stripe.cancelOrderPaymentIntent]",
						buildIntegrationErrorLog(error, {
							integration: "stripe",
							operation: "cancelOrderPaymentIntent",
							eventId: payment.stripePaymentIntentId,
						})
					);
					throw error;
				}
			}
		}

		const cancelled: boolean = await ctx.runMutation(internal.orders.cancelActivePaymentInternal, {
			orderId: args.orderId,
			userId: identity.subject,
		});
		return { cancelled, settled: false };
	},
});

// =============================================================================
// 7b. Post-Visit Tip Charge (ADR 008, TAVLI-71 Phase 3B)
// =============================================================================

/**
 * Shape of the Stripe card error thrown by an off-session `confirm: true`
 * create when the saved card demands 3DS. stripe-node surfaces the intent on
 * `error.raw.payment_intent` (and mirrors `code` at the top level).
 */
type OffSessionCardError = {
	code?: string;
	payment_intent?: { id?: string; client_secret?: string | null };
	raw?: { payment_intent?: { id?: string; client_secret?: string | null } };
};

/**
 * Charges a session member's post-visit tip on their own spend (ADR 008): a
 * destination charge of exactly `tipAmount` to the restaurant's connected
 * account with **no application fee** — 100% of the tip lands with the
 * restaurant. The payment row records the whole amount as `gratuityAmount`
 * (subtotal 0, fee 0) so the tip-pool aggregation (`convex/tips.ts`) picks it
 * up by session unchanged.
 *
 * ONE-TAP FIRST: the card saved by the member's pay-at-submit charge in this
 * session is charged
 * `off_session` + `confirm: true`. When the bank demands 3DS
 * (`authentication_required`) or no saved card exists, a `clientSecret` is
 * returned for the Elements fallback instead. Settlement is always the
 * webhook's job (`payments.confirmTipPayment`) — this action never marks the
 * payment succeeded.
 *
 * Re-tipping is allowed (each call charges a fresh tip), but a double-submit
 * is guarded: an existing pending/processing tip payment for the caller in
 * this session is reused rather than charged twice.
 */
export const createTipCharge = action({
	args: {
		sessionId: v.id(TABLE.SESSIONS),
		/** Tip in the smallest currency unit; must be a positive integer (0 = skip, never sent here). */
		tipAmount: v.number(),
	},
	handler: async (
		ctx,
		args
	): Promise<{ clientSecret: string | null; paymentId: Id<"payments"> }> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			throw fromErrorObject(new NotAuthenticatedError().toObject());
		}
		const userId = identity.subject;

		if (!Number.isInteger(args.tipAmount) || args.tipAmount <= 0) {
			throw fromErrorObject(new ConflictError("ERROR_TIP_INVALID_AMOUNT").toObject());
		}

		const membership = await ctx.runQuery(internal.sessions.verifySessionMemberInternal, {
			sessionId: args.sessionId,
			userId,
		});
		if (!membership) {
			throw fromErrorObject(new NotAuthorizedError(DINER_SESSION_ERRORS.ACCESS_DENIED).toObject());
		}

		const restaurant: Doc<"restaurants"> | null = await ctx.runQuery(
			internal.stripeHelpers.getRestaurantInternal,
			{ restaurantId: membership.restaurantId }
		);
		if (!restaurant?.stripeAccountId || !restaurant.stripeOnboardingComplete) {
			throw new Error("Restaurant is not set up for payments");
		}

		const currency = restaurant.currency.toLowerCase();
		const stripeClient = getStripeClient();

		// Double-submit guard: an in-flight tip attempt is handed back, not
		// duplicated. (A different amount still reuses it — the diner must let
		// the in-flight charge settle or fail before re-tipping.)
		const existingPayment: Doc<"payments"> | null = await ctx.runQuery(
			internal.payments.getActiveTipPaymentInternal,
			{ sessionId: args.sessionId, userId }
		);
		if (
			existingPayment?.status === PAYMENT_STATUS.PROCESSING &&
			existingPayment.stripePaymentIntentId
		) {
			const existingIntent: Stripe.PaymentIntent = await stripeClient.paymentIntents.retrieve(
				existingPayment.stripePaymentIntentId
			);
			if (existingIntent.status === "succeeded") {
				// Already charged — the webhook records it momentarily.
				return { clientSecret: null, paymentId: existingPayment._id };
			}
			if (existingIntent.status !== "canceled" && existingIntent.client_secret) {
				return { clientSecret: existingIntent.client_secret, paymentId: existingPayment._id };
			}
		}
		if (existingPayment) {
			// A pending row that never reached Stripe (or a canceled intent) is a
			// dead attempt — retire it and start fresh.
			await ctx.runMutation(internal.stripeHelpers.updatePayment, {
				paymentId: existingPayment._id,
				status: PAYMENT_STATUS.SUPERSEDED,
			});
		}

		// Payment row FIRST (before any Stripe call), so the intent's metadata
		// can carry the row id and a crash between the two leaves a visible
		// pending row instead of an orphaned charge. The whole amount is
		// gratuity: no service fee on tips (ADR 008).
		const paymentId: Id<"payments"> = await ctx.runMutation(internal.stripeHelpers.createPayment, {
			restaurantId: membership.restaurantId,
			sessionId: args.sessionId,
			amount: args.tipAmount,
			subtotalAmount: 0,
			feeAmount: 0,
			gratuityAmount: args.tipAmount,
			kind: PAYMENT_KIND.TIP,
			paidByUserId: userId,
			currency,
			status: PAYMENT_STATUS.PENDING,
			refundStatus: PAYMENT_REFUND_STATUS.NONE,
			attemptNumber: existingPayment ? existingPayment.attemptNumber + 1 : 1,
		});

		const deploymentMarker = getDeploymentMarker();
		const baseIntentParams = {
			amount: args.tipAmount,
			currency,
			// Deliberately NO application_fee_amount: the platform takes no
			// commission on tips — the full amount transfers to the restaurant.
			transfer_data: {
				destination: restaurant.stripeAccountId,
			},
			on_behalf_of: restaurant.stripeAccountId,
			metadata: {
				kind: PAYMENT_KIND.TIP,
				sessionId: args.sessionId,
				restaurantId: membership.restaurantId,
				paymentId,
				// See the order path: names the deployment that owns `paymentId`.
				...(deploymentMarker && { deployment: deploymentMarker }),
				paidByUserId: userId,
			},
		} satisfies Stripe.PaymentIntentCreateParams;

		const savedPaymentMethodId: string | null = await ctx.runQuery(
			internal.payments.getSavedCardForSessionMemberInternal,
			{ sessionId: args.sessionId, userId }
		);
		const customerId = await getOrCreateStripeCustomerId(ctx, stripeClient, userId);

		// ONE-TAP FIRST: charge the saved card off-session.
		//
		// `confirm: true` means the money moves inside this create call, so the
		// row below cannot learn the intent id until after the charge exists —
		// and `payment_intent.succeeded` can arrive first (TAVLI-105). There is
		// no pre-create intent id to reach for: Stripe mints `pi_…` in its
		// response, and the only way to hold it before the money moves is to
		// split this into create-then-confirm. That was considered and rejected.
		// It doubles the Stripe round trips on the hot path, and it trades this
		// race for a worse one: a create that succeeds while the confirm call is
		// lost leaves an unconfirmed intent and a `processing` row that no webhook
		// will ever settle — and the stuck-payment sweep covers tabs, not tips.
		// The webhook's `metadata.paymentId` fallback closes the race for every
		// path at once, so it is the guarantee here, not a safety net.
		if (savedPaymentMethodId) {
			try {
				const paymentIntent: Stripe.PaymentIntent = await stripeClient.paymentIntents.create(
					{
						...baseIntentParams,
						customer: customerId,
						payment_method: savedPaymentMethodId,
						off_session: true,
						confirm: true,
					},
					{
						idempotencyKey: `tip-payment:${paymentId}`,
					}
				);

				// THE racy one. `confirm: true` above means the charge has already
				// happened, so `payment_intent.succeeded` may already have been
				// delivered and — via the metadata fallback — may already have
				// SETTLED this row. `attachIntentToPayment` records the ids and
				// moves the status only if the row is still PENDING, so it can
				// never overwrite that settlement with PROCESSING (TAVLI-105).
				await ctx.runMutation(internal.stripeHelpers.attachIntentToPayment, {
					paymentId,
					stripePaymentIntentId: paymentIntent.id,
					stripePaymentMethodId: savedPaymentMethodId,
				});
				// Confirmed (or confirming) — the webhook records the tip.
				return { clientSecret: null, paymentId };
			} catch (error) {
				const cardError = error as OffSessionCardError;
				const errorIntent = cardError.raw?.payment_intent ?? cardError.payment_intent;
				if (cardError.code === "authentication_required" && errorIntent?.id) {
					// The bank wants 3DS — the intent exists at Stripe in
					// requires_action; hand its client secret to the Elements fallback.
					let clientSecret = errorIntent.client_secret ?? null;
					if (!clientSecret) {
						const retrieved: Stripe.PaymentIntent = await stripeClient.paymentIntents.retrieve(
							errorIntent.id
						);
						clientSecret = retrieved.client_secret;
					}
					await ctx.runMutation(internal.stripeHelpers.attachIntentToPayment, {
						paymentId,
						stripePaymentIntentId: errorIntent.id,
					});
					return { clientSecret, paymentId };
				}

				// Genuine decline (or Stripe failure): record it and surface the
				// error — the diner can retry, superseding this row.
				//
				// Through `failPaymentUnlessSettled`, because a thrown error here does
				// NOT prove the card was not charged (TAVLI-105). `confirm: true`
				// means Stripe may have taken the money and then lost the response —
				// a timeout on the call and on both `maxNetworkRetries` replays — in
				// which case `payment_intent.succeeded` has already settled this row
				// through the metadata fallback. Writing FAILED over that would erase
				// the credit with no redelivery left to restore it.
				const { alreadySucceeded } = await ctx.runMutation(
					internal.stripeHelpers.failPaymentUnlessSettled,
					{
						paymentId,
						failureMessage:
							error instanceof Error ? error.message : "Failed to charge the saved card",
					}
				);

				if (alreadySucceeded) {
					// The charge worked; only our view of it failed. Rethrowing would
					// tell the diner to retry, and the retry would be a SECOND charge
					// for the same tip. Return what the success branch returns and let
					// the recorded tip speak for itself. Loud in the logs, because a
					// lost response on a confirmed charge is worth knowing about.
					console.error(
						"[stripe.createTipCharge] CHARGE SETTLED DESPITE A FAILED CREATE CALL",
						buildIntegrationErrorLog(error, {
							integration: "stripe",
							operation: "createTipCharge",
							restaurantId: membership.restaurantId,
						})
					);
					return { clientSecret: null, paymentId };
				}

				throw error;
			}
		}

		// Elements fallback: no saved card — an unconfirmed intent the diner
		// confirms in the payment sheet. The card saves for a future one-tap.
		try {
			const paymentIntent: Stripe.PaymentIntent = await stripeClient.paymentIntents.create(
				{
					...baseIntentParams,
					customer: customerId,
					setup_future_usage: "off_session",
				},
				{
					idempotencyKey: `tip-payment:${paymentId}`,
				}
			);

			await ctx.runMutation(internal.stripeHelpers.attachIntentToPayment, {
				paymentId,
				stripePaymentIntentId: paymentIntent.id,
			});

			return { clientSecret: paymentIntent.client_secret, paymentId };
		} catch (error) {
			// Same guard as the one-tap branch above. This intent is created
			// unconfirmed, so no money can have moved and the race is not reachable
			// here — but "the create path's failure write can undo a settlement" is a
			// bug class, and the tip row is the same row either way.
			const { alreadySucceeded } = await ctx.runMutation(
				internal.stripeHelpers.failPaymentUnlessSettled,
				{
					paymentId,
					failureMessage:
						error instanceof Error ? error.message : "Failed to create tip payment intent",
				}
			);
			if (alreadySucceeded) {
				console.error(
					"[stripe.createTipCharge] CHARGE SETTLED DESPITE A FAILED CREATE CALL",
					buildIntegrationErrorLog(error, {
						integration: "stripe",
						operation: "createTipCharge",
						restaurantId: membership.restaurantId,
					})
				);
				return { clientSecret: null, paymentId };
			}
			throw error;
		}
	},
});

// =============================================================================
// 8. Tab Payment Intent (TAVLI-6 — one payment settles the whole session tab)
// =============================================================================

/**
 * Creates a PaymentIntent covering every payable order in the session plus an
 * optional tip. Any tab member can pay. The tab locks (no new/edited orders)
 * while the payment is in flight; a failed or abandoned payment unlocks it.
 *
 * Fee policy (ticket TAVLI-6): the 12% platform application fee
 * ({@link PLATFORM_APPLICATION_FEE_RATE}) applies to the tab subtotal only —
 * the full tip lands in the restaurant's connected account.
 */
export const createTabPaymentIntent = action({
	args: {
		sessionId: v.id(TABLE.SESSIONS),
		/** Tip in the smallest currency unit; must be a non-negative integer. */
		tipAmount: v.number(),
	},
	handler: async (
		ctx,
		args
	): Promise<{ clientSecret: string | null; paymentId: Id<"payments"> }> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			throw fromErrorObject(new NotAuthenticatedError().toObject());
		}

		if (!Number.isInteger(args.tipAmount) || args.tipAmount < 0) {
			throw new Error("Tip must be a non-negative integer amount");
		}

		const tab = await ctx.runQuery(internal.sessions.verifyTabForPaymentInternal, {
			sessionId: args.sessionId,
			userId: identity.subject,
		});
		if (!tab) {
			throw fromErrorObject(new NotAuthorizedError(DINER_SESSION_ERRORS.ACCESS_DENIED).toObject());
		}
		if (tab.subtotal <= 0) {
			throw fromErrorObject(new NotAuthorizedError(DINER_SESSION_ERRORS.TAB_EMPTY).toObject());
		}

		// A tab may only be settled once every order on it has been served —
		// paying for food that never arrives is the only thing that produces a
		// Stripe refund here, and refunds come out of the platform balance. The
		// remedy is for staff to serve the order or cancel it; a cancelled order
		// leaves the tab for free.
		//
		// Placed after TAB_EMPTY so the two agree with the frontend, which
		// short-circuits to the empty state on `subtotal <= 0`. Placed before the
		// reuse-existing-intent branch below, which returns early — a guard after
		// it would be bypassable by construction. Also means a blocked tab never
		// constructs a Stripe client or makes a network call.
		if (tab.unservedOrderCount > 0) {
			throw fromErrorObject(
				new NotAuthorizedError(DINER_SESSION_ERRORS.TAB_HAS_UNSERVED_ORDERS).toObject()
			);
		}

		const restaurant: Doc<"restaurants"> | null = await ctx.runQuery(
			internal.stripeHelpers.getRestaurantInternal,
			{ restaurantId: tab.restaurantId }
		);
		if (!restaurant?.stripeAccountId || !restaurant.stripeOnboardingComplete) {
			throw new Error("Restaurant is not set up for payments");
		}

		const currency = restaurant.currency.toLowerCase();
		const totalAmount = tab.subtotal + args.tipAmount;
		// Fee on the subtotal only — the tip passes through to the restaurant.
		const applicationFeeAmount = Math.round(tab.subtotal * PLATFORM_APPLICATION_FEE_RATE);
		const stripeClient = getStripeClient();

		// Retry-friendly reuse: if an intent is already processing for the same
		// total (same balance + same tip), hand back its client secret instead
		// of superseding it.
		if (tab.activePaymentId) {
			const activePayment: Doc<"payments"> | null = await ctx.runQuery(
				internal.stripeHelpers.getPaymentInternal,
				{ paymentId: tab.activePaymentId }
			);
			if (
				activePayment?.status === PAYMENT_STATUS.PROCESSING &&
				activePayment.amount === totalAmount &&
				activePayment.gratuityAmount === args.tipAmount &&
				activePayment.currency === currency &&
				activePayment.stripePaymentIntentId
			) {
				const existingIntent: Stripe.PaymentIntent = await stripeClient.paymentIntents.retrieve(
					activePayment.stripePaymentIntentId
				);
				if (
					existingIntent.status !== "succeeded" &&
					existingIntent.status !== "canceled" &&
					existingIntent.client_secret
				) {
					return {
						clientSecret: existingIntent.client_secret,
						paymentId: activePayment._id,
					};
				}
			}
		}

		// Locks the tab, supersedes any prior attempt, and re-validates the
		// balance inside the transaction.
		const paymentId: Id<"payments"> = await ctx.runMutation(internal.sessions.beginTabPayment, {
			sessionId: args.sessionId,
			restaurantId: tab.restaurantId,
			amount: totalAmount,
			currency,
			gratuityAmount: args.tipAmount,
			userId: identity.subject,
		});

		const deploymentMarker = getDeploymentMarker();

		try {
			const paymentIntent: Stripe.PaymentIntent = await stripeClient.paymentIntents.create(
				{
					amount: totalAmount,
					currency,
					application_fee_amount: applicationFeeAmount,
					transfer_data: {
						destination: restaurant.stripeAccountId,
					},
					metadata: {
						sessionId: args.sessionId,
						restaurantId: tab.restaurantId,
						paymentId,
						// See the order path: names the deployment that owns `paymentId`.
						...(deploymentMarker && { deployment: deploymentMarker }),
						gratuityAmount: String(args.tipAmount),
					},
				},
				{
					idempotencyKey: `tab-payment:${paymentId}`,
				}
			);

			await ctx.runMutation(internal.sessions.markTabPaymentProcessing, {
				sessionId: args.sessionId,
				paymentId,
				stripePaymentIntentId: paymentIntent.id,
			});

			return {
				clientSecret: paymentIntent.client_secret,
				paymentId,
			};
		} catch (error) {
			await ctx.runMutation(internal.sessions.failTabPayment, {
				paymentId,
				failureMessage:
					error instanceof Error ? error.message : "Failed to create tab payment intent",
			});
			throw error;
		}
	},
});

// =============================================================================
// 9. Stuck Tab Reconciliation (TAVLI-45 — recover from dropped payment webhooks)
// =============================================================================

/**
 * Reconciles tabs stuck locked-for-payment against Stripe.
 *
 * A tab settles entirely on the `payment_intent.succeeded` webhook; if that
 * event is dropped or delayed the tab stays locked forever (customers can't
 * pay, staff can't close it). This cron (see `convex/crons.ts`) is the backstop:
 * for every tab locked longer than `TAB_RECONCILE_MIN_AGE_MS` it pulls the
 * PaymentIntent directly and, based on its status:
 *
 * - `succeeded` → runs {@link handlePaymentIntentSuccess}, the exact same
 *   idempotent fulfillment path the webhook uses (`confirmTabPayment` no-ops if
 *   the tab was already settled, so re-running is safe).
 * - terminal/abandoned → unlocks via `failTabPayment` so the group can retry.
 * - still `processing` → leaves the lock, escalating to a `console.error` once
 *   it outlives `TAB_RECONCILE_ALERT_AGE_MS` so staff can chase it.
 *
 * Per-candidate failures are logged and skipped so one bad PaymentIntent can't
 * stall the rest of the batch.
 */
export const reconcileStuckTabPayments = internalAction({
	args: {},
	handler: async (ctx): Promise<void> => {
		const now = Date.now();
		const candidates = await ctx.runQuery(internal.sessions.listStuckLockedTabs, {
			lockedBefore: now - TAB_RECONCILE_MIN_AGE_MS,
		});
		if (candidates.length === 0) return;

		const stripeClient = getStripeClient();

		for (const candidate of candidates) {
			try {
				const paymentIntent: Stripe.PaymentIntent = await stripeClient.paymentIntents.retrieve(
					candidate.stripePaymentIntentId
				);

				const decision = decideTabReconciliation({
					paymentIntentStatus: paymentIntent.status,
					lockAgeMs: now - candidate.lockedForPaymentAt,
					alertAgeMs: TAB_RECONCILE_ALERT_AGE_MS,
				});

				switch (decision) {
					case "settle": {
						// -------------------------------------------------------
						// AMOUNT ASSERTION, AHEAD OF THE HANDLER (TAVLI-69).
						//
						// `handlePaymentIntentSuccess` runs this same comparison and
						// raises an operator alert on a mismatch. That is right for
						// the webhook, which sees each PaymentIntent once, and wrong
						// here: a mismatched tab is PERMANENTLY in this sweep's
						// candidate list. Nothing patches `payments.amount`, nothing
						// clears `lockedForPaymentAt`, and the row stays
						// `processing` — so `listStuckLockedTabs` hands it back every
						// five minutes, forever.
						//
						// The `amount_mismatch:${paymentId}` dedupeKey does not stop
						// that, because `raiseOperatorAlert` scopes it to OPEN alerts
						// by design (acknowledging a row is what lets a genuine
						// recurrence through). So once an admin acknowledges this
						// alert, the next sweep would raise a fresh severe one and
						// email every platform admin again — punishing them for
						// clearing their inbox.
						//
						// Detecting the same unchanged fact on a timer is not news.
						// Log it and fail the row; the webhook already raised the
						// alert, and it is only resolved by a human refunding the
						// charge at Stripe.
						//
						// Failing it is also what stops the repetition at source:
						// `failTabPayment` clears `lockedForPaymentAt`, so the tab
						// drops out of `listStuckLockedTabs` and this branch runs
						// once rather than every five minutes. (It is reached at all
						// only when the webhook never arrived — otherwise the webhook
						// already failed the row and the sweep never sees it.)
						//
						// TAVLI-106: when the order and tip sweeps land, they must
						// keep this rule — compare before dispatching, fail the row,
						// and let the webhook own the alert.
						// -------------------------------------------------------
						const received =
							typeof paymentIntent.amount_received === "number"
								? paymentIntent.amount_received
								: typeof paymentIntent.amount === "number"
									? paymentIntent.amount
									: undefined;

						if (received !== undefined && received !== candidate.amount) {
							console.error("[stripe.reconcileStuckTabPayments] PAYMENT AMOUNT MISMATCH", {
								...buildIntegrationErrorLog(
									new Error("PaymentIntent amount does not match the payment row"),
									{
										integration: "stripe",
										operation: "reconcileStuckTab",
									}
								),
								paymentId: candidate.paymentId,
								sessionId: candidate.sessionId,
								expectedAmount: candidate.amount,
								receivedAmount: received,
								paymentIntentId: redactExternalId(candidate.stripePaymentIntentId),
							});

							// Every candidate here is a tab payment by construction —
							// `listStuckLockedTabs` returns only session-locked rows.
							await ctx.runMutation(internal.sessions.failTabPayment, {
								paymentId: candidate.paymentId,
								stripePaymentIntentId: candidate.stripePaymentIntentId,
								failureCode: PAYMENT_FAILURE_CODE.AMOUNT_MISMATCH,
								failureMessage: `Stripe collected ${received} but this payment expected ${candidate.amount}`,
							});
							break;
						}

						// Identical to the webhook path — routes tab payments to the
						// idempotent `confirmTabPayment` mutation.
						await handlePaymentIntentSuccess(ctx, paymentIntent);
						break;
					}
					case "unlock": {
						await ctx.runMutation(internal.sessions.failTabPayment, {
							paymentId: candidate.paymentId,
							stripePaymentIntentId: candidate.stripePaymentIntentId,
							failureCode: `reconcile_${paymentIntent.status}`,
							failureMessage: `Tab lock reconciled: PaymentIntent status is ${paymentIntent.status}`,
						});
						break;
					}
					case "alert": {
						const lockedMinutes = Math.round((now - candidate.lockedForPaymentAt) / 60000);
						console.error(
							`[stripe.reconcileStuckTabPayments] session ${candidate.sessionId} still locked ` +
								`after ${lockedMinutes}m — PaymentIntent ${candidate.stripePaymentIntentId} is ` +
								`${paymentIntent.status}. Needs staff attention.`
						);
						break;
					}
					case "wait":
						break;
				}
			} catch (error) {
				console.error(
					"[stripe.reconcileStuckTabPayments]",
					buildIntegrationErrorLog(error, {
						integration: "stripe",
						operation: "reconcileStuckTab",
						eventId: candidate.stripePaymentIntentId,
					})
				);
			}
		}
	},
});
