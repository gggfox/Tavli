/**
 * Internal helpers extracted from `convex/stripe.ts`.
 *
 * These are plain TypeScript functions -- not Convex `action`/`internalAction`
 * declarations -- so the public `api.stripe.*` paths used by the frontend and
 * tests are unaffected. The companion file (`stripe.ts`) retains the public
 * API surface and imports the helpers below for shared logic.
 *
 * Mirrors the precedent in `convex/_util/auth.ts`, `convex/_util/availability.ts`,
 * and `convex/reservationHelpers.ts`.
 *
 * Marked `"use node"` because the Stripe SDK is a Node module and these
 * helpers either construct a Stripe client or accept one from a caller.
 */

"use node";

import Stripe from "stripe";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { USER_ROLES } from "../constants";
import { fromErrorObject, NotAuthorizedError, NotFoundError } from "../_shared/errors";
import { getCurrentUserId } from "./auth";

/**
 * Creates and returns a Stripe client instance configured with the platform's
 * secret key. The SDK automatically uses the latest API version (2026-03-25.dahlia)
 * so we do not need to set it explicitly.
 *
 * All Stripe API calls in `convex/stripe.ts` go through this client.
 */
export function getStripeClient(): Stripe {
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

/**
 * Asserts the current user can manage the given restaurant's Stripe connection.
 *
 * Resolution order:
 *   1. Caller must be authenticated (otherwise NotAuthenticatedError is thrown
 *      upstream by `getCurrentUserId`).
 *   2. Restaurant must exist.
 *   3. Caller must be a platform admin OR the restaurant's owner.
 *
 * Returns the restaurant document so callers can avoid a second fetch.
 */
export async function requireStripeRestaurantAccess(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

/**
 * Fetches a V2 connected account and infers its onboarding-status fields.
 *
 * The retrieve call and the field inspection are tightly coupled: the
 * `include` parameter dictates which V2 fields are present on the response,
 * and the inference reads exactly those fields. Centralising both keeps
 * `getAccountStatus` and the thin-event handler in lockstep so they cannot
 * drift (e.g. one starts checking a new capability while the other doesn't).
 *
 * Lives here (not in `stripeHelpers.ts`) because it both calls the Stripe
 * SDK and inspects V2 account fields -- `stripeHelpers.ts` is not `"use node"`.
 */
export async function inferV2AccountStatus(
	stripeClient: Stripe,
	stripeAccountId: string
): Promise<{
	readyToReceivePayments: boolean;
	requirementsStatus: string | null;
	onboardingComplete: boolean;
	isComplete: boolean;
}> {
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

	return {
		readyToReceivePayments,
		requirementsStatus,
		onboardingComplete,
		isComplete,
	};
}

/**
 * Shared helper for thin event handlers: re-fetches the V2 account,
 * determines the current onboarding/payment status, and updates the
 * restaurant record in our DB.
 */
export async function handleAccountStatusChange(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	ctx: any,
	stripeClient: Stripe,
	stripeAccountId: string
): Promise<void> {
	const { isComplete } = await inferV2AccountStatus(stripeClient, stripeAccountId);

	await ctx.runMutation(internal.stripeHelpers.updateOnboardingByAccountId, {
		stripeAccountId,
		stripeOnboardingComplete: isComplete,
	});
}

/**
 * Confirms the matching payment record when Stripe reports a successful
 * PaymentIntent. Returns the payment id (or `undefined` if no matching
 * payment exists -- Stripe occasionally delivers events for payments we did
 * not create, e.g. tests run by another developer against shared keys).
 */
export async function handlePaymentIntentSuccess(
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

/**
 * Marks the matching payment record as failed when Stripe reports a failed
 * PaymentIntent. Returns the payment id (or `undefined` when no matching
 * record exists, see `handlePaymentIntentSuccess`).
 */
export async function handlePaymentIntentFailure(
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
