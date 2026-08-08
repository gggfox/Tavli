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
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { action, internalAction } from "./_generated/server";
import {
	AUDIT_SYSTEM_USER_ID,
	ORDER_PAYMENT_STATE,
	ORDER_STATUS,
	PAYMENT_KIND,
	PAYMENT_REFUND_STATUS,
	PAYMENT_STATUS,
	PLATFORM_APPLICATION_FEE_RATE,
	SUBSTITUTION_PROPOSAL_STATUS,
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
import { buildIntegrationErrorLog } from "./_shared/integrationLogging";
import type { AsyncReturn } from "./_shared/types";
import {
	buildLineRefundIdempotencyKey,
	buildRefundIdempotencyKey,
	computeLineRefundAmount,
	computeSupplementalSweepAmount,
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
		 * Leave `order.paymentState` alone (ADR 008 line refunds). A single 86'd
		 * line refunds while the order keeps cooking, so flipping the order
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
 * One substitution payment the whole-order sweep has to return, resolved from
 * an accepted proposal (ADR 008 Phase 3A). Same shape of decision as the
 * order-payment plan from `resolveOrderRefundPlanInternal`, one per charge.
 */
type SubstitutionSweepPlan = {
	paymentId: Id<"payments">;
	proposalId: Id<"substitutionProposals">;
	orderItemId: Id<"orderItems">;
	/** Smallest currency unit — the payment's entire remaining balance. */
	amount: number;
	idempotencyKey: string;
};

/**
 * Every substitution payment a whole-order cancel owes the diner back.
 *
 * The diner paid the order payment **plus** one supplemental PaymentIntent per
 * accepted proposal (`deltaAmount + feeOnDelta`), so refunding the order
 * payment alone leaves them out of pocket by every accepted delta — the gap
 * this resolves. Mirrors the per-line sweep in {@link refundOrderItem}: same
 * proposal lookup, same payment-vintage guard, same "refund the whole remaining
 * balance of a substitution charge" rule.
 *
 * Skips, each of which would otherwise move money that is not owed:
 * - a proposal with no supplemental payment (delta 0 — nothing was charged);
 * - a payment that is not a succeeded `kind: "substitution"` row (an in-flight
 *   or retired delta intent, or a mis-pointed id);
 * - a line already refunded individually, or a charge with no balance left.
 *
 * Payments are de-duplicated so two proposals that somehow name the same charge
 * cannot sweep it twice — each plan is priced from a payment read *before* any
 * refund of this cancel is issued.
 */
async function resolveSubstitutionSweepPlans(
	ctx: ActionCtx,
	orderId: Id<"orders">
): Promise<SubstitutionSweepPlan[]> {
	const proposals: Doc<"substitutionProposals">[] = await ctx.runQuery(
		internal.substitutions.getAcceptedProposalsForOrderInternal,
		{ orderId }
	);

	const plans: SubstitutionSweepPlan[] = [];
	const seenPayments = new Set<string>();
	for (const proposal of proposals) {
		if (!proposal.supplementalPaymentId) continue;
		if (seenPayments.has(proposal.supplementalPaymentId)) continue;

		const payment: Doc<"payments"> | null = await ctx.runQuery(
			internal.stripeHelpers.getPaymentInternal,
			{ paymentId: proposal.supplementalPaymentId }
		);
		if (
			!payment ||
			payment.kind !== PAYMENT_KIND.SUBSTITUTION ||
			payment.status !== PAYMENT_STATUS.SUCCEEDED
		) {
			console.error(
				`[stripe.cancelOrderAndRefund] proposal ${proposal._id} points at unusable ` +
					`substitution payment ${proposal.supplementalPaymentId} — skipping its refund`
			);
			continue;
		}

		const item: Doc<"orderItems"> | null = await ctx.runQuery(
			internal.stripeHelpers.getOrderItemInternal,
			{ orderItemId: proposal.orderItemId }
		);
		const amount = computeSupplementalSweepAmount({
			paymentAmount: payment.amount,
			paymentAmountRefunded: payment.amountRefunded,
			lineAlreadyRefunded: item?.refundedAt !== undefined,
		});
		if (amount <= 0) continue;

		seenPayments.add(payment._id);
		plans.push({
			paymentId: payment._id,
			proposalId: proposal._id,
			orderItemId: proposal.orderItemId,
			amount,
			// (payment, ORDER) — deliberately distinct from the (payment, line)
			// key the 86 path uses on this same charge, so a whole-order cancel
			// after a failed per-line attempt is not replayed as a no-op.
			idempotencyKey: buildRefundIdempotencyKey(payment._id, orderId),
		});
	}
	return plans;
}

/**
 * Cancels an order and refunds the diner that order's share, synchronously.
 *
 * Order of operations is **cancel first, then refund**. If Stripe fails the
 * order is still cancelled and flagged `refund_failed`, so the kitchen stops
 * cooking and the money is loudly surfaced for manual follow-up. Refunding
 * first would risk returning money for a dish that keeps cooking.
 *
 * The refund itself can span several charges (ADR 008): the order payment plus
 * one substitution payment per accepted proposal on the order
 * ({@link resolveSubstitutionSweepPlans}). Substitution charges go first,
 * matching {@link refundOrderItem}, so the two paths sequence money the same
 * way. Unlike that path this one does **not** abort on the first failure: a
 * cancelled order cannot be cancelled again (`VALID_TRANSITIONS` has no
 * `cancelled` key), so there is no automatic retry to preserve, and stopping
 * early would strand the refunds that would have succeeded. Every leg is
 * attempted, what moved is recorded, and any failure still lands the order in
 * `refund_failed` for manual follow-up.
 *
 * Double-cancel is impossible: `updateStatus` rejects a transition out of
 * `cancelled` (no such key in `VALID_TRANSITIONS`), so two managers clicking at
 * once cannot produce two refunds — before Stripe idempotency is even reached.
 */
export type CancelOrderAndRefundResult = {
	orderId: Id<"orders">;
	refunded: boolean;
	/**
	 * Smallest currency unit, summed across every charge refunded (order payment
	 * + swept substitution payments). `0` when nothing was refunded.
	 */
	amountRefunded: number;
	/** The order payment's refund. `null` when only substitution charges moved. */
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
		// The order payment is only part of the money on a substituted order, so
		// a `null` plan is not yet a reason to report nothing was refundable.
		const sweepPlans = await resolveSubstitutionSweepPlans(ctx, args.orderId);

		if (!plan && sweepPlans.length === 0) {
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

		// Only the Stripe calls are guarded. Recording the outcome runs *after*
		// each catch, because once money has moved, an error while writing our own
		// records must not be reported as "refund failed" — that would send staff
		// to re-issue a refund the diner already received.
		const supplementalRefunds: Array<{
			paymentId: Id<"payments">;
			amount: number;
			stripeRefundId: string;
		}> = [];
		const failureMessages: string[] = [];

		for (const sweep of sweepPlans) {
			try {
				const subRefund = await ctx.runAction(internal.stripe.createRefund, {
					paymentId: sweep.paymentId,
					orderId: args.orderId,
					amount: sweep.amount,
					idempotencyKey: sweep.idempotencyKey,
					// The order's own state is settled once by the record mutation
					// below; letting the delta refund drive it would flip the order
					// to `refunded` before the order payment has moved.
					skipOrderStatePatch: true,
				});
				supplementalRefunds.push({
					paymentId: sweep.paymentId,
					amount: subRefund.amount,
					stripeRefundId: subRefund.refundId,
				});
			} catch (error) {
				failureMessages.push(error instanceof Error ? error.message : "Refund failed");
				console.error(
					"[stripe.cancelOrderAndRefund] SUBSTITUTION REFUND FAILED",
					buildIntegrationErrorLog(error, {
						integration: "stripe",
						operation: "cancelOrderAndRefund",
					})
				);
			}
		}

		let refund: { refundId: string; status: string | null; amount: number } | null = null;
		if (plan) {
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
				failureMessages.push(error instanceof Error ? error.message : "Refund failed");
				console.error(
					"[stripe.cancelOrderAndRefund] REFUND FAILED",
					buildIntegrationErrorLog(error, {
						integration: "stripe",
						operation: "cancelOrderAndRefund",
					})
				);
			}
		}

		const supplementalTotal = supplementalRefunds.reduce((sum, r) => sum + r.amount, 0);
		const amountRefunded = (refund?.amount ?? 0) + supplementalTotal;

		if (failureMessages.length > 0) {
			// `amount` stays the *intended* order-payment figure, as it always has;
			// what actually moved is carried by `supplementalRefunds` and the
			// refund id, so the audit trail shows the partial outcome honestly.
			await ctx.runMutation(internal.orderRefundHelpers.recordOrderRefundOutcomeInternal, {
				orderId: args.orderId,
				succeeded: false,
				amount: plan?.amount ?? 0,
				failureMessage: failureMessages.join("; "),
				userId,
				...(supplementalRefunds.length > 0 && { supplementalRefunds }),
				...(refund !== null && { stripeRefundId: refund.refundId }),
			});
			return [null, new ConflictError("ERROR_REFUND_FAILED").toObject()];
		}

		await ctx.runMutation(internal.orderRefundHelpers.recordOrderRefundOutcomeInternal, {
			orderId: args.orderId,
			succeeded: true,
			amount: amountRefunded,
			userId,
			...(supplementalRefunds.length > 0 && { supplementalRefunds }),
			...(refund !== null && { stripeRefundId: refund.refundId }),
		});

		return [
			{
				orderId: args.orderId,
				refunded: true,
				amountRefunded,
				stripeRefundId: refund?.refundId ?? null,
				skippedReason: null,
			},
			null,
		];
	},
});

