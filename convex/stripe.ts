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
//   4b. Listening for connected-account payout events (TAVLI-103)
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
//   For connected-account payout events:
//     stripe listen --forward-connect-to http://localhost:3210/stripe/connected-webhook
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
import { formatMoneyCents } from "./_shared/money";
import { computeOrderCharge } from "./_shared/tip";
import { DISPUTE_ERRORS, type RecoveryQuote } from "./disputes";
import { computeDisputeDeduction } from "./disputeRecoveryHelpers";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { action, internalAction } from "./_generated/server";
import {
	AUDIT_SYSTEM_USER_ID,
	OPERATOR_ALERT_KIND,
	OPERATOR_ALERT_SEVERITY,
	ORDER_PAYMENT_STATE,
	ORDER_STATUS,
	PAYMENT_FAILURE_CODE,
	PAYMENT_KIND,
	PAYMENT_REFUND_STATUS,
	PAYMENT_STATUS,
	PAYMENT_INTENT_REUSE_MAX_AGE_MS,
	PLATFORM_APPLICATION_FEE_RATE,
	STRIPE_ACCOUNT_STATUS,
	STRIPE_PAYOUT_STATUS,
	STUCK_PAYMENT_RECONCILE_BATCH_SIZE,
	TAB_RECONCILE_ALERT_AGE_MS,
	TAB_RECONCILE_MIN_AGE_MS,
	TABLE,
	type StripeAccountStatus,
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
import {
	decidePaymentReconciliation,
	stuckPaymentAlertSeverity,
	stuckPaymentSweepKind,
	STUCK_PAYMENT_SWEEP_KIND,
} from "./paymentReconcileHelpers";
import { computePayoutFacts, type PayoutInput } from "./payoutHelpers";
import { decideTabReconciliation } from "./sessionHelpers";
import { STRIPE_NOT_CONFIGURED } from "./stripeWebhookHelpers";
import {
	handleSubscriptionCheckoutCompleted,
	handleSubscriptionDeleted,
	handleSubscriptionInvoicePaid,
	handleSubscriptionInvoicePaymentFailed,
	handleSubscriptionLifecycle,
} from "./_util/billing";
import { DINER_SESSION_ERRORS } from "./_util/dinerSession";
import { getDeploymentMarker, STRIPE_CONNECTED_ACCOUNT_WEBHOOK_SECRET_ENV } from "./_util/env";
import {
	assertRestaurantAcceptsPayments,
	getOrCreateStripeCustomerId,
	getStripeClient,
	handleAccountClosed,
	handleAccountStatusChange,
	handleChargeDisputeClosed,
	handleChargeDisputeCreated,
	handleChargeDisputeFundsReinstated,
	handleChargeDisputeUpdated,
	handleChargeRefunded,
	handlePaymentIntentFailure,
	handlePaymentIntentSuccess,
	failPaymentByKind,
	inferV2AccountStatus,
	INTENT_STAND_DOWN,
	requireStripeRestaurantAccess,
	standDownPaymentIntent,
} from "./_util/stripe";
import { isPaymentCreateInFlight, PAYMENT_SUPERSEDE_ERRORS } from "./paymentSupersedeHelpers";

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

		// Stripe already closed this account (TAVLI-65) — asking it to close it
		// again is a call that can only fail, and a failure here reports
		// `closedStripeAccount: false`, which tells the operator to go close by
		// hand an account that is already closed. The account IS closed, so say
		// so and get on with unlinking, which is the only part still outstanding.
		if (restaurant.stripeAccountStatus === STRIPE_ACCOUNT_STATUS.CLOSED) {
			await ctx.runMutation(internal.stripeHelpers.clearStripeConnection, {
				restaurantId: args.restaurantId,
			});
			return { closedStripeAccount: true, closedStripeAccountId: restaurant.stripeAccountId };
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
				accountStatus: null as StripeAccountStatus | null,
			};
		}

		// A closed account is answered from our own record, without asking Stripe
		// (TAVLI-65). Two reasons: a retrieve on a closed account has nothing
		// useful left to report and may simply fail, and the admin page needs a
		// definite answer here — it is where the operator goes to find out why
		// payments stopped, and a thrown status call would show them nothing.
		if (restaurant.stripeAccountStatus === STRIPE_ACCOUNT_STATUS.CLOSED) {
			return {
				connected: true,
				readyToReceivePayments: false,
				onboardingComplete: false,
				requirementsStatus: null as string | null,
				accountStatus: STRIPE_ACCOUNT_STATUS.CLOSED as StripeAccountStatus | null,
			};
		}

		const stripeClient = getStripeClient();
		const {
			readyToReceivePayments,
			requirementsStatus,
			onboardingComplete,
			isComplete,
			accountStatus,
		} = await inferV2AccountStatus(stripeClient, restaurant.stripeAccountId);

		if (
			isComplete !== restaurant.stripeOnboardingComplete ||
			accountStatus !== restaurant.stripeAccountStatus
		) {
			await ctx.runMutation(internal.stripeHelpers.updateOnboardingStatus, {
				restaurantId: args.restaurantId,
				stripeOnboardingComplete: isComplete,
				stripeAccountStatus: accountStatus,
			});
		}

		return {
			connected: true,
			readyToReceivePayments,
			onboardingComplete,
			requirementsStatus,
			accountStatus: accountStatus as StripeAccountStatus | null,
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
 * `stripeClient.v2.core.events.retrieve()`, or re-read the account through
 * `inferV2AccountStatus`.
 *
 * The destination is subscribed to all 15 `v2.core.account*` types so it never
 * has to be edited again (see `documentation/runbooks/stripe-go-live.md`). Of
 * those, **three** change Tavli's state:
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
 * 3. `v2.core.account.closed` (TAVLI-65)
 *    Stripe closed or rejected the account. Nothing can be charged against it
 *    again, so the restaurant is flipped out of `stripeOnboardingComplete`,
 *    recorded as `closed`, and an operator alert is raised. Before this the
 *    closure was invisible: the payment gates kept building intents and the
 *    diner met an opaque Stripe failure at the card sheet.
 *
 * The remaining 12 are listed explicitly in the switch with the reason each is
 * ignored, so "we never handled that" and "we decided that one is noise" stop
 * looking identical in the logs. A type outside all 15 still warns.
 *
 * Every event id is recorded in `stripeWebhookEvents` exactly as
 * `fulfillPayment` does, so Stripe's redeliveries cannot raise a second alert
 * or re-run a handler.
 *
 * Setup in Stripe Dashboard:
 *   1. Go to Developers > Webhooks > + Add destination
 *   2. In "Events from", select "Connected accounts"
 *   3. Select "Show advanced options" > Payload style: "Thin"
 *   4. Subscribe to every `v2.core.account*` type
 *
 * Dormant until `STRIPE_CONNECT_WEBHOOK_SECRET` is set on the deployment —
 * without it every delivery throws before the switch is reached.
 */
export const handleThinEvent = internalAction({
	args: {
		payloadString: v.string(),
		signatureHeader: v.string(),
	},
	handler: async (ctx, args) => {
		// PLACEHOLDER: Set STRIPE_CONNECT_WEBHOOK_SECRET in your Convex Dashboard.
		// This is the signing secret for your thin-event webhook endpoint,
		// separate from the standard webhook secret.
		//
		// Checked BEFORE the client is built: both this and `getStripeClient()`
		// are configuration failures, and the one an operator hits first should
		// name the variable they actually have to set. Marker first in the
		// message, so the HTTP route answers 500 ("this deployment is not
		// configured") rather than 400 ("Stripe sent something we rejected").
		const webhookSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
		if (!webhookSecret) {
			throw new Error(
				`${STRIPE_NOT_CONFIGURED}: STRIPE_CONNECT_WEBHOOK_SECRET is not set. ` +
					"Add it to your Convex deployment environment variables. " +
					"You get this secret when creating a webhook endpoint in the Stripe Dashboard."
			);
		}

		const stripeClient = getStripeClient();

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
			// Replay dedup, identical in shape to `fulfillPayment`: check first,
			// record after the handler succeeds. Stripe redelivers a thin event
			// for days until it gets a 2xx it believes, and without this a closure
			// would raise its alert and re-fetch the event on every attempt.
			const processedEvent = await ctx.runQuery(
				internal.stripeHelpers.getProcessedStripeWebhookEventInternal,
				{ eventId: eventNotification.id }
			);
			if (processedEvent) {
				return;
			}

			switch (eventNotification.type) {
				case "v2.core.account[requirements].updated":
				case "v2.core.account[configuration.recipient].capability_status_updated": {
					const accountId = eventNotification.related_object?.id;
					if (accountId) {
						await handleAccountStatusChange(ctx, stripeClient, accountId);
					}
					break;
				}

				// Stripe closed or rejected the account (TAVLI-65).
				case "v2.core.account.closed": {
					await handleAccountClosed(ctx, stripeClient, {
						id: eventNotification.id,
						relatedObjectId: eventNotification.related_object?.id,
					});
					break;
				}

				// -----------------------------------------------------------------
				// Subscribed but deliberately ignored (TAVLI-65). Recorded for dedup
				// and logged at info level; none of them changes anything Tavli
				// stores. The reason is written down per type so a future ticket can
				// promote one without first having to work out why it was dropped —
				// and so "we never handled that" stops looking like "we decided that
				// one is noise" in the logs.
				//
				// `.created`
				//   The account `createConnectAccount` just made and whose id it
				//   already persisted. Nothing to learn.
				// `.updated`
				//   Generic account mutation — name, metadata, dashboard edits. The
				//   two fields Tavli reads (requirements, the recipient capability)
				//   have their own events above, which fire alongside this one.
				// `[identity].updated`
				//   KYC identity details. Whether they are SUFFICIENT is what
				//   `[requirements].updated` reports, and only that gates payments.
				// `[future_requirements].updated`
				//   Requirements with a FUTURE deadline. `inferV2AccountStatus` reads
				//   `requirements.summary.minimum_deadline` only: acting on a deadline
				//   that has not arrived would restrict a restaurant that can take
				//   payments perfectly well today.
				// `[defaults].updated`
				//   Account-level defaults (currency, locale, responsibilities). Tavli
				//   sets currency per Restaurant and never reads Stripe's copy.
				// `[configuration.recipient].updated`
				//   The recipient configuration itself (payout schedule, external
				//   accounts). Only its CAPABILITY status decides whether transfers
				//   work, and that has its own event above.
				// `[configuration.merchant].updated` / `.capability_status_updated`
				//   Tavli charges with destination charges on the PLATFORM account, so
				//   the connected account never acts as merchant of record and its
				//   `card_payments` capability gates nothing here.
				// `[configuration.customer].updated` / `.capability_status_updated`
				//   The customer configuration is for accounts that BUY from the
				//   platform. Restaurants pay the platform subscription through Stripe
				//   Billing on their own Customer (`convex/_util/billing.ts`).
				// `account_person.created` / `.updated` / `.deleted`
				//   People attached to the account (owners, directors, reps). Their
				//   verification state reaches Tavli as the account's requirements;
				//   Tavli stores no person records of its own and must not — that is
				//   the restaurant's KYC data, not ours.
				// -----------------------------------------------------------------
				case "v2.core.account.created":
				case "v2.core.account.updated":
				case "v2.core.account[identity].updated":
				case "v2.core.account[future_requirements].updated":
				case "v2.core.account[defaults].updated":
				case "v2.core.account[configuration.recipient].updated":
				case "v2.core.account[configuration.merchant].updated":
				case "v2.core.account[configuration.merchant].capability_status_updated":
				case "v2.core.account[configuration.customer].updated":
				case "v2.core.account[configuration.customer].capability_status_updated":
				case "v2.core.account_person.created":
				case "v2.core.account_person.updated":
				case "v2.core.account_person.deleted": {
					console.log(
						`[stripe.handleThinEvent] ignored thin event type: ${eventNotification.type}`
					);
					break;
				}

				default: {
					// Outside the 15 subscribed types — a new Stripe event, or a
					// destination somebody widened by hand. Louder than the ignored
					// set on purpose: this one nobody has decided about.
					console.warn(
						`[stripe.handleThinEvent] unhandled thin event type: ${eventNotification.type}`
					);
				}
			}

			await ctx.runMutation(internal.stripeHelpers.recordStripeWebhookEvent, {
				eventId: eventNotification.id,
				eventType: eventNotification.type,
			});
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
// 4b. Connected-Account Snapshot Webhook (Payout Events) — TAVLI-103
// =============================================================================

/** The `payout.*` types this handler acts on. Anything else is logged and recorded. */
const PAYOUT_EVENT_TYPES = new Set([
	"payout.created",
	"payout.updated",
	"payout.paid",
	"payout.failed",
	"payout.canceled",
]);

/**
 * Handles **v1 snapshot events that fire on a connected account** — today, the
 * `payout.*` family (TAVLI-103).
 *
 * Why a third destination rather than one of the two we already have:
 *
 * - `POST /stripe/webhook` is scoped to **Tavli's own account**. A restaurant's
 *   payout to its own bank is an event on the restaurant's connected account, so
 *   it never lands there. (Refunds and disputes *do* land there, because our
 *   destination charges settle on the platform account — see
 *   `convex/stripeWebhookHelpers.ts`.)
 * - `POST /stripe/connect-webhook` is the **v2 thin** endpoint. Payout events are
 *   v1 snapshots carrying a full `data.object`, parsed by
 *   `webhooks.constructEvent`, not by `parseEventNotification`. Different
 *   payload, different parser, different secret — they cannot share a
 *   destination.
 *
 * So: a destination with "Events on connected accounts" selected, subscribed to
 * the `payout.*` types, pointing here, with its own
 * `STRIPE_CONNECTED_ACCOUNT_WEBHOOK_SECRET`.
 *
 * The restaurant is resolved from `event.account` (present on every
 * connected-account delivery) through `restaurants.by_stripe_account`. An
 * account **no restaurant in this deployment claims** is logged and recorded but
 * raises nothing: dev and staging share one Stripe test account, so that is
 * routine noise. The one exception is `payout.failed`, which raises a
 * **warning** (not severe) alert carrying the account id — a real restaurant's
 * money may be stuck somewhere Tavli cannot see, and that is worth a human
 * glance even if it is usually the other environment.
 *
 * Every event id is recorded in `stripeWebhookEvents` exactly as the other two
 * handlers do, so Stripe's redeliveries cannot notify a manager twice.
 *
 * Setup in Stripe Dashboard:
 *   1. Developers > Webhooks > + Add destination
 *   2. "Events from": **Connected accounts**
 *   3. Payload style: **Snapshot**
 *   4. Subscribe to `payout.created`, `payout.updated`, `payout.paid`,
 *      `payout.failed`, `payout.canceled`
 *
 * Dormant until `STRIPE_CONNECTED_ACCOUNT_WEBHOOK_SECRET` is set on the
 * deployment — without it every delivery throws before the switch is reached and
 * the route answers 500. See `documentation/runbooks/stripe-go-live.md`.
 */
export const handleConnectedAccountEvent = internalAction({
	args: {
		payloadString: v.string(),
		signatureHeader: v.string(),
	},
	handler: async (ctx, args) => {
		// Checked BEFORE the client is built, same order and same marker as the
		// other two handlers: both this and `getStripeClient()` are configuration
		// failures, and the one an operator hits first should name the variable
		// they actually have to set. The marker leads the message so the HTTP
		// route answers 500 ("this deployment is not configured") rather than 400
		// ("Stripe sent something we rejected").
		const webhookSecret = process.env[STRIPE_CONNECTED_ACCOUNT_WEBHOOK_SECRET_ENV];
		if (!webhookSecret) {
			throw new Error(
				`${STRIPE_NOT_CONFIGURED}: ${STRIPE_CONNECTED_ACCOUNT_WEBHOOK_SECRET_ENV} is not set. ` +
					"Add it to your Convex deployment environment variables. " +
					"You get this secret when creating the connected-accounts webhook destination in the Stripe Dashboard."
			);
		}

		const stripeClient = getStripeClient();

		let event: Stripe.Event;
		try {
			event = stripeClient.webhooks.constructEvent(
				args.payloadString,
				args.signatureHeader,
				webhookSecret
			);
		} catch (error) {
			console.error(
				"[stripe.handleConnectedAccountEvent]",
				buildIntegrationErrorLog(error, {
					integration: "stripe-connected-account-webhook",
					operation: "constructEvent",
				})
			);
			throw error;
		}

		try {
			const processedEvent = await ctx.runQuery(
				internal.stripeHelpers.getProcessedStripeWebhookEventInternal,
				{ eventId: event.id }
			);
			if (processedEvent) {
				return;
			}

			// Present on every connected-account delivery; absent means the
			// destination was created with the wrong scope.
			const stripeAccountId = event.account;

			if (!PAYOUT_EVENT_TYPES.has(event.type)) {
				// Louder than "ignored" but not an alert: this destination is
				// subscribed to five types, so anything else is somebody widening
				// it by hand or Stripe adding a type nobody has decided about.
				console.info(
					`[stripe.handleConnectedAccountEvent] unhandled connected-account event type: ${event.type}`,
					JSON.stringify({ eventId: event.id, stripeAccountId })
				);
			} else if (!stripeAccountId) {
				console.error(
					"[stripe.handleConnectedAccountEvent] payout event carries no `account`; " +
						"the destination is probably scoped to the platform account instead of connected accounts",
					JSON.stringify({ eventId: event.id, eventType: event.type })
				);
			} else {
				await handlePayoutEvent(ctx, {
					eventId: event.id,
					eventType: event.type,
					stripeAccountId,
					payout: event.data.object as unknown as PayoutInput,
				});
			}

			await ctx.runMutation(internal.stripeHelpers.recordStripeWebhookEvent, {
				eventId: event.id,
				eventType: event.type,
			});
		} catch (error) {
			console.error(
				"[stripe.handleConnectedAccountEvent]",
				buildIntegrationErrorLog(error, {
					integration: "stripe-connected-account-webhook",
					operation: "processEvent",
					eventType: event.type,
					eventId: event.id,
				})
			);
			throw error;
		}
	},
});

/**
 * One `payout.*` event: resolve the restaurant, persist, and let
 * `payouts.recordPayoutEventInternal` decide whether anybody needs telling.
 *
 * Split out of the switch above so the unclaimed-account branch and the
 * persistence branch each read as one thing.
 */
async function handlePayoutEvent(
	ctx: ActionCtx,
	args: {
		eventId: string;
		eventType: string;
		stripeAccountId: string;
		payout: PayoutInput;
	}
): Promise<void> {
	const facts = computePayoutFacts(args.payout, args.eventType);

	const restaurant: Doc<"restaurants"> | null = await ctx.runQuery(
		internal.stripeHelpers.getRestaurantByStripeAccountIdInternal,
		{ stripeAccountId: args.stripeAccountId }
	);

	if (!restaurant) {
		// Dev and staging share one Stripe test account, so most of these are the
		// other environment's restaurants. Recorded (by the caller) and logged,
		// never alerted — except a failure, below.
		console.info(
			"[stripe.handleConnectedAccountEvent] no restaurant claims this connected account",
			JSON.stringify({
				eventId: args.eventId,
				eventType: args.eventType,
				stripeAccountId: args.stripeAccountId,
				stripePayoutId: facts.stripePayoutId,
			})
		);

		if (facts.status === STRIPE_PAYOUT_STATUS.FAILED) {
			// A failure on an account nobody claims is either the other
			// environment (fine) or a restaurant whose link was cleared while
			// Stripe was still delivering — which is money stuck somewhere Tavli
			// can no longer see. Warning, not severe: it is usually the former,
			// and a severe alert emails every platform admin.
			await ctx.runMutation(internal.operatorAlerts.raiseOperatorAlertInternal, {
				kind: OPERATOR_ALERT_KIND.PAYOUT_FAILED,
				severity: OPERATOR_ALERT_SEVERITY.WARNING,
				stripeObjectId: args.stripeAccountId,
				dedupeKey: `payout_failed_unclaimed:${facts.stripePayoutId}`,
			});
		}
		return;
	}

	const outcome = await ctx.runMutation(internal.payouts.recordPayoutEventInternal, {
		restaurantId: restaurant._id,
		stripeAccountId: args.stripeAccountId,
		stripePayoutId: facts.stripePayoutId,
		amount: facts.amount,
		currency: facts.currency,
		status: facts.status,
		createdAt: facts.createdAt,
		arrivalDate: facts.arrivalDate,
		failureCode: facts.failureCode,
		failureMessage: facts.failureMessage,
		failureBalanceTransaction: facts.failureBalanceTransaction,
	});

	console.log(
		`[stripe.handleConnectedAccountEvent] ${args.eventType}`,
		JSON.stringify({
			stripePayoutId: facts.stripePayoutId,
			status: facts.status,
			...outcome,
		})
	);
}

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
		// PLACEHOLDER: Set STRIPE_WEBHOOK_SECRET in your Convex Dashboard.
		// You get this when creating a webhook endpoint or running `stripe listen`.
		// Checked before the client, same marker, same reason as the connect
		// handler above.
		const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
		if (!webhookSecret) {
			throw new Error(
				`${STRIPE_NOT_CONFIGURED}: STRIPE_WEBHOOK_SECRET is not set. ` +
					"Add it to your Convex deployment environment variables. " +
					"You get this secret when creating a webhook endpoint or running `stripe listen`."
			);
		}

		const stripeClient = getStripeClient();

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

				// A dispute that moves without closing (evidence submitted, the
				// bank moving it into review). Recorded so the disputes card
				// shows where the dispute actually stands, and handled for the
				// money too: Stripe can deliver a `lost` status here that never
				// arrives as a `closed` (TAVLI-102).
				case "charge.dispute.updated": {
					paymentId = await handleChargeDisputeUpdated(
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

				// We won a dispute we had already lost and Stripe has put the
				// money back. Cancels the recovery ledger row and returns
				// anything later orders had already paid down (TAVLI-102).
				case "charge.dispute.funds_reinstated": {
					paymentId = await handleChargeDisputeFundsReinstated(
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
		const patchOrderState = args.skipOrderStatePatch !== true;
		// Only the order-state patch needs an order. A tip row has none by
		// construction (ADR 008: tips are session-scoped), and the retired-tip
		// refund passes `skipOrderStatePatch` — demanding an order there would
		// throw on the one path that has money to send back (review round 2).
		if (patchOrderState && !targetOrderId) {
			throw new Error("Refund requires an order: payment has no orderId and none was supplied");
		}

		// A disputed charge cannot be refunded (TAVLI-102). Stripe answers
		// `charge_disputed`, which arrives several seconds later as an opaque
		// integration error and, worse, only AFTER the payment row has been
		// flipped to `refund_requested` and the order to `refund_requested` by
		// the patches below — leaving staff looking at an order that says a
		// refund is in progress when none ever will be.
		//
		// A LOST dispute is refused too, and that one is not Stripe's rule but
		// ours: the money already went back to the diner through the chargeback,
		// so refunding it would pay them twice, out of Tavli's balance. A WON
		// dispute releases the charge and refunding is possible again.
		//
		// Checked here rather than in each caller so `cancelOrderAndRefund` and
		// `refundOrderItem` cannot drift: both reach Stripe through this action.
		const blockingDispute: { stripeDisputeId: string; status: string } | null = await ctx.runQuery(
			internal.disputes.getBlockingDisputeForPaymentInternal,
			{
				paymentId: args.paymentId,
			}
		);
		if (blockingDispute) {
			throw fromErrorObject(new ConflictError(DISPUTE_ERRORS.PAYMENT_UNDER_DISPUTE).toObject());
		}

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
		if (patchOrderState && targetOrderId) {
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
			if (patchOrderState && targetOrderId) {
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
			if (patchOrderState && targetOrderId) {
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
 * Clears the way for a fresh PaymentIntent by standing the previous attempt's
 * intent down at Stripe — and refuses to create one when it cannot (TAVLI-104).
 *
 * Called by all three supersede paths (order, tab, tip) **before** the previous
 * row is patched to `superseded`. That order is the whole point: patching first
 * leaves a live intent whose client secret a stale tab, a back button, a double
 * tap or a retry can still confirm. Stripe then charges the card, and the
 * webhook finds a charge it cannot place against the order — money taken, order
 * never released.
 *
 * Throws a stable, diner-facing code rather than returning a flag, because every
 * "not clear" answer means the caller must create nothing:
 * - `ALREADY_PAID` — the old intent already succeeded. The webhook (or the
 *   TAVLI-105 metadata fallback) settles it; a new intent would be a second
 *   charge for the same food.
 * - `CANCEL_FAILED` — Stripe is unreachable. We cannot prove the old intent is
 *   dead, so adding a second live one is the one thing we must not do. The
 *   checkout shows "try again".
 * - `IN_PROGRESS` — the previous attempt's create call is still running, so
 *   there is no intent id to cancel yet (see `isPaymentCreateInFlight`).
 *
 * Returns silently when there is nothing live at Stripe: no previous attempt, a
 * terminal row, or a row that never reached Stripe. The caller's own patch to
 * `superseded` then runs unchanged.
 */
async function standDownPreviousAttempt(
	stripeClient: Stripe,
	previous: Doc<"payments"> | null,
	operation: string,
	nowMs: number = Date.now()
): Promise<void> {
	if (!previous) return;
	// Terminal rows (succeeded, failed, superseded, cancelled) have nothing live
	// at Stripe for a loose client secret to confirm.
	if (previous.status !== PAYMENT_STATUS.PENDING && previous.status !== PAYMENT_STATUS.PROCESSING) {
		return;
	}

	if (isPaymentCreateInFlight(previous, nowMs)) {
		throw fromErrorObject(new ConflictError(PAYMENT_SUPERSEDE_ERRORS.IN_PROGRESS).toObject());
	}

	// Past the in-flight window with no intent id: the create never landed, so
	// there is nothing to cancel and the row is debris a retry may claim.
	if (!previous.stripePaymentIntentId) return;

	const { outcome } = await standDownPaymentIntent(
		stripeClient,
		previous.stripePaymentIntentId,
		operation
	);
	if (outcome === INTENT_STAND_DOWN.SUCCEEDED) {
		throw fromErrorObject(new ConflictError(PAYMENT_SUPERSEDE_ERRORS.ALREADY_PAID).toObject());
	}
	if (outcome === INTENT_STAND_DOWN.UNREACHABLE) {
		throw fromErrorObject(new ConflictError(PAYMENT_SUPERSEDE_ERRORS.CANCEL_FAILED).toObject());
	}
}

/**
 * The intent just created does not belong to this row after all — it was
 * retired, or claimed by another intent, while the create call was running
 * (sign-off nit).
 *
 * Every create path ends the same way: attach the intent to the row, then hand
 * its client secret to the diner. When the attach is REFUSED, that second step
 * would hand out a secret for an intent nothing is watching — the row will
 * never be settled from it, and `attachIntentToPayment` has already scheduled
 * its stand-down at Stripe. Re-pointing the order at it would be worse still.
 *
 * So the create paths stop here with ERROR_PAYMENT_IN_PROGRESS, which is
 * precisely what happened: another attempt owns this payment now. The checkout
 * page already maps that code ("Your payment is already going through. Give it
 * a moment rather than tapping again.") and the diner's next tap creates a
 * fresh intent against whatever the live attempt turns out to be.
 */
function throwSupersededMidCreate(operation: string, paymentId: Id<"payments">): never {
	console.error("[stripe] INTENT CREATED FOR A ROW THAT NO LONGER OWNS IT", {
		operation,
		paymentId,
	});
	throw fromErrorObject(new ConflictError(PAYMENT_SUPERSEDE_ERRORS.IN_PROGRESS).toObject());
}

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
		// The connected account has to exist AND be accepting payments. Narrowing
		// `stripeAccountId` here is what later gives `transfer_data.destination` a
		// `string`; the policy itself lives in `assertRestaurantAcceptsPayments`
		// so a closed or restricted account is refused identically on every path.
		if (!restaurant?.stripeAccountId) {
			throw fromErrorObject(
				new ConflictError("ERROR_RESTAURANT_NOT_ACCEPTING_PAYMENTS").toObject()
			);
		}
		assertRestaurantAcceptsPayments(restaurant);

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
			!!latestPayment.stripePaymentIntentId &&
			// Not so old that the stuck-payment sweep is about to cancel it
			// (TAVLI-106 sign-off). Handing back a secret we are minutes from
			// invalidating means a diner who reopened checkout gets their payment
			// killed mid-typing, for no reason they could see. An older row falls
			// through to the stand-down + supersede + fresh-intent path below,
			// which is what a stale attempt already gets.
			Date.now() - latestPayment.createdAt < PAYMENT_INTENT_REUSE_MAX_AGE_MS;

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

		// Stripe FIRST, then the row (TAVLI-104). The intent we are about to
		// abandon is the one holding a client secret the diner's browser already
		// has; patching the row first would retire our record of a charge that can
		// still happen. Throws a stable code when the way is not clear, which is
		// the diner's cue to try again — or the webhook's cue to settle the charge
		// that beat us.
		await standDownPreviousAttempt(stripeClient, latestPayment, "createPaymentIntent");

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

		// Dispute recovery (TAVLI-102). A restaurant that lost a chargeback pays
		// it back out of its later ORDER payments — never a tip charge, never a
		// tab — a capped percentage at a time.
		//
		// `restaurantShare` is what Stripe would transfer with no deduction
		// (`amount − application_fee_amount`, i.e. subtotal + gratuity), and
		// `recoveryBase` is the food subtotal alone, so the whole gratuity
		// always reaches the restaurant. The diner's `amount` is NOT touched:
		// they pay exactly what the checkout sheet said, and the order still
		// reports full revenue.
		const recoveryQuote: RecoveryQuote = await ctx.runQuery(
			internal.disputes.getRecoveryQuoteInternal,
			{ restaurantId: order.restaurantId }
		);
		const restaurantShare = subtotalAmount + gratuityAmount;
		const disputeRecoveryAmount = computeDisputeDeduction({
			restaurantShare,
			recoveryBase: subtotalAmount,
			percent: recoveryQuote.percent,
			totalOutstanding: recoveryQuote.totalOutstanding,
		});

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
			...(disputeRecoveryAmount > 0 && {
				disputeRecoveryAmount,
				disputeRecoveryIds: recoveryQuote.recoveryIds,
			}),
			// The attempt this call stood down, re-checked inside the inserting
			// transaction (TAVLI-104 review round 1). Everything above ran against
			// a snapshot; two diners tapping Pay within the same second both pass
			// these checks, and only the transaction can order them. `createPayment`
			// also moves the order's `activePaymentId` in that same transaction, so
			// the two taps collide on the order document and OCC serialises them.
			...(latestPayment && { supersededPaymentId: latestPayment._id }),
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
						// Explicit from TAVLI-102 onward. Left unset, Stripe
						// transfers `amount − application_fee_amount`, which is
						// exactly `restaurantShare` — so with no deduction this
						// is byte-for-byte the previous behaviour, stated rather
						// than inferred. With one, it is the only place the
						// recovery actually moves money.
						amount: restaurantShare - disputeRecoveryAmount,
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
						// Only when there is something to explain. An operator
						// reading the PaymentIntent in the Stripe Dashboard needs
						// to know why a transfer is short; a `0` on every intent
						// that never had a dispute is noise, and it would make the
						// request differ from the pre-TAVLI-102 one for no reason.
						...(disputeRecoveryAmount > 0 && {
							disputeRecoveryAmount: String(disputeRecoveryAmount),
						}),
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
			const { attached } = await ctx.runMutation(internal.stripeHelpers.attachIntentToPayment, {
				paymentId,
				stripePaymentIntentId: paymentIntent.id,
			});
			// Refused: the order must NOT be re-pointed at this intent, and its
			// client secret must not reach the diner.
			if (!attached) throwSupersededMidCreate("createPaymentIntent", paymentId);

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
		// The three-way read lives in `standDownPaymentIntent`, shared with the
		// supersede paths (TAVLI-104); this caller rethrows on `unreachable`
		// because an abandon that did not reach Stripe must not report success.
		if (payment.stripePaymentIntentId) {
			const { outcome, error } = await standDownPaymentIntent(
				getStripeClient(),
				payment.stripePaymentIntentId,
				"cancelOrderPaymentIntent"
			);
			if (outcome === INTENT_STAND_DOWN.SUCCEEDED) {
				// The charge won the race; let the webhook settle the order.
				return { cancelled: false, settled: true };
			}
			if (outcome === INTENT_STAND_DOWN.UNREACHABLE) {
				throw error;
			}
		}

		const cancelled: boolean = await ctx.runMutation(internal.orders.cancelActivePaymentInternal, {
			orderId: args.orderId,
			userId: identity.subject,
		});
		return { cancelled, settled: false };
	},
});

/**
 * Stands a superseded attempt's intent down at Stripe from a mutation's
 * scheduler hop (TAVLI-104).
 *
 * The one caller is `orders.confirmPayment`'s accept-and-adopt branch: a charge
 * arrived for a payment the order had stopped pointing at, the amount still
 * matches what the order costs, so that payment is adopted and the NEWER row
 * loses. The newer row's intent has to come down, and `confirmPayment` is a
 * mutation — it can neither call Stripe nor await one.
 *
 * So the row is patched inside the transaction and the Stripe call is scheduled,
 * which inverts this ticket's Stripe-first rule for exactly this path. It is the
 * only ordering a mutation can achieve, and the residual risk is already
 * covered: if the newer intent is confirmed in that window, its own
 * `payment_intent.succeeded` finds the order paid by another payment and takes
 * the refund-and-alert branch. A duplicate charge is refunded and surfaced
 * rather than lost.
 *
 * The second caller is `stripeHelpers.attachIntentToPayment`, which refuses to
 * write an intent id onto a row that was retired while its own create call was
 * still running. It has an intent nobody is waiting for and no row to read it
 * off, so it passes `stripePaymentIntentId` explicitly — that is the only
 * reason the argument is optional rather than always read from the row.
 *
 * Never throws: a failure here leaves an abandoned intent at Stripe, which
 * expires on its own, and throwing would only retry the scheduled job.
 */
export const standDownSupersededIntent = internalAction({
	args: {
		paymentId: v.id(TABLE.PAYMENTS),
		/** The orphaned intent, when the row was never allowed to record it. */
		stripePaymentIntentId: v.optional(v.string()),
	},
	handler: async (ctx, args): Promise<void> => {
		const payment: Doc<"payments"> | null = await ctx.runQuery(
			internal.stripeHelpers.getPaymentInternal,
			{ paymentId: args.paymentId }
		);
		if (!payment) return;
		const intentId = args.stripePaymentIntentId ?? payment.stripePaymentIntentId;
		if (!intentId) return;
		// Settled between the patch and this job: the money is real and the
		// webhook owns it. Cancelling is impossible and pretending otherwise
		// would be worse.
		if (payment.status === PAYMENT_STATUS.SUCCEEDED) return;

		const { outcome } = await standDownPaymentIntent(
			getStripeClient(),
			intentId,
			"standDownSupersededIntent"
		);
		if (outcome === INTENT_STAND_DOWN.SUCCEEDED) {
			// The retired intent was confirmed anyway, so a charge exists that no
			// live payment row accounts for. When it belongs to an order, its own
			// `payment_intent.succeeded` will find the order paid (or repriced) and
			// refund it. When it is a tip — the one-tap path, where the money moves
			// inside the create call this row lost the race to — there is no such
			// second chance: nothing else will look at it again. So the alert is
			// raised here, for both, rather than trusting a follow-up that only one
			// of them gets.
			console.error("[stripe.standDownSupersededIntent] RETIRED INTENT ALREADY SUCCEEDED", {
				paymentId: payment._id,
				paymentKind: payment.kind ?? "legacy",
				stripePaymentIntentId: redactExternalId(intentId),
			});
			await ctx.runMutation(internal.operatorAlerts.raiseOperatorAlertInternal, {
				kind: OPERATOR_ALERT_KIND.CHARGE_NEEDS_REVIEW,
				severity: OPERATOR_ALERT_SEVERITY.SEVERE,
				restaurantId: payment.restaurantId,
				...(payment.orderId && { orderId: payment.orderId }),
				paymentId: payment._id,
				stripeObjectId: intentId,
				messageParams: {
					collected: formatMoneyCents(payment.amount),
					currency: payment.currency.toUpperCase(),
				},
				dedupeKey: `charge_on_retired_attempt:${payment._id}`,
			});
		}
	},
});

/**
 * Refunds a charge Tavli collected but cannot account for (TAVLI-104).
 *
 * Scheduled by `orders.confirmPayment` when a `payment_intent.succeeded` arrives
 * for an order that has since been repriced (or already paid by another
 * payment): the money is real, the order it names no longer costs that, and
 * keeping it would mean charging a diner for something they did not buy. The
 * mutation cannot refund — refunds are Stripe calls — so it records the intent
 * to refund (`refundStatus: requested` on a `succeeded` row) and hands the
 * Stripe half to this action via `runAfter(0)`.
 *
 * Idempotent twice over: the row is checked for a refund that already landed,
 * and `createRefund` carries a payment-scoped idempotency key, so a redelivery
 * or a retried job cannot refund the same charge twice.
 *
 * `skipOrderStatePatch` is deliberate. `createRefund` would otherwise walk the
 * ORDER through `refund_requested` → `refunded`, and this order was never paid —
 * it is unpaid and still owed. The payment row carries the refund facts; the
 * order stays where `confirmPayment` left it.
 */
export const refundStrandedCharge = internalAction({
	args: {
		paymentId: v.id(TABLE.PAYMENTS),
		orderId: v.optional(v.id(TABLE.ORDERS)),
	},
	handler: async (ctx, args): Promise<void> => {
		const payment: Doc<"payments"> | null = await ctx.runQuery(
			internal.stripeHelpers.getPaymentInternal,
			{ paymentId: args.paymentId }
		);
		if (!payment?.stripePaymentIntentId) {
			console.error("[stripe.refundStrandedCharge] NO INTENT TO REFUND", {
				paymentId: args.paymentId,
			});
			return;
		}
		// Already refunded (by a previous run of this job, by the operator, or by
		// the `charge.refunded` webhook recording one made in the Dashboard).
		if (
			payment.stripeRefundId ||
			payment.refundStatus === PAYMENT_REFUND_STATUS.SUCCEEDED ||
			payment.refundStatus === PAYMENT_REFUND_STATUS.PARTIAL
		) {
			return;
		}

		await ctx.runAction(internal.stripe.createRefund, {
			paymentId: args.paymentId,
			...(args.orderId !== undefined && { orderId: args.orderId }),
			// Scoped to the payment, and distinct from the operator-initiated
			// `refund:<paymentId>` key so the two can never collide on different
			// amounts at Stripe.
			idempotencyKey: `stranded-charge-refund:${args.paymentId}`,
			skipOrderStatePatch: true,
		});
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
		// The connected account has to exist AND be accepting payments. Narrowing
		// `stripeAccountId` here is what later gives `transfer_data.destination` a
		// `string`; the policy itself lives in `assertRestaurantAcceptsPayments`
		// so a closed or restricted account is refused identically on every path.
		if (!restaurant?.stripeAccountId) {
			throw fromErrorObject(
				new ConflictError("ERROR_RESTAURANT_NOT_ACCEPTING_PAYMENTS").toObject()
			);
		}
		assertRestaurantAcceptsPayments(restaurant);

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
		// Stripe FIRST, then the row (TAVLI-104). Two things this catches that the
		// branch above cannot:
		// - A PROCESSING row whose intent is still live (the branch above only
		//   returns early when it can hand back a client secret). Retiring the row
		//   while that intent stands leaves the diner's sheet able to charge a tip
		//   nobody will record.
		// - The double tap. A PENDING row with no intent id, younger than
		//   `PAYMENT_CREATE_IN_FLIGHT_WINDOW_MS`, has a `confirm: true` create in
		//   flight RIGHT NOW — the money is moving inside that call. Superseding it
		//   is how one tap became two tips; `standDownPreviousAttempt` throws
		//   ERROR_PAYMENT_IN_PROGRESS instead.
		await standDownPreviousAttempt(stripeClient, existingPayment, "createTipCharge");

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
			// Re-checked inside the transaction — see the order path. On this path
			// the collision is on the session's tip rows rather than an order
			// document, and it matters more: the one-tap charge moves money inside
			// `paymentIntents.create`, so two taps that both get a row are two
			// tips.
			...(existingPayment && { supersededPaymentId: existingPayment._id }),
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
				const { attached } = await ctx.runMutation(internal.stripeHelpers.attachIntentToPayment, {
					paymentId,
					stripePaymentIntentId: paymentIntent.id,
					stripePaymentMethodId: savedPaymentMethodId,
				});
				// Refused: this row was retired mid-charge, so the money that just
				// moved belongs to no live attempt. It is already being stood down
				// (and refunded, if it went through) — the diner is told the live
				// attempt owns this tip rather than being handed a second one.
				if (!attached) throwSupersededMidCreate("createTipCharge", paymentId);
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
					const { attached } = await ctx.runMutation(internal.stripeHelpers.attachIntentToPayment, {
						paymentId,
						stripePaymentIntentId: errorIntent.id,
					});
					if (!attached) throwSupersededMidCreate("createTipCharge3ds", paymentId);
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

			const { attached } = await ctx.runMutation(internal.stripeHelpers.attachIntentToPayment, {
				paymentId,
				stripePaymentIntentId: paymentIntent.id,
			});
			if (!attached) throwSupersededMidCreate("createTipChargeElements", paymentId);

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
		// The connected account has to exist AND be accepting payments. Narrowing
		// `stripeAccountId` here is what later gives `transfer_data.destination` a
		// `string`; the policy itself lives in `assertRestaurantAcceptsPayments`
		// so a closed or restricted account is refused identically on every path.
		if (!restaurant?.stripeAccountId) {
			throw fromErrorObject(
				new ConflictError("ERROR_RESTAURANT_NOT_ACCEPTING_PAYMENTS").toObject()
			);
		}
		assertRestaurantAcceptsPayments(restaurant);

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

		// Stripe FIRST, then the row (TAVLI-104) — and that is why the cancel lives
		// HERE rather than in `beginTabPayment`.
		//
		// `beginTabPayment` is the mutation that patches the previous attempt to
		// `superseded`, and a mutation cannot call Stripe. Two designs were
		// available: a `supersede_pending` status the mutation writes and a
		// scheduled action cancels, or moving the Stripe half of the supersede up
		// into this action. This is the second. The first adds a payment status to
		// the schema whose only meaning is "an action owes Stripe a call", and it
		// is asynchronous by construction — `runAfter(0)` can land after the new
		// intent exists, which is exactly the window this ticket closes. Doing it
		// here is synchronous and ordered: nothing is created, and no row is
		// touched, until the old intent is provably dead. `beginTabPayment` keeps
		// the transactional half (the balance re-check, the lock, the `superseded`
		// patch) untouched.
		if (tab.activePaymentId) {
			const previous: Doc<"payments"> | null = await ctx.runQuery(
				internal.stripeHelpers.getPaymentInternal,
				{ paymentId: tab.activePaymentId }
			);
			await standDownPreviousAttempt(stripeClient, previous, "createTabPaymentIntent");
		}

		// Locks the tab, supersedes any prior attempt, and re-validates the
		// balance inside the transaction — including WHICH attempt it is retiring
		// (TAVLI-104 review round 1). Any tab member can pay, so two people
		// tapping Pay at the same moment is a normal Tuesday: both read the same
		// `activePaymentId`, both stand the same intent down, and without the id
		// below the mutation would retire whatever it found at commit time and
		// hand the tab to the second row while the first diner is looking at a
		// live client secret for the first.
		const paymentId: Id<"payments"> = await ctx.runMutation(internal.sessions.beginTabPayment, {
			sessionId: args.sessionId,
			restaurantId: tab.restaurantId,
			amount: totalAmount,
			currency,
			gratuityAmount: args.tipAmount,
			userId: identity.subject,
			...(tab.activePaymentId && { supersededPaymentId: tab.activePaymentId }),
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

			const { attached } = await ctx.runMutation(internal.sessions.markTabPaymentProcessing, {
				sessionId: args.sessionId,
				paymentId,
				stripePaymentIntentId: paymentIntent.id,
			});
			// Refused: another member's tap owns the tab now, and the session must
			// not be moved to `processing` for an intent nothing is watching.
			if (!attached) throwSupersededMidCreate("createTabPaymentIntent", paymentId);

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

/**
 * Stuck ORDER and TIP payment reconciliation (TAVLI-106).
 *
 * The sibling of {@link reconcileStuckTabPayments}, for the two payment kinds
 * that had no backstop at all. Tab settlement has been protected since
 * TAVLI-45; an order or a tip that lost its `payment_intent.succeeded` was
 * simply lost. The diner's card was charged and the kitchen was never released
 * to cook their round; or the post-visit tip was charged and the member who
 * earned it was never credited. Every other path in the system is waiting for
 * that same webhook, so nothing else was ever going to notice.
 *
 * The shape is deliberately the tab sweep's: candidates from one indexed range,
 * one `paymentIntents.retrieve` each, a pure decision, then act. What differs:
 *
 * - **Settling reuses the webhook handler, unconditionally.**
 *   `handlePaymentIntentSuccess` already asserts the amount (TAVLI-69), repairs
 *   a row that lost the metadata race (TAVLI-105), refuses retired rows and
 *   applies the accept-or-refund policies (TAVLI-104). Re-implementing any of
 *   that here is how the two paths drift.
 *
 *   The tab sweep compares the amount itself *before* dispatching, and this one
 *   deliberately does not. That pre-check exists because a mismatched TAB stays
 *   a candidate forever — nothing clears `lockedForPaymentAt` — so the handler
 *   would re-raise a severe alert every five minutes once an admin acknowledged
 *   it. Here the handler's own mismatch branch fails the row, which takes it out
 *   of `status = processing` and therefore out of this sweep's range for good.
 *   One detection, one alert, no repetition.
 *
 *   The rule the two sweeps do share: **when the handler alerts, this action
 *   does not.** `payment_stuck` is raised only by the `alert` branch below,
 *   never on top of an `amount_mismatch` or a `charge_unmatched` the handler
 *   just raised for the same payment.
 *
 * - **A dead attempt is cleared, not just marked** (carried from TAVLI-104's
 *   review). See the `clear` branch.
 *
 * Per-candidate errors are caught and logged: one unreachable intent must not
 * cost the other ninety-nine candidates their run. The action itself never
 * throws, so the cron is never retried for a single bad row.
 */
export const reconcileStuckPayments = internalAction({
	args: {},
	handler: async (ctx): Promise<void> => {
		const now = Date.now();
		const candidates: Doc<"payments">[] = await ctx.runQuery(internal.payments.listStuckPayments, {
			now,
			limit: STUCK_PAYMENT_RECONCILE_BATCH_SIZE,
		});
		if (candidates.length === 0) return;

		const stripeClient = getStripeClient();

		for (const payment of candidates) {
			const stripePaymentIntentId = payment.stripePaymentIntentId;
			// Narrowing only — `listStuckPayments` drops rows without an intent.
			if (!stripePaymentIntentId) continue;

			// The candidate query excluded legacy tab rows, so this is never null.
			const kind = stuckPaymentSweepKind(payment);
			if (kind === null) continue;

			// TRUE age, from `createdAt` — how long somebody has actually been
			// waiting. Not `updatedAt`, which the candidate query uses for "this
			// row stopped moving": a late status-preserving patch (a
			// `stripeChargeId`, a `latestStripeEventId`) would otherwise buy a
			// stuck payment another fifteen minutes of silence.
			const ageMs = now - payment.createdAt;

			try {
				const paymentIntent: Stripe.PaymentIntent =
					await stripeClient.paymentIntents.retrieve(stripePaymentIntentId);

				const decision = decidePaymentReconciliation({
					paymentIntentStatus: paymentIntent.status,
					ageMs,
					kind,
				});

				switch (decision) {
					case "settle": {
						// Exactly what the webhook would have done, including the
						// amount assertion and its own alerting. Nothing is added.
						await handlePaymentIntentSuccess(ctx, paymentIntent);
						break;
					}

					case "clear": {
						// ---------------------------------------------------------
						// THE ATTEMPT IS DEAD. RETIRE IT (carried from TAVLI-104's
						// review).
						//
						// Stripe says `canceled`, or the intent has sat waiting on
						// the customer (`requires_payment_method`, `requires_action`,
						// `requires_confirmation`) for the kind's full patience — a
						// declined card, or a payment sheet opened and walked away
						// from. Either way nobody is going to pay with it, and an
						// abandoned intent does not expire at Stripe on its own.
						//
						// Leaving the row `processing` is not neutral. A served,
						// cash-owed round whose order still points at a
						// pending/processing attempt makes `markOrderPaidInPerson`
						// throw ERROR_ORDER_PAYMENT_IN_FLIGHT, and there is no
						// staff-side release: the diner has eaten, wants to pay
						// cash, and the till refuses them because of a card sheet
						// they closed twenty minutes ago.
						//
						// STRIPE FIRST. A `requires_payment_method` intent is still
						// live, and its client secret may be sitting in a stale tab.
						// Retiring our row first would leave a window in which staff
						// take cash and that tab then charges the card. Skipped only
						// when Stripe already reports `canceled`, where there is
						// nothing left to stand down.
						// ---------------------------------------------------------
						if (paymentIntent.status !== "canceled") {
							const { outcome } = await standDownPaymentIntent(
								stripeClient,
								stripePaymentIntentId,
								"reconcileStuckPayments"
							);
							if (outcome === INTENT_STAND_DOWN.SUCCEEDED) {
								// The card was charged between our retrieve and our
								// cancel. Nothing is retired: the webhook settles it,
								// and if that is dropped too the next run of this
								// sweep sees `succeeded` and settles it here.
								console.error(
									"[stripe.reconcileStuckPayments] ABANDONED INTENT CHARGED MID-SWEEP",
									{
										paymentId: payment._id,
										paymentIntentId: redactExternalId(stripePaymentIntentId),
									}
								);
								break;
							}
							if (outcome === INTENT_STAND_DOWN.UNREACHABLE) {
								// We do not know whether the intent is live, so we do
								// not get to say the attempt is over. Already logged
								// by `standDownPaymentIntent`; the next run retries.
								break;
							}
						}

						// An ORDER row gets the manager-cancel treatment first: it
						// marks the row CANCELLED *and* clears the order's payment
						// pointer, which is the state the diner's own abandon leaves
						// behind. `expectedPaymentId` keeps it from touching a newer
						// attempt the diner started while this run was in flight.
						//
						// It refuses an order past `awaiting_payment` — which is
						// precisely the served, cash-owed round above — so the
						// fallback is `failPaymentByKind`, the same routing the
						// webhook's decline path uses. FAILED is terminal, so
						// `markOrderPaidInPerson` stops refusing either way; the
						// pointer simply stays where a real card decline would have
						// left it.
						const cancelled =
							kind === STUCK_PAYMENT_SWEEP_KIND.ORDER && payment.orderId !== undefined
								? await ctx.runMutation(internal.orders.cancelActivePaymentInternal, {
										orderId: payment.orderId,
										userId: AUDIT_SYSTEM_USER_ID,
										expectedPaymentId: payment._id,
									})
								: false;

						if (!cancelled) {
							await failPaymentByKind(ctx, payment, {
								stripePaymentIntentId,
								failureCode: `reconcile_${paymentIntent.status}`,
								failureMessage: `Reconciled by the stuck-payment sweep: PaymentIntent status is ${paymentIntent.status}`,
								// Only while the row is still in flight (sign-off nit).
								// A `payment_intent.payment_failed` may have landed
								// between the candidate read and this call, in which
								// case the row already carries the decline code the
								// diner's bank gave — and "PaymentIntent status is
								// canceled" would replace the only useful fact on it
								// with a restatement of what the sweep just saw.
								onlyIfInFlight: true,
							});
						}
						break;
					}

					case "alert": {
						// ---------------------------------------------------------
						// ONE ALERT PER PAYMENT, EVER (review round 1).
						//
						// Nothing is patched here: the intent is mid-flight at Stripe
						// (or in a state this code has never seen), so only a human
						// can say what it should become. Which means the row stays
						// `processing` and stays a candidate — this branch re-runs
						// against the same unchanged fact every five minutes until
						// somebody resolves it.
						//
						// `dedupeKey` alone does not survive that, because it is
						// scoped to OPEN alerts by design: the moment an admin
						// acknowledges this row the next sweep raises a fresh severe
						// one and mails every platform admin again — 288 times a day,
						// punishing them for clearing their inbox. So the key is
						// widened to collapse ACKNOWLEDGED rows too. It is safe
						// precisely because the key names ONE PAYMENT: there is no
						// second, genuinely-new occurrence of "this payment is stuck"
						// to lose.
						//
						// The other half of the same finding lives in the decision
						// table: the customer-side statuses now CLEAR at the alert
						// age instead of alerting, so an abandoned `requires_action`
						// intent — which never expires at Stripe — leaves
						// `processing` rather than becoming a permanent alert.
						// ---------------------------------------------------------
						const minutes = Math.round(ageMs / 60000);
						console.error(
							`[stripe.reconcileStuckPayments] payment ${payment._id} (${kind}) has been ` +
								`${paymentIntent.status} for ${minutes}m. Needs operator attention.`
						);

						await ctx.runMutation(internal.operatorAlerts.raiseOperatorAlertInternal, {
							kind: OPERATOR_ALERT_KIND.PAYMENT_STUCK,
							severity: stuckPaymentAlertSeverity(kind, ageMs),
							restaurantId: payment.restaurantId,
							...(payment.orderId !== undefined && { orderId: payment.orderId }),
							paymentId: payment._id,
							stripeObjectId: stripePaymentIntentId,
							messageParams: { kind, minutes },
							dedupeKey: `payment_stuck:${payment._id}`,
							dedupeAcrossAcknowledged: true,
						});
						break;
					}

					case "wait":
						break;
				}
			} catch (error) {
				console.error(
					"[stripe.reconcileStuckPayments]",
					buildIntegrationErrorLog(error, {
						integration: "stripe",
						operation: "reconcileStuckPayments",
						restaurantId: payment.restaurantId,
						eventId: stripePaymentIntentId,
					})
				);
			}
		}
	},
});
