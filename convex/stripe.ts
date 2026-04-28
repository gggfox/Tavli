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
import Stripe from "stripe";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalAction } from "./_generated/server";
import {
	ORDER_PAYMENT_STATE,
	PAYMENT_REFUND_STATUS,
	PAYMENT_STATUS,
	TABLE,
	USER_ROLES,
} from "./constants";
import { fromErrorObject, NotAuthenticatedError, NotAuthorizedError, NotFoundError } from "./_shared/errors";
import { getCurrentUserId } from "./_util/auth";

// =============================================================================
// Stripe Client Factory
// =============================================================================

/**
 * Creates and returns a Stripe client instance configured with the platform's
 * secret key. The SDK automatically uses the latest API version (2026-03-25.dahlia)
 * so we do not need to set it explicitly.
 *
 * All Stripe API calls in this module go through this client.
 */
function getStripeClient(): Stripe {
	// PLACEHOLDER: Set STRIPE_SECRET_KEY in your Convex Dashboard environment variables.
	// Get your key from https://dashboard.stripe.com/apikeys
	const key = process.env.STRIPE_SECRET_KEY;
	if (!key) {
		throw new Error(
			"STRIPE_SECRET_KEY is not set. " +
				"Add it to your Convex deployment environment variables in the Convex Dashboard. " +
				"You can find your secret key at https://dashboard.stripe.com/apikeys"
		);
	}
	return new Stripe(key);
}

async function requireStripeRestaurantAccess(
	ctx: any,
	restaurantId: Id<"restaurants">
): Promise<Doc<"restaurants">> {
	const [userId, authError] = await getCurrentUserId(ctx);
	if (authError) throw fromErrorObject(authError);

	const restaurant: Doc<"restaurants"> | null = await ctx.runQuery(
		internal.stripeHelpers.getRestaurantInternal,
		{ restaurantId }
	);
	if (!restaurant) {
		throw fromErrorObject(new NotFoundError("Restaurant not found").toObject());
	}

	const userRole = await ctx.runQuery(internal.stripeHelpers.getUserRoleInternal, {
		userId,
	});
	const roles = userRole?.roles ?? [];
	const isAdmin = roles.includes(USER_ROLES.ADMIN);
	if (!isAdmin && restaurant.ownerId !== userId) {
		throw fromErrorObject(new NotAuthorizedError("NOT_AUTHORIZED").toObject());
	}

	return restaurant;
}

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
			// eslint-disable-next-line no-console
			console.error(
				`[stripe.resetStripeConnection] Failed to close Stripe account ${restaurant.stripeAccountId}; clearing Convex link anyway:`,
				err
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

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const account: any = await stripeClient.v2.core.accounts.retrieve(restaurant.stripeAccountId, {
			include: ["configuration.recipient", "requirements"],
		});

		const readyToReceivePayments: boolean =
			account?.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status ===
			"active";

		const requirementsStatus: string | null =
			account?.requirements?.summary?.minimum_deadline?.status ?? null;
		const onboardingComplete =
			requirementsStatus !== "currently_due" && requirementsStatus !== "past_due";

		const isComplete = readyToReceivePayments && onboardingComplete;
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

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const thinEvent = (stripeClient as any).parseThinEvent(
			args.payloadString,
			args.signatureHeader,
			webhookSecret
		);

		const event = await stripeClient.v2.core.events.retrieve(thinEvent.id);

		switch (event.type) {
			case "v2.core.account[requirements].updated":
			case "v2.core.account[configuration.recipient].capability_status_updated": {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const accountId = (event as any).related_object?.id;
				if (accountId) {
					await handleAccountStatusChange(ctx, stripeClient, accountId);
				}
				break;
			}
			default: {
				console.log(`Unhandled thin event type: ${event.type}`);
			}
		}
	},
});

/**
 * Shared helper for thin event handlers: re-fetches the V2 account,
 * determines the current onboarding/payment status, and updates the
 * restaurant record in our DB.
 */
