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
//   5. Creating platform-level Products with prices
//   6. Processing payments via Checkout Sessions with destination charges
//   7. Refunds for cancelled orders
//
// ---- Required Environment Variables (set in Convex Dashboard) ----
//
//   STRIPE_SECRET_KEY            - Your Stripe platform secret key (sk_test_... or sk_live_...).
//                                  Find it at https://dashboard.stripe.com/apikeys
//
//   STRIPE_WEBHOOK_SECRET        - Webhook signing secret for payment events
//                                  (checkout.session.completed, payment_intent.succeeded).
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
import { TABLE } from "./constants";

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
		// Step 1: Verify the caller is authenticated
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Not authenticated");

		// Step 2: Look up the restaurant to get its name and check for existing account
		const restaurant: Doc<"restaurants"> | null = await ctx.runQuery(
			internal.stripeHelpers.getRestaurantInternal,
			{ restaurantId: args.restaurantId }
		);
		if (!restaurant) throw new Error("Restaurant not found");

		// Step 3: If already connected, return the existing Stripe account ID
		if (restaurant.stripeAccountId) {
			return { stripeAccountId: restaurant.stripeAccountId };
		}

		// Step 4: Create a new V2 Connected Account
		const stripeClient = getStripeClient();
		const account = await stripeClient.v2.core.accounts.create({
			display_name: restaurant.name,
			contact_email: identity.email ?? "",
			identity: { country: "us" },
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

		// Step 5: Persist the Stripe account ID on the restaurant record
		await ctx.runMutation(internal.stripeHelpers.saveStripeAccountId, {
			restaurantId: args.restaurantId,
			stripeAccountId: account.id,
		});

		return { stripeAccountId: account.id };
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
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Not authenticated");

		const restaurant: Doc<"restaurants"> | null = await ctx.runQuery(
			internal.stripeHelpers.getRestaurantInternal,
			{ restaurantId: args.restaurantId }
		);
		if (!restaurant?.stripeAccountId) {
			throw new Error("Restaurant has no Stripe account. Create one first.");
		}

		const stripeClient = getStripeClient();

		// Create a V2 account link for the onboarding use case
		const accountLink = await stripeClient.v2.core.accountLinks.create({
			// The connected account to onboard
			account: restaurant.stripeAccountId,
			use_case: {
				type: "account_onboarding",
				account_onboarding: {
					// Must match the configurations used during account creation
					configurations: ["recipient", "merchant"],

					// If the onboarding link expires or the user needs to restart,
					// Stripe redirects here so you can generate a fresh link
					refresh_url: args.refreshUrl,

					// After the user completes (or exits) onboarding, Stripe
					// redirects here. We include the accountId so the frontend
					// can refresh the account status on return.
					return_url: `${args.returnUrl}?accountId=${restaurant.stripeAccountId}`,
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
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Not authenticated");

		const restaurant: Doc<"restaurants"> | null = await ctx.runQuery(
			internal.stripeHelpers.getRestaurantInternal,
			{ restaurantId: args.restaurantId }
		);
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

		// Step 1: Parse and verify the thin event using the webhook secret.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const thinEvent = (stripeClient as any).parseThinEvent(
			args.payloadString,
			args.signatureHeader,
			webhookSecret
		);

		// Step 2: Fetch the full event data from Stripe using the thin event's ID.
		const event = await stripeClient.v2.core.events.retrieve(thinEvent.id);

		// Step 3: Route to the appropriate handler based on event type.
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

// =============================================================================
// 5. Product Management (Platform-Level)
// =============================================================================

/**
 * Creates a Stripe Product with a default price at the platform level.
 *
 * Products are owned by the platform, not the connected account. We store
 * the mapping from product to connected account (restaurant) in our own DB
 * so we know which account should receive funds when a customer buys this product.
 *
 * The Stripe Product's metadata also includes the restaurantId for traceability.
 */
export const createProduct = action({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		name: v.string(),
		description: v.optional(v.string()),
		priceInCents: v.number(),
		currency: v.string(),
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Not authenticated");

		const restaurant: Doc<"restaurants"> | null = await ctx.runQuery(
			internal.stripeHelpers.getRestaurantInternal,
			{ restaurantId: args.restaurantId }
		);
		if (!restaurant) throw new Error("Restaurant not found");
		if (!restaurant.stripeAccountId || !restaurant.stripeOnboardingComplete) {
			throw new Error("Restaurant must complete Stripe onboarding before creating products.");
		}

		const stripeClient = getStripeClient();

		// Create the product on the platform account with an embedded default price.
		// `default_price_data` creates a one-time price automatically attached to
		// the product — no need for a separate price creation call.
		const product = await stripeClient.products.create({
			name: args.name,
			description: args.description ?? undefined,
			default_price_data: {
				unit_amount: args.priceInCents,
				currency: args.currency.toLowerCase(),
			},
			metadata: {
				restaurantId: args.restaurantId,
				stripeAccountId: restaurant.stripeAccountId,
			},
		});

		// Extract the default price ID — Stripe returns it as an expandable
		// field that may be a string or an object depending on expansion
		const priceId =
			typeof product.default_price === "string"
				? product.default_price
				: (product.default_price?.id ?? "");

		const productId: Id<"products"> = await ctx.runMutation(internal.stripeHelpers.saveProduct, {
			stripeProductId: product.id,
			stripePriceId: priceId,
			restaurantId: args.restaurantId,
			name: args.name,
			description: args.description,
			priceInCents: args.priceInCents,
			currency: args.currency.toLowerCase(),
		});

		return { productId, stripeProductId: product.id };
	},
});

// =============================================================================
// 6. Checkout Session with Destination Charges
// =============================================================================

/**
 * Creates a Stripe Checkout Session using the destination charge pattern.
 *
 * How destination charges work:
 * - The customer pays the platform (your Stripe account)
 * - Stripe automatically transfers funds to the connected account (restaurant)
 *   minus the `application_fee_amount`
 * - The platform keeps the application fee as revenue
 *
 * We use Stripe's hosted checkout page for simplicity — the customer is
 * redirected to Stripe's UI to enter payment details, then redirected back
 * to our success/cancel URLs.
 */
export const createCheckoutSession = action({
	args: {
		productId: v.id(TABLE.PRODUCTS),
		quantity: v.number(),
		successUrl: v.string(),
		cancelUrl: v.string(),
	},
	handler: async (ctx, args): Promise<{ url: string | null }> => {
		const product: Doc<"products"> | null = await ctx.runQuery(
			internal.stripeHelpers.getProductInternal,
			{ productId: args.productId }
		);
		if (!product) throw new Error("Product not found");
		if (!product.isActive) throw new Error("Product is not available");

		const restaurant: Doc<"restaurants"> | null = await ctx.runQuery(
			internal.stripeHelpers.getRestaurantInternal,
			{ restaurantId: product.restaurantId }
		);
		if (!restaurant?.stripeAccountId || !restaurant.stripeOnboardingComplete) {
			throw new Error("Restaurant is not set up to receive payments.");
		}

		const lineTotal = product.priceInCents * args.quantity;
		const applicationFeeAmount = Math.round(lineTotal * 0.06);

		const stripeClient = getStripeClient();
		const session = await stripeClient.checkout.sessions.create({
			line_items: [
				{
					price_data: {
						currency: product.currency,
						product_data: {
							name: product.name,
							...(product.description ? { description: product.description } : {}),
						},
						unit_amount: product.priceInCents,
					},
					quantity: args.quantity,
				},
			],
			payment_intent_data: {
				application_fee_amount: applicationFeeAmount,
				transfer_data: {
					destination: restaurant.stripeAccountId,
				},
			},
			mode: "payment",
			success_url: `${args.successUrl}?session_id={CHECKOUT_SESSION_ID}`,
			cancel_url: args.cancelUrl,
			metadata: {
				productId: product._id,
				restaurantId: product.restaurantId,
			},
		});

		return { url: session.url };
	},
});

// =============================================================================
// 7. Standard Webhook Handler (Payment Events)
// =============================================================================

/**
 * Handles standard Stripe webhook events for payment processing.
 *
 * Listens for:
 * - `checkout.session.completed` — a hosted checkout session was paid
 * - `payment_intent.succeeded` — a payment intent was confirmed (fallback)
 *
 * Both events confirm that money was collected. We log the event for
 * tracking and can extend this handler for additional business logic
 * (e.g. sending confirmation emails, updating inventory).
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

		// Verify the event signature to confirm it came from Stripe
		const event = stripeClient.webhooks.constructEvent(
			args.payloadString,
			args.signatureHeader,
			webhookSecret
		);

		switch (event.type) {
			case "checkout.session.completed": {
				// A Checkout Session was successfully paid.
				// The session metadata contains our internal references.
				const session = event.data.object;
				console.log(
					`Checkout session completed: ${session.id}, ` +
						`payment_status: ${session.payment_status}, ` +
						`metadata: ${JSON.stringify(session.metadata)}`
				);

				// If this checkout was for an order (from the existing order flow),
				// confirm the payment
				const orderId = session.metadata?.orderId;
				if (orderId) {
					await ctx.runMutation(internal.orders.confirmPayment, {
						orderId,
						stripePaymentIntentId:
							typeof session.payment_intent === "string"
								? session.payment_intent
								: (session.payment_intent?.id ?? session.id),
					});
				}
				break;
			}

			case "payment_intent.succeeded": {
				// Fallback handler for direct PaymentIntent confirmations
				// (used by the existing in-app checkout flow with Stripe Elements)
				const paymentIntent = event.data.object;
				const orderId = paymentIntent.metadata?.orderId;
				if (orderId) {
					await ctx.runMutation(internal.orders.confirmPayment, {
						orderId,
						stripePaymentIntentId: paymentIntent.id,
					});
				}
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
	},
});

// =============================================================================
// 8. Refund
// =============================================================================

/**
 * Creates a refund for a PaymentIntent. Called internally when a staff member
 * cancels a paid order.
 */
export const createRefund = internalAction({
	args: {
		stripePaymentIntentId: v.string(),
	},
	handler: async (_ctx, args) => {
		const stripeClient = getStripeClient();
		const refund = await stripeClient.refunds.create({
			payment_intent: args.stripePaymentIntentId,
		});
		return { refundId: refund.id, status: refund.status };
	},
});

// =============================================================================
// 9. Payment Intent (Existing In-App Checkout Flow)
// =============================================================================

/**
 * Creates a PaymentIntent for the existing in-app checkout flow using
 * Stripe Elements. This supports the current order-based checkout where
 * customers pay within the app (not via hosted checkout).
 *
 * Uses destination charges with a 6% application fee.
 */
export const createPaymentIntent = action({
	args: {
		orderId: v.id(TABLE.ORDERS),
	},
	handler: async (ctx, args) => {
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

		// 6% platform fee on the order total
		const applicationFeeAmount = Math.round(order.totalAmount * 0.06);

		const stripeClient = getStripeClient();
		const paymentIntent = await stripeClient.paymentIntents.create({
			amount: order.totalAmount,
			currency: restaurant.currency.toLowerCase(),
			application_fee_amount: applicationFeeAmount,
			transfer_data: {
				destination: restaurant.stripeAccountId,
			},
			metadata: {
				orderId: args.orderId,
				restaurantId: order.restaurantId,
			},
		});

		// Save the PaymentIntent ID on the order for later reference
		await ctx.runMutation(internal.stripeHelpers.savePaymentIntentId, {
			orderId: args.orderId,
			stripePaymentIntentId: paymentIntent.id,
		});

		return { clientSecret: paymentIntent.client_secret };
	},
});