/**
 * Refunds a single 86'd line of a **paid** order (ADR 008). Scheduled by
 * `orders.cancelOrderItem` after it stamps the line, so the kitchen-facing
 * cancel commits transactionally and the Stripe call happens out-of-band —
 * mirroring the cancel-first ordering of {@link cancelOrderAndRefund}.
 *
 * Amount: `lineTotal + round(lineTotal × fee rate)` clamped to the payment's
 * remaining balance; when the 86 cancelled the whole order (last live line)
 * the **entire remaining balance** comes back instead, which structurally
 * retires the per-order rounding residue (see `computeLineRefundAmount`).
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
		// transaction when it 86'd the last live line, so the order's status is
		// the reliable signal — no flag to drift on a replay.
		const isLastLiveLine = order.status === "cancelled";

		// The staff member who 86'd the line owns the money trail. (For a
		// declined substitution the diner is the canceller — same field.)
		const actorUserId = item.cancelledBy ?? AUDIT_SYSTEM_USER_ID;

		// A substituted line's value spans two payments (ADR 008 Phase 3A): the
		// original share lives on the order payment, and each accepted proposal's
		// delta (+ fee on delta) on its own substitution payment. Refund the
		// substitution payments' remaining balances in full — the delta always
		// comes back whole — and only the original share from the order payment.
		const acceptedProposals: Doc<"substitutionProposals">[] = await ctx.runQuery(
			internal.substitutions.getAcceptedProposalsForItemInternal,
			{ orderId: args.orderId, orderItemId: args.orderItemId }
		);
		const acceptedDeltaTotal = acceptedProposals.reduce((sum, p) => sum + p.deltaAmount, 0);
		const originalLineTotal = Math.max(0, item.lineTotal - acceptedDeltaTotal);

		const amount = computeLineRefundAmount({
			lineTotal: originalLineTotal,
			feeRate: PLATFORM_APPLICATION_FEE_RATE,
			paymentAmount: payment.amount,
			paymentAmountRefunded: payment.amountRefunded,
			isLastLiveLine,
		});

		const supplementalRefunds: Array<{
			paymentId: Id<"payments">;
			amount: number;
			stripeRefundId: string;
		}> = [];
		try {
			for (const proposal of acceptedProposals) {
				if (!proposal.supplementalPaymentId) continue;
				const subPayment: Doc<"payments"> | null = await ctx.runQuery(
					internal.stripeHelpers.getPaymentInternal,
					{ paymentId: proposal.supplementalPaymentId }
				);
				if (
					!subPayment ||
					subPayment.kind !== PAYMENT_KIND.SUBSTITUTION ||
					subPayment.status !== PAYMENT_STATUS.SUCCEEDED
				) {
					console.error(
						`[stripe.refundOrderItem] proposal ${proposal._id} points at unusable ` +
							`substitution payment ${proposal.supplementalPaymentId} — skipping its refund`
					);
					continue;
				}
				const subRemaining = Math.max(0, subPayment.amount - (subPayment.amountRefunded ?? 0));
				if (subRemaining <= 0) continue;

				const subRefund = await ctx.runAction(internal.stripe.createRefund, {
					paymentId: subPayment._id,
					orderId: args.orderId,
					amount: subRemaining,
					idempotencyKey: buildLineRefundIdempotencyKey(subPayment._id, args.orderItemId),
					skipOrderStatePatch: true,
				});
				supplementalRefunds.push({
					paymentId: subPayment._id,
					amount: subRefund.amount,
					stripeRefundId: subRefund.refundId,
				});
			}
		} catch (error) {
			const failureMessage = error instanceof Error ? error.message : "Refund failed";
			console.error(
				"[stripe.refundOrderItem] SUBSTITUTION REFUND FAILED",
				buildIntegrationErrorLog(error, {
					integration: "stripe",
					operation: "refundOrderItem",
				})
			);
			// The line is not stamped refunded, so the retry path stays open —
			// Stripe's idempotency keys make a replay of the already-issued
			// portions a no-op. The deltas that *did* come back are still recorded:
			// they moved real money, and the whole-order sweep prices its own
			// refunds off `amountRefunded`.
			await ctx.runMutation(internal.orderRefundHelpers.recordOrderItemRefundOutcomeInternal, {
				orderId: args.orderId,
				orderItemId: args.orderItemId,
				succeeded: false,
				amount,
				isLastLiveLine,
				userId: actorUserId,
				...(supplementalRefunds.length > 0 && { supplementalRefunds }),
				failureMessage,
			});
			return;
		}

		if (amount <= 0 && supplementalRefunds.length === 0) {
			console.error(
				`[stripe.refundOrderItem] payment ${args.paymentId} has no refundable balance ` +
					`left for item ${args.orderItemId}`
			);
			return;
		}

		let refund: { refundId: string; status: string | null; amount: number } | null = null;
		if (amount > 0) {
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
					// Same reason as the substitution catch above: record the delta
					// refunds that already went through.
					...(supplementalRefunds.length > 0 && { supplementalRefunds }),
					failureMessage,
				});
				// Recorded as refund_failed — do not rethrow, or the scheduler retry
				// would race the manual follow-up this state exists to trigger.
				return;
			}
		}

		const supplementalTotal = supplementalRefunds.reduce((sum, r) => sum + r.amount, 0);
		const orderPaymentPortion = refund?.amount ?? 0;
		await ctx.runMutation(internal.orderRefundHelpers.recordOrderItemRefundOutcomeInternal, {
			orderId: args.orderId,
			orderItemId: args.orderItemId,
			succeeded: true,
			amount: orderPaymentPortion + supplementalTotal,
			isLastLiveLine,
			userId: actorUserId,
			paymentId: args.paymentId,
			paymentAmountPortion: orderPaymentPortion,
			...(supplementalRefunds.length > 0 && { supplementalRefunds }),
			...(refund !== null && { stripeRefundId: refund.refundId }),
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
 *   platform-level Customer for later one-tap tips and substitution deltas.
 *
 * Accepts orders in `draft` (normal flow) and `awaiting_payment` (a diner who
 * committed to cash and changed their mind). Any session member can pay for
 * their own round — membership, not opener-ship, is the gate.
 */