async function handleAccountStatusChange(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	ctx: any,
	stripeClient: Stripe,
	stripeAccountId: string
): Promise<void> {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const account: any = await stripeClient.v2.core.accounts.retrieve(stripeAccountId, {
		include: ["configuration.recipient", "requirements"],
	});

	const readyToReceivePayments: boolean =
		account?.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status ===
		"active";

	const requirementsStatus: string | null =
		account?.requirements?.summary?.minimum_deadline?.status ?? null;
	const onboardingComplete =
		requirementsStatus !== "currently_due" && requirementsStatus !== "past_due";

	const isComplete = readyToReceivePayments && onboardingComplete;

	await ctx.runMutation(internal.stripeHelpers.updateOnboardingByAccountId, {
		stripeAccountId,
		stripeOnboardingComplete: isComplete,
	});
}

async function handlePaymentIntentSuccess(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	ctx: any,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	paymentIntent: any
): Promise<Id<"payments"> | undefined> {
	const payment: Doc<"payments"> | null = await ctx.runQuery(
		internal.stripeHelpers.getPaymentByPaymentIntentIdInternal,
		{
			stripePaymentIntentId: paymentIntent.id,
		}
	);
	if (!payment) return undefined;

	const chargeId =
		typeof paymentIntent.latest_charge === "string"
			? paymentIntent.latest_charge
			: (paymentIntent.latest_charge?.id ?? undefined);

	await ctx.runMutation(internal.orders.confirmPayment, {
		paymentId: payment._id,
		stripePaymentIntentId: paymentIntent.id,
		stripeChargeId: chargeId,
	});
	return payment._id;
}

async function handlePaymentIntentFailure(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	ctx: any,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	paymentIntent: any
): Promise<Id<"payments"> | undefined> {
	const payment: Doc<"payments"> | null = await ctx.runQuery(
		internal.stripeHelpers.getPaymentByPaymentIntentIdInternal,
		{
			stripePaymentIntentId: paymentIntent.id,
		}
	);
	if (!payment) return undefined;

	await ctx.runMutation(internal.orders.failPayment, {
		paymentId: payment._id,
		stripePaymentIntentId: paymentIntent.id,
		failureCode: paymentIntent.last_payment_error?.code ?? undefined,
		failureMessage: paymentIntent.last_payment_error?.message ?? undefined,
	});
	return payment._id;
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
 * - `account.updated` — legacy V1 account status updates
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

		const event = stripeClient.webhooks.constructEvent(
			args.payloadString,
			args.signatureHeader,
			webhookSecret
		);

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
	},
});

// =============================================================================
// 6. Refund
// =============================================================================

/**
 * Creates a refund for a PaymentIntent. Called internally when a staff member
 * cancels a paid order.
 */