export const createPaymentIntent = action({
	args: {
		orderId: v.id(TABLE.ORDERS),
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
		const subtotalAmount = order.totalAmount;
		const feeAmount = Math.round(subtotalAmount * PLATFORM_APPLICATION_FEE_RATE);
		const amount = subtotalAmount + feeAmount;
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

		try {
			const paymentIntent: Stripe.PaymentIntent = await stripeClient.paymentIntents.create(
				{
					amount,
					currency,
					customer: customerId,
					setup_future_usage: "off_session",
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
						kind: PAYMENT_KIND.ORDER,
						subtotalAmount: String(subtotalAmount),
						feeAmount: String(feeAmount),
					},
				},
				{
					idempotencyKey: `order-payment:${paymentId}`,
				}
			);

			await ctx.runMutation(internal.stripeHelpers.updatePayment, {
				paymentId,
				status: PAYMENT_STATUS.PROCESSING,
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
			await ctx.runMutation(internal.stripeHelpers.updatePayment, {
				paymentId,
				status: PAYMENT_STATUS.FAILED,
				failureMessage: error instanceof Error ? error.message : "Failed to create payment intent",
				failedAt: Date.now(),
			});
			await ctx.runMutation(internal.stripeHelpers.updateOrderPaymentSummary, {
				orderId: args.orderId,
				paymentState: ORDER_PAYMENT_STATE.FAILED,
				activePaymentId: paymentId,
			});
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
 * `succeeded` at Stripe is left alone (`cancelled: false`) — the webhook will
 * settle the order moments later, and clearing the pointer would orphan the
 * charge.
 */
export const cancelOrderPaymentIntent = action({
	args: {
		orderId: v.id(TABLE.ORDERS),
	},
	handler: async (ctx, args): Promise<{ cancelled: boolean }> => {
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
		if (!order?.activePaymentId) return { cancelled: false };

		const payment: Doc<"payments"> | null = await ctx.runQuery(
			internal.stripeHelpers.getPaymentInternal,
			{ paymentId: order.activePaymentId }
		);
		if (
			!payment ||
			(payment.status !== PAYMENT_STATUS.PENDING && payment.status !== PAYMENT_STATUS.PROCESSING)
		) {
			return { cancelled: false };
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
				return { cancelled: false };
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
		return { cancelled };
	},
});

// =============================================================================
// 7b. Substitution Delta Payment Intent (ADR 008, TAVLI-71 Phase 3A)
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
 * Charges the diner an accepted substitution's price delta plus the 12%
 * service fee **on the delta** (ADR 008): `amount = deltaAmount + feeOnDelta`,
 * `application_fee_amount = feeOnDelta`, destination charge to the
 * restaurant's connected account — mirroring {@link createPaymentIntent}.
 *
 * ONE-TAP FIRST: the member's saved card (persisted by their pay-at-submit
 * charge in this session) is charged `off_session` + `confirm: true`. When the
 * bank demands 3DS (`authentication_required`) or no saved card exists, the
 * action returns a `clientSecret` instead and the diner completes payment
 * through the Elements fallback on their device. Either way the swap itself is
 * applied only by the `payment_intent.succeeded` webhook
 * (`substitutions.confirmSubstitutionPayment`) — the mutation raises the order
 * total by the delta at that point, never before the money.
 *
 * Idempotent re-calls: a still-processing intent for the proposal is returned
 * as-is; a failed attempt is superseded by a fresh payment row (new attempt
 * number, new idempotency key), matching {@link createPaymentIntent}.
 */
export const createSubstitutionPaymentIntent = action({
	args: {
		proposalId: v.id(TABLE.SUBSTITUTION_PROPOSALS),
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

		const proposal: Doc<"substitutionProposals"> | null = await ctx.runQuery(
			internal.substitutions.verifyProposalForPaymentInternal,
			{ proposalId: args.proposalId, userId }
		);
		if (!proposal) {
			throw fromErrorObject(new NotAuthorizedError(DINER_SESSION_ERRORS.ACCESS_DENIED).toObject());
		}
		if (proposal.status !== SUBSTITUTION_PROPOSAL_STATUS.PENDING) {
			throw fromErrorObject(new ConflictError("ERROR_SUBSTITUTION_NOT_PENDING").toObject());
		}
		if (proposal.deltaAmount <= 0) {
			// Zero-delta proposals accept via `substitutions.acceptProposal`.
			throw fromErrorObject(new ConflictError("ERROR_SUBSTITUTION_NOT_PENDING").toObject());
		}

		const restaurant: Doc<"restaurants"> | null = await ctx.runQuery(
			internal.stripeHelpers.getRestaurantInternal,
			{ restaurantId: proposal.restaurantId }
		);
		if (!restaurant?.stripeAccountId || !restaurant.stripeOnboardingComplete) {
			throw new Error("Restaurant is not set up for payments");
		}

		const subtotalAmount = proposal.deltaAmount;
		const feeAmount = proposal.feeOnDelta;
		const amount = subtotalAmount + feeAmount;
		const currency = restaurant.currency.toLowerCase();
		const stripeClient = getStripeClient();

		// Retry-friendly reuse: an intent already in flight for this proposal is
		// handed back rather than superseded.
		const existingPayment: Doc<"payments"> | null = proposal.supplementalPaymentId
			? await ctx.runQuery(internal.stripeHelpers.getPaymentInternal, {
					paymentId: proposal.supplementalPaymentId,
				})
			: null;
		if (
			existingPayment?.status === PAYMENT_STATUS.PROCESSING &&
			existingPayment.amount === amount &&
			existingPayment.currency === currency &&
			existingPayment.stripePaymentIntentId
		) {
			const existingIntent: Stripe.PaymentIntent = await stripeClient.paymentIntents.retrieve(
				existingPayment.stripePaymentIntentId
			);
			if (existingIntent.status === "succeeded") {
				// The one-tap (or a prior confirm) already went through — the
				// webhook applies the swap momentarily.
				return { clientSecret: null, paymentId: existingPayment._id };
			}
			if (existingIntent.status !== "canceled" && existingIntent.client_secret) {
				return { clientSecret: existingIntent.client_secret, paymentId: existingPayment._id };
			}
		}
		if (
			existingPayment &&
			existingPayment.status !== PAYMENT_STATUS.SUCCEEDED &&
			existingPayment.status !== PAYMENT_STATUS.SUPERSEDED &&
			existingPayment.status !== PAYMENT_STATUS.CANCELLED
		) {
			await ctx.runMutation(internal.stripeHelpers.updatePayment, {
				paymentId: existingPayment._id,
				status: PAYMENT_STATUS.SUPERSEDED,
			});
		}

		const attemptNumber = existingPayment ? existingPayment.attemptNumber + 1 : 1;
		const paymentId: Id<"payments"> = await ctx.runMutation(internal.stripeHelpers.createPayment, {
			restaurantId: proposal.restaurantId,
			orderId: proposal.orderId,
			sessionId: proposal.sessionId,
			amount,
			subtotalAmount,
			feeAmount,
			kind: PAYMENT_KIND.SUBSTITUTION,
			paidByUserId: userId,
			substitutionProposalId: args.proposalId,
			currency,
			status: PAYMENT_STATUS.PENDING,
			refundStatus: PAYMENT_REFUND_STATUS.NONE,
			attemptNumber,
		});
		await ctx.runMutation(internal.substitutions.attachSupplementalPaymentInternal, {
			proposalId: args.proposalId,
			paymentId,
		});

		const baseIntentParams = {
			amount,
			currency,
			application_fee_amount: feeAmount,
			transfer_data: {
				destination: restaurant.stripeAccountId,
			},
			on_behalf_of: restaurant.stripeAccountId,
			metadata: {
				kind: PAYMENT_KIND.SUBSTITUTION,
				proposalId: args.proposalId,
				orderId: proposal.orderId,
				sessionId: proposal.sessionId,
				restaurantId: proposal.restaurantId,
				paymentId,
				deltaAmount: String(subtotalAmount),
				feeOnDelta: String(feeAmount),
			},
		} satisfies Stripe.PaymentIntentCreateParams;

		const savedPaymentMethodId: string | null = await ctx.runQuery(
			internal.substitutions.getSavedCardForSessionMemberInternal,
			{ sessionId: proposal.sessionId, userId }
		);
		const customer: Doc<"stripeCustomers"> | null = await ctx.runQuery(
			internal.stripeCustomers.getByUserInternal,
			{ userId }
		);

		// ONE-TAP FIRST: charge the saved card off-session.
		if (savedPaymentMethodId && customer) {
			try {
				const paymentIntent: Stripe.PaymentIntent = await stripeClient.paymentIntents.create(
					{
						...baseIntentParams,
						customer: customer.stripeCustomerId,
						payment_method: savedPaymentMethodId,
						off_session: true,
						confirm: true,
					},
					{
						idempotencyKey: `substitution-payment:${paymentId}`,
					}
				);

				await ctx.runMutation(internal.stripeHelpers.updatePayment, {
					paymentId,
					status: PAYMENT_STATUS.PROCESSING,
					stripePaymentIntentId: paymentIntent.id,
					stripePaymentMethodId: savedPaymentMethodId,
				});
				// Confirmed (or confirming) — the webhook applies the swap.
				return { clientSecret: null, paymentId };
			} catch (error) {
				const cardError = error as OffSessionCardError;
				const errorIntent = cardError.raw?.payment_intent ?? cardError.payment_intent;
				if (cardError.code === "authentication_required" && errorIntent?.id) {
					// The bank wants 3DS — bring the diner back to their device.
					// The intent already exists at Stripe (status requires_action);
					// hand its client secret to the Elements fallback.
					let clientSecret = errorIntent.client_secret ?? null;
					if (!clientSecret) {
						const retrieved: Stripe.PaymentIntent = await stripeClient.paymentIntents.retrieve(
							errorIntent.id
						);
						clientSecret = retrieved.client_secret;
					}
					await ctx.runMutation(internal.stripeHelpers.updatePayment, {
						paymentId,
						status: PAYMENT_STATUS.PROCESSING,
						stripePaymentIntentId: errorIntent.id,
					});
					return { clientSecret, paymentId };
				}

				// Genuine decline (or Stripe failure): record it and surface the
				// error. The proposal stays pending so the diner can retry — the
				// next call supersedes this payment row.
				await ctx.runMutation(internal.stripeHelpers.updatePayment, {
					paymentId,
					status: PAYMENT_STATUS.FAILED,
					failureMessage:
						error instanceof Error ? error.message : "Failed to charge the saved card",
					failedAt: Date.now(),
				});
				throw error;
			}
		}

		// Elements fallback: no saved card — create an unconfirmed intent the
		// diner confirms in the payment sheet. The card saves for next time when
		// a Customer exists.
		try {
			const paymentIntent: Stripe.PaymentIntent = await stripeClient.paymentIntents.create(
				{
					...baseIntentParams,
					...(customer && {
						customer: customer.stripeCustomerId,
						setup_future_usage: "off_session" as const,
					}),
				},
				{
					idempotencyKey: `substitution-payment:${paymentId}`,
				}
			);

			await ctx.runMutation(internal.stripeHelpers.updatePayment, {
				paymentId,
				status: PAYMENT_STATUS.PROCESSING,
				stripePaymentIntentId: paymentIntent.id,
			});

			return { clientSecret: paymentIntent.client_secret, paymentId };
		} catch (error) {
			await ctx.runMutation(internal.stripeHelpers.updatePayment, {
				paymentId,
				status: PAYMENT_STATUS.FAILED,
				failureMessage:
					error instanceof Error ? error.message : "Failed to create substitution payment intent",
				failedAt: Date.now(),
			});
			throw error;
		}
	},
});

// =============================================================================
// 7c. Post-Visit Tip Charge (ADR 008, TAVLI-71 Phase 3B)
// =============================================================================

/**
 * Charges a session member's post-visit tip on their own spend (ADR 008): a
 * destination charge of exactly `tipAmount` to the restaurant's connected
 * account with **no application fee** — 100% of the tip lands with the
 * restaurant. The payment row records the whole amount as `gratuityAmount`
 * (subtotal 0, fee 0) so the tip-pool aggregation (`convex/tips.ts`) picks it
 * up by session unchanged.
 *
 * ONE-TAP FIRST, mirroring {@link createSubstitutionPaymentIntent}: the card
 * saved by the member's pay-at-submit charge in this session is charged
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
				paidByUserId: userId,
			},
		} satisfies Stripe.PaymentIntentCreateParams;

		const savedPaymentMethodId: string | null = await ctx.runQuery(
			internal.substitutions.getSavedCardForSessionMemberInternal,
			{ sessionId: args.sessionId, userId }
		);
		const customerId = await getOrCreateStripeCustomerId(ctx, stripeClient, userId);

		// ONE-TAP FIRST: charge the saved card off-session.
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

				await ctx.runMutation(internal.stripeHelpers.updatePayment, {
					paymentId,
					status: PAYMENT_STATUS.PROCESSING,
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
					await ctx.runMutation(internal.stripeHelpers.updatePayment, {
						paymentId,
						status: PAYMENT_STATUS.PROCESSING,
						stripePaymentIntentId: errorIntent.id,
					});
					return { clientSecret, paymentId };
				}

				// Genuine decline (or Stripe failure): record it and surface the
				// error — the diner can retry, superseding this row.
				await ctx.runMutation(internal.stripeHelpers.updatePayment, {
					paymentId,
					status: PAYMENT_STATUS.FAILED,
					failureMessage:
						error instanceof Error ? error.message : "Failed to charge the saved card",
					failedAt: Date.now(),
				});
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

			await ctx.runMutation(internal.stripeHelpers.updatePayment, {
				paymentId,
				status: PAYMENT_STATUS.PROCESSING,
				stripePaymentIntentId: paymentIntent.id,
			});

			return { clientSecret: paymentIntent.client_secret, paymentId };
		} catch (error) {
			await ctx.runMutation(internal.stripeHelpers.updatePayment, {
				paymentId,
				status: PAYMENT_STATUS.FAILED,
				failureMessage:
					error instanceof Error ? error.message : "Failed to create tip payment intent",
				failedAt: Date.now(),
			});
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