export const createRefund = internalAction({
	args: {
		paymentId: v.id(TABLE.PAYMENTS),
	},
	handler: async (
		ctx,
		args
	): Promise<{ refundId: string; status: string | null }> => {
		const payment: Doc<"payments"> | null = await ctx.runQuery(
			internal.stripeHelpers.getPaymentInternal,
			{
				paymentId: args.paymentId,
			}
		);
		if (!payment?.stripePaymentIntentId) {
			throw new Error("Payment does not have a Stripe payment intent");
		}

		await ctx.runMutation(internal.stripeHelpers.updatePayment, {
			paymentId: args.paymentId,
			refundStatus: PAYMENT_REFUND_STATUS.REQUESTED,
			refundRequestedAt: Date.now(),
		});
		await ctx.runMutation(internal.stripeHelpers.updateOrderPaymentSummary, {
			orderId: payment.orderId,
			paymentState: ORDER_PAYMENT_STATE.REFUND_REQUESTED,
		});

		const stripeClient = getStripeClient();
		try {
			const refund: Stripe.Refund = await stripeClient.refunds.create(
				{
					payment_intent: payment.stripePaymentIntentId,
					reverse_transfer: true,
					refund_application_fee: true,
				},
				{
					idempotencyKey: `refund:${args.paymentId}`,
				}
			);

			await ctx.runMutation(internal.stripeHelpers.updatePayment, {
				paymentId: args.paymentId,
				refundStatus:
					refund.status === "succeeded"
						? PAYMENT_REFUND_STATUS.SUCCEEDED
						: PAYMENT_REFUND_STATUS.REQUESTED,
				stripeRefundId: refund.id,
				...(refund.status === "succeeded" && { refundedAt: Date.now() }),
			});
			await ctx.runMutation(internal.stripeHelpers.updateOrderPaymentSummary, {
				orderId: payment.orderId,
				paymentState:
					refund.status === "succeeded"
						? ORDER_PAYMENT_STATE.REFUNDED
						: ORDER_PAYMENT_STATE.REFUND_REQUESTED,
			});

			return { refundId: refund.id, status: refund.status };
		} catch (error) {
			await ctx.runMutation(internal.stripeHelpers.updatePayment, {
				paymentId: args.paymentId,
				refundStatus: PAYMENT_REFUND_STATUS.FAILED,
				failureMessage: error instanceof Error ? error.message : "Refund failed",
			});
			await ctx.runMutation(internal.stripeHelpers.updateOrderPaymentSummary, {
				orderId: payment.orderId,
				paymentState: ORDER_PAYMENT_STATE.REFUND_FAILED,
			});
			throw error;
		}
	},
});

// =============================================================================
// 7. Payment Intent (In-App Checkout Flow)
// =============================================================================

/**
 * Creates a PaymentIntent for the in-app order checkout flow using
 * Stripe Elements. Customers pay within the app (not via hosted checkout).
 *
 * Uses destination charges with a 6% application fee.
 */
export const createPaymentIntent = action({
	args: {
		orderId: v.id(TABLE.ORDERS),
	},
	handler: async (
		ctx,
		args
	): Promise<{ clientSecret: string | null; paymentId: Id<"payments"> }> => {
		const order: Doc<"orders"> | null = await ctx.runQuery(
			internal.stripeHelpers.getOrderInternal,
			{ orderId: args.orderId }
		);
		if (!order) throw new Error("Order not found");
		if (order.status !== "draft") throw new Error("Order is not in draft status");
		if (order.totalAmount <= 0) throw new Error("Order total must be greater than zero");

		const restaurant: Doc<"restaurants"> | null = await ctx.runQuery(
			internal.stripeHelpers.getRestaurantInternal,
			{ restaurantId: order.restaurantId }
		);
		if (!restaurant?.stripeAccountId || !restaurant.stripeOnboardingComplete) {
			throw new Error("Restaurant is not set up for payments");
		}

		const applicationFeeAmount = Math.round(order.totalAmount * 0.06);
		const currency = restaurant.currency.toLowerCase();

		const stripeClient = getStripeClient();
		const latestPayment: Doc<"payments"> | null = order.activePaymentId
			? await ctx.runQuery(internal.stripeHelpers.getPaymentInternal, {
					paymentId: order.activePaymentId,
				})
			: await ctx.runQuery(internal.stripeHelpers.getLatestPaymentByOrderInternal, {
					orderId: args.orderId,
				});
		const canReuseExistingIntent =
			latestPayment?.status === PAYMENT_STATUS.PROCESSING &&
			latestPayment.orderUpdatedAtSnapshot === order.updatedAt &&
			latestPayment.amount === order.totalAmount &&
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
			amount: order.totalAmount,
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
					amount: order.totalAmount,
					currency,
					application_fee_amount: applicationFeeAmount,
					transfer_data: {
						destination: restaurant.stripeAccountId,
					},
					metadata: {
						orderId: args.orderId,
						restaurantId: order.restaurantId,
						paymentId,
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
