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
import {
	OPERATOR_ALERT_KIND,
	OPERATOR_ALERT_SEVERITY,
	PAYMENT_FAILURE_CODE,
	PAYMENT_KIND,
	STRIPE_MAX_NETWORK_RETRIES,
	STRIPE_REQUEST_TIMEOUT_MS,
	USER_ROLES,
} from "../constants";
import { formatMoneyCents } from "../exportHelpers";
import { fromErrorObject, NotAuthorizedError, NotFoundError } from "../_shared/errors";
import { buildIntegrationErrorLog, redactExternalId } from "../_shared/integrationLogging";
import {
	computeDisputeFacts,
	computeRefundFacts,
	DISPUTE_PHASE,
	type DisputePhase,
	stripeSecondsToMs,
} from "../stripeWebhookHelpers";
import { getCurrentUserId } from "./auth";
import { getDeploymentMarker } from "./env";

/**
 * The Stripe API version this codebase is written against.
 *
 * Pinned deliberately. Left unset, the SDK falls back to whatever version it
 * ships with, so a `^22.0.0` minor bump would silently move the API version out
 * from under the version-sensitive V2 Accounts calls in `convex/stripe.ts`.
 * This value matches the default in `stripe@22.2.2`, so pinning it changed no
 * behaviour at the time it was introduced.
 *
 * To change it, use the `upgrade-stripe` skill -- it walks the breaking changes
 * between versions rather than just bumping the string.
 */
const STRIPE_API_VERSION = "2026-05-27.dahlia";

/**
 * Creates and returns a Stripe client instance configured with the platform's
 * secret key, pinned to `STRIPE_API_VERSION`.
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
	return new Stripe(key, {
		apiVersion: STRIPE_API_VERSION,
		// Convex actions already retry, but a network blip mid-charge is worth
		// absorbing here: Stripe's own retries reuse the idempotency key.
		//
		// Both numbers are constants rather than literals because
		// `PAYMENT_CREATE_IN_FLIGHT_WINDOW_MS` is derived from them (TAVLI-104):
		// the window has to outlive `(retries + 1) × timeout`, so a timeout left
		// to stripe-node's 80s default would silently make that window too short
		// and let a second tap supersede a create that is still running.
		maxNetworkRetries: STRIPE_MAX_NETWORK_RETRIES,
		timeout: STRIPE_REQUEST_TIMEOUT_MS,
		appInfo: { name: "Tavli" },
	});
}

/**
 * What happened when we tried to stand a PaymentIntent down at Stripe
 * (TAVLI-104). Four answers because the callers branch on all four: two are
 * "the way is clear", one means the diner has already paid, and one means we do
 * not know and must not proceed.
 */
export const INTENT_STAND_DOWN = {
	/** Cancelled by this call. */
	CANCELLED: "cancelled",
	/** Already `canceled` at Stripe — nothing to do, which is a success. */
	ALREADY_CANCELLED: "already_cancelled",
	/** The charge won the race. Nothing was cancelled; the webhook settles it. */
	SUCCEEDED: "succeeded",
	/** The retrieve or the cancel threw. We do not know if the intent is live. */
	UNREACHABLE: "unreachable",
} as const;

export type IntentStandDownOutcome = (typeof INTENT_STAND_DOWN)[keyof typeof INTENT_STAND_DOWN];

/**
 * Takes a PaymentIntent out of play at Stripe — retrieve first, then cancel
 * (TAVLI-104).
 *
 * The retrieve is not a formality. An intent whose client secret is loose in a
 * stale tab can be confirmed at any moment, so between our decision to abandon
 * it and the cancel call it may already have charged the card. Cancelling a
 * `succeeded` intent is an error at Stripe, and *treating* it as cancelled would
 * be worse: the money is real and only the webhook can place it. So a
 * `succeeded` read reports back and cancels nothing.
 *
 * This is the one copy of that race handling. `cancelOrderPaymentIntent` had it
 * inline first; the supersede paths (order, tab, tip) and the webhook's
 * accept-and-adopt branch all need exactly the same three-way read, and a second
 * copy is how one of them ends up cancelling a charge that already went through.
 *
 * Never throws. A Stripe failure comes back as `unreachable` with the error
 * attached, because "we could not reach Stripe" is a decision the caller has to
 * make (refuse the new intent, or rethrow) rather than an exception to leak.
 */
/**
 * Does this intent read `succeeded` at Stripe? Swallows its own failure — the
 * caller is already on an error path and a second one must not mask the first.
 */
async function readsAsSucceeded(
	stripeClient: Stripe,
	stripePaymentIntentId: string
): Promise<boolean> {
	try {
		const intent: Stripe.PaymentIntent =
			await stripeClient.paymentIntents.retrieve(stripePaymentIntentId);
		return intent.status === "succeeded";
	} catch {
		return false;
	}
}

export async function standDownPaymentIntent(
	stripeClient: Stripe,
	stripePaymentIntentId: string,
	operation: string
): Promise<{ outcome: IntentStandDownOutcome; error?: unknown }> {
	try {
		const intent: Stripe.PaymentIntent =
			await stripeClient.paymentIntents.retrieve(stripePaymentIntentId);
		if (intent.status === "succeeded") {
			return { outcome: INTENT_STAND_DOWN.SUCCEEDED };
		}
		if (intent.status === "canceled") {
			return { outcome: INTENT_STAND_DOWN.ALREADY_CANCELLED };
		}
		await stripeClient.paymentIntents.cancel(stripePaymentIntentId);
		return { outcome: INTENT_STAND_DOWN.CANCELLED };
	} catch (error) {
		// One re-read before giving up. The likeliest reason a cancel throws is
		// that the intent stopped being cancellable between the retrieve and the
		// cancel — the diner's stale tab confirmed it in that sliver, and Stripe
		// answers `payment_intent_unexpected_state`. Reporting `unreachable`
		// there sends the diner "try again", their retry finds an order that is
		// already paying, and they get a second, blunter error. Asking once more
		// turns that into the honest "already paid", which is a screen they can
		// act on.
		const succeeded = await readsAsSucceeded(stripeClient, stripePaymentIntentId);
		if (succeeded) {
			return { outcome: INTENT_STAND_DOWN.SUCCEEDED };
		}
		console.error(
			"[stripe.standDownPaymentIntent]",
			buildIntegrationErrorLog(error, {
				integration: "stripe",
				operation,
				eventId: stripePaymentIntentId,
			})
		);
		return { outcome: INTENT_STAND_DOWN.UNREACHABLE, error };
	}
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
 * Resolves the platform-level Stripe Customer for a Clerk user, creating it on
 * first charge (ADR 008). The Customer is what `setup_future_usage:
 * "off_session"` attaches the card to, enabling one-tap tips later.
 *
 * Race-safe twice over: the `customer:${userId}` idempotency key makes two
 * concurrent `customers.create` calls return the same Customer, and
 * `stripeCustomers.upsertInternal` lets the first stored row win — callers
 * must use the id this function returns, not one they created.
 */
export async function getOrCreateStripeCustomerId(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	ctx: any,
	stripeClient: Stripe,
	userId: string
): Promise<string> {
	const existing: Doc<"stripeCustomers"> | null = await ctx.runQuery(
		internal.stripeCustomers.getByUserInternal,
		{ userId }
	);
	if (existing) return existing.stripeCustomerId;

	const customer: Stripe.Customer = await stripeClient.customers.create(
		{
			metadata: { clerkUserId: userId },
		},
		{
			idempotencyKey: `customer:${userId}`,
		}
	);

	return await ctx.runMutation(internal.stripeCustomers.upsertInternal, {
		userId,
		stripeCustomerId: customer.id,
	});
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
 * PaymentIntent. The row is found by {@link resolvePaymentForIntent} — the
 * index on `stripePaymentIntentId` first, then `metadata.paymentId` — and
 * `undefined` comes back only when the intent is genuinely not ours (see that
 * function for which of those two answers gets an operator alert).
 *
 * Dispatch order (ADR 008): the payment row's `kind` decides first —
 * `order` settles that order via `confirmPayment`; `tip` records the
 * post-visit tip via `confirmTipPayment`. Rows without a `kind` are legacy: `sessionId` marks a
 * tab payment, otherwise a pre-pivot per-order payment, both on their
 * original paths.
 */
/**
 * Routes a payment to its kind's failure mutation — the single place that
 * decides which one that is.
 *
 * Two callers with the same routing question: `handlePaymentIntentFailure` (a
 * declined card) and the amount-mismatch branch of `handlePaymentIntentSuccess`
 * (a charge that succeeded for the wrong amount). They differ only in the
 * `failureCode` they hand over.
 *
 * Dispatch order matters: `kind: "tip"` is checked before `sessionId`, because
 * a tip row carries a `sessionId` too and must never be allowed to unlock a
 * tab. Kind `order` rows carry an `orderId` and no `sessionId`, so they fall
 * through to the order path exactly like legacy per-order rows.
 *
 * Every target mutation early-returns on an already-SUCCEEDED row, so this is
 * safe to call on a replay.
 */
async function failPaymentByKind(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	ctx: any,
	payment: Doc<"payments">,
	args: {
		stripePaymentIntentId: string;
		failureCode?: string;
		failureMessage?: string;
	}
): Promise<void> {
	const mutationArgs = { paymentId: payment._id, ...args };

	if (payment.kind === PAYMENT_KIND.TIP) {
		// A failed tip charge is marked failed so the diner can retry from the
		// close-out screen (a fresh attempt supersedes the failed row).
		await ctx.runMutation(internal.payments.failTipPayment, mutationArgs);
		return;
	}

	if (payment.sessionId) {
		// Unlocks the tab as well as failing the row.
		await ctx.runMutation(internal.sessions.failTabPayment, mutationArgs);
		return;
	}

	await ctx.runMutation(internal.orders.failPayment, mutationArgs);
}

/**
 * Finds the payment row a `payment_intent.*` event belongs to, by two routes
 * (TAVLI-105).
 *
 * The index on `stripePaymentIntentId` is the normal one. It is not enough on
 * its own, because of the order the off-session tip charge is forced into:
 * `createTipCharge` must write the payment row BEFORE calling Stripe (the
 * intent's metadata carries the row id), and with `off_session: true, confirm:
 * true` the money moves inside that same create call. So the row exists, the
 * charge has happened, and the row does not yet know the intent id — and if
 * `payment_intent.succeeded` arrives in that window, an index lookup finds
 * nothing. Returning `undefined` there was permanent, not transient:
 * `fulfillPayment` records the event as processed regardless, so every Stripe
 * redelivery was then dropped by the dedup. Diner charged, tip never recorded,
 * member never credited.
 *
 * Hence the fallback: `metadata.paymentId`, which every intent Tavli creates
 * carries (order, tab and tip). A fallback match patches the intent id onto the
 * row — the write the race lost — and the handler then proceeds exactly as it
 * would have, amount assertion included.
 *
 * Returns `null` when the event cannot be placed, and the reason decides whether
 * a human is told. A severe `charge_unmatched` alert emails every platform
 * admin, so it has to mean something; the bar is "money THIS deployment took and
 * cannot account for".
 *
 * - **No `paymentId` in the metadata.** Not ours at all: a charge made by hand
 *   in the Stripe Dashboard, a Billing intent, a test from some other tool. Info
 *   log, no alert.
 * - **A `deployment` marker naming some OTHER deployment.** Also not ours, and
 *   this is the common case, not an edge one: the two dev deployments and staging
 *   all charge the same Stripe test account, and every one of them stamps
 *   `metadata.paymentId`. Without the marker each of their tip charges would
 *   raise a severe alert and mail every platform admin — the fastest way to
 *   teach people that `/admin/alerts` is noise. Info log, no alert, and the row
 *   is not even looked up: a `paymentId` minted in another deployment's database
 *   has no business resolving in ours.
 * - **No marker at all, and the row is missing.** Intents created before this
 *   shipped carry no marker, so the fallback still RUNS for them (an in-flight
 *   tip charge mid-deploy is exactly the case this ticket exists for) — but a
 *   miss cannot be attributed, so it is logged rather than alerted.
 * - **Our marker, and the row is gone or names a different intent.** Money this
 *   deployment took with no record of it. Severe `charge_unmatched`, one open
 *   alert per intent.
 */
async function resolvePaymentForIntent(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	ctx: any,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	paymentIntent: any,
	operation: "handlePaymentIntentSuccess" | "handlePaymentIntentFailure"
): Promise<Doc<"payments"> | null> {
	const paymentIntentId: string | undefined =
		typeof paymentIntent?.id === "string" && paymentIntent.id.length > 0
			? paymentIntent.id
			: undefined;

	if (paymentIntentId) {
		const byIntentId: Doc<"payments"> | null = await ctx.runQuery(
			internal.stripeHelpers.getPaymentByPaymentIntentIdInternal,
			{ stripePaymentIntentId: paymentIntentId }
		);
		if (byIntentId) return byIntentId;
	}

	const metadataPaymentId: string | undefined =
		typeof paymentIntent?.metadata?.paymentId === "string" &&
		paymentIntent.metadata.paymentId.length > 0
			? paymentIntent.metadata.paymentId
			: undefined;

	const intentMarker: string | undefined =
		typeof paymentIntent?.metadata?.deployment === "string" &&
		paymentIntent.metadata.deployment.length > 0
			? paymentIntent.metadata.deployment
			: undefined;
	const ourMarker = getDeploymentMarker();
	if (!ourMarker) {
		// Neither `CONVEX_CLOUD_URL` nor `CONVEX_SITE_URL` resolved, which should not
		// happen inside a deployment. Degraded, and worth saying out loud: with no
		// marker of our own there is nothing to compare an intent's marker against,
		// so no unplaceable charge can be attributed to us and NO `charge_unmatched`
		// alert will be raised. The fallback still matches rows; only the alerting
		// is blind. Once per event, not per problem — this is a configuration
		// condition, not a payment one, so it stays a log rather than an alert.
		console.warn("[stripe.fulfillPayment] DEPLOYMENT MARKER UNAVAILABLE", {
			operation,
			consequence: "unmatched charges will be logged, not alerted",
		});
	}

	// Not ours, and cheaply provable: nothing to alert about. `paymentIntentId`
	// missing lands here too — an event with no object id is malformed, and
	// there is no key to dedupe an alert on anyway.
	//
	// A marker naming another deployment is the same verdict reached sooner: its
	// `paymentId` was minted in another database, so resolving it here would at
	// best miss and at worst hit an unrelated row.
	const foreignDeployment = Boolean(intentMarker && ourMarker && intentMarker !== ourMarker);
	if (!paymentIntentId || !metadataPaymentId || foreignDeployment) {
		console.info("[stripe.fulfillPayment] FOREIGN PAYMENT INTENT IGNORED", {
			operation,
			paymentIntentId: redactExternalId(paymentIntentId),
			reason: !paymentIntentId
				? "no_payment_intent_id"
				: !metadataPaymentId
					? "no_metadata_payment_id"
					: "another_deployment",
			...(foreignDeployment && { intentDeployment: intentMarker, ourDeployment: ourMarker }),
		});
		return null;
	}

	// Can a miss below be blamed on us? Only when the intent says it is ours.
	// An unmarked intent predates the marker (created by the code this replaced),
	// so it still gets the fallback — but not the alert, because a miss on it is
	// indistinguishable from a stranger's charge.
	const attributableToUs = Boolean(ourMarker) && intentMarker === ourMarker;

	const {
		payment,
		restaurantId,
	}: { payment: Doc<"payments"> | null; restaurantId: Id<"restaurants"> | null } =
		await ctx.runQuery(internal.stripeHelpers.resolveStripeMetadataRefsInternal, {
			paymentId: metadataPaymentId,
			restaurantId:
				typeof paymentIntent?.metadata?.restaurantId === "string"
					? paymentIntent.metadata.restaurantId
					: undefined,
		});

	// The row this intent names is gone (or the id never resolved). Money moved
	// against a record we cannot produce.
	if (!payment) {
		if (!attributableToUs) {
			console.info("[stripe.fulfillPayment] FOREIGN PAYMENT INTENT IGNORED", {
				operation,
				paymentIntentId: redactExternalId(paymentIntentId),
				reason: "unmarked_intent_no_matching_row",
			});
			return null;
		}
		await raiseChargeUnmatched(ctx, {
			operation,
			paymentIntentId,
			restaurantId,
			reason: "metadata_payment_row_missing",
		});
		return null;
	}

	// Already claimed by a different intent. Settling here would credit this
	// charge against a row that was paid by another one — a second charge
	// recorded as the first. The row is left exactly as it is and a human is
	// told which intent could not be placed.
	if (payment.stripePaymentIntentId && payment.stripePaymentIntentId !== paymentIntentId) {
		// Alerted regardless of the marker: the row is unambiguously ours, so the
		// charge that cannot be placed on it is a real accounting hole either way.
		await raiseChargeUnmatched(ctx, {
			operation,
			paymentIntentId,
			restaurantId: restaurantId ?? payment.restaurantId,
			paymentId: payment._id,
			reason: "payment_row_holds_a_different_intent",
		});
		return null;
	}

	if (payment.stripePaymentIntentId !== paymentIntentId) {
		// The patch the race lost. Done before any settlement so that a replay
		// (or a second delivery racing this one) takes the index route above and
		// meets the handlers' own already-terminal guards.
		await ctx.runMutation(internal.stripeHelpers.updatePayment, {
			paymentId: payment._id,
			stripePaymentIntentId: paymentIntentId,
		});
		return { ...payment, stripePaymentIntentId: paymentIntentId };
	}

	return payment;
}

/**
 * One severe alert per unplaceable PaymentIntent.
 *
 * `dedupeKey` is the intent, not the delivery: Stripe redelivers for days, and
 * a success and a failure for the same intent are the same problem. The reason
 * goes in the log rather than the alert copy — `charge_unmatched`'s explanation
 * is the same instruction either way ("find the charge in Stripe and decide
 * whose it is"), and the operator needs the intent id, which the alert carries
 * in `stripeObjectId`.
 */
async function raiseChargeUnmatched(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	ctx: any,
	args: {
		operation: string;
		paymentIntentId: string;
		restaurantId: Id<"restaurants"> | null;
		paymentId?: Id<"payments">;
		reason: string;
	}
): Promise<void> {
	console.error("[stripe.fulfillPayment] CHARGE UNMATCHED", {
		...buildIntegrationErrorLog(new Error("PaymentIntent could not be matched to a payment row"), {
			integration: "stripe-webhook",
			operation: args.operation,
			...(args.restaurantId ? { restaurantId: args.restaurantId } : {}),
		}),
		reason: args.reason,
		paymentIntentId: redactExternalId(args.paymentIntentId),
		...(args.paymentId ? { paymentId: args.paymentId } : {}),
	});

	await ctx.runMutation(internal.operatorAlerts.raiseOperatorAlertInternal, {
		kind: OPERATOR_ALERT_KIND.CHARGE_UNMATCHED,
		severity: OPERATOR_ALERT_SEVERITY.SEVERE,
		...(args.restaurantId ? { restaurantId: args.restaurantId } : {}),
		...(args.paymentId ? { paymentId: args.paymentId } : {}),
		stripeObjectId: args.paymentIntentId,
		dedupeKey: `charge_unmatched:${args.paymentIntentId}`,
	});
}

export async function handlePaymentIntentSuccess(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	ctx: any,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	paymentIntent: any
): Promise<Id<"payments"> | undefined> {
	const payment = await resolvePaymentForIntent(ctx, paymentIntent, "handlePaymentIntentSuccess");
	if (!payment) return undefined;

	// ---------------------------------------------------------------------
	// AMOUNT ASSERTION (TAVLI-69). Does Stripe agree with us about how much
	// was collected? Asked here, before any dispatch or side effect, so all
	// three kinds get it: `payments.amount` is the gross the intent was
	// created with on every path (order = subtotal + fee, tip = the tip,
	// legacy tab = the tab total), so one field answers it for all of them.
	//
	// Not the same question `orders.confirmPayment` asks. That one compares
	// the ORDER's total against the payment row and catches an order edited
	// after the intent was created; it says nothing about what Stripe
	// actually took, and the tab and tip paths compare nothing at all. Both
	// checks stay: this one runs first and covers every kind.
	// ---------------------------------------------------------------------
	const receivedAmount =
		typeof paymentIntent.amount_received === "number"
			? paymentIntent.amount_received
			: typeof paymentIntent.amount === "number"
				? // Stripe always sends `amount_received` on a success. If a
					// delivery somehow lacks it, `amount` is the documented
					// equivalent for a succeeded intent — better than refusing to
					// settle good money over a missing field.
					paymentIntent.amount
				: undefined;

	if (receivedAmount !== undefined && receivedAmount !== payment.amount) {
		// Loud first: the alert is for the operator, the log is for whoever is
		// reading Convex logs when this fires. Ids redacted per convention.
		console.error("[stripe.fulfillPayment] PAYMENT AMOUNT MISMATCH", {
			...buildIntegrationErrorLog(
				new Error("PaymentIntent amount does not match the payment row"),
				{
					integration: "stripe-webhook",
					operation: "handlePaymentIntentSuccess",
					restaurantId: payment.restaurantId,
				}
			),
			paymentId: payment._id,
			paymentKind: payment.kind ?? "legacy",
			expectedAmount: payment.amount,
			receivedAmount,
			currency: payment.currency,
			paymentIntentId: redactExternalId(
				typeof paymentIntent.id === "string" ? paymentIntent.id : undefined
			),
		});

		await ctx.runMutation(internal.operatorAlerts.raiseOperatorAlertInternal, {
			kind: OPERATOR_ALERT_KIND.PAYMENT_AMOUNT_MISMATCH,
			severity: OPERATOR_ALERT_SEVERITY.SEVERE,
			restaurantId: payment.restaurantId,
			orderId: payment.orderId,
			paymentId: payment._id,
			stripeObjectId: typeof paymentIntent.id === "string" ? paymentIntent.id : undefined,
			// Pre-formatted, because neither renderer formats money: the alerts
			// page substitutes through i18next and the email through
			// `interpolate`, so a raw `5600` would reach the operator as "5600".
			messageParams: {
				expected: formatMoneyCents(payment.amount),
				received: formatMoneyCents(receivedAmount),
				currency: payment.currency.toUpperCase(),
			},
			// One open alert per payment, not per DETECTION. Stripe's own
			// retries are not the reason — a redelivery carries the same `evt_`
			// id, so `stripeWebhookEvents` already collapses those (which is
			// exactly what the comment below relies on). The reason is that
			// this handler has a second caller: `reconcileStuckTabPayments`
			// re-runs it every five minutes for a tab that is still locked, and
			// a mismatched tab stays locked until a human acts. Without the key
			// that is one severe alert and one admin email per sweep.
			dedupeKey: `amount_mismatch:${payment._id}`,
		});

		// Give the row an exit. Leaving it PROCESSING forever would strand the
		// diner (a locked tab never unlocks, an order never returns to unpaid)
		// and leave the next attempt with a live row to trip over. FAILED is the
		// honest terminal state: the charge did not pay for what it claimed to.
		// It lets `createOrderPaymentIntent` / `beginTabPayment` supersede this
		// attempt cleanly, and it gives the operator's eventual refund a
		// terminal row to land on. The money itself stays at Stripe until they
		// refund it — that is the alert's job, not this mutation's, which is why
		// the alert above is raised and kept regardless.
		await failPaymentByKind(ctx, payment, {
			stripePaymentIntentId: paymentIntent.id,
			failureCode: PAYMENT_FAILURE_CODE.AMOUNT_MISMATCH,
			failureMessage: `Stripe collected ${receivedAmount} but this payment expected ${payment.amount}`,
		});

		// Return rather than throw, deliberately. Throwing would make
		// `fulfillPayment` skip `recordStripeWebhookEvent` and hand Stripe a
		// 500, so it would redeliver this event for days and re-raise on every
		// attempt — and the answer would never change, because the disagreement
		// is with the amount, not with a transient failure. Returning lets the
		// dedup row be written, which stops the retries, while settlement stays
		// undone until a human resolves the alert.
		return payment._id;
	}

	const chargeId =
		typeof paymentIntent.latest_charge === "string"
			? paymentIntent.latest_charge
			: (paymentIntent.latest_charge?.id ?? undefined);

	// Persist the saved card (`setup_future_usage: "off_session"`) so one-tap
	// tips can charge it later (ADR 008). Done for every success — legacy rows
	// simply never read it.
	const paymentMethodId =
		typeof paymentIntent.payment_method === "string"
			? paymentIntent.payment_method
			: (paymentIntent.payment_method?.id ?? undefined);
	if (paymentMethodId && payment.stripePaymentMethodId !== paymentMethodId) {
		await ctx.runMutation(internal.stripeHelpers.updatePayment, {
			paymentId: payment._id,
			stripePaymentMethodId: paymentMethodId,
		});
	}

	const gratuityRaw = paymentIntent.metadata?.gratuityAmount;
	const gratuityAmount =
		typeof gratuityRaw === "string"
			? Number.parseInt(gratuityRaw, 10)
			: typeof gratuityRaw === "number"
				? gratuityRaw
				: 0;

	if (payment.kind === PAYMENT_KIND.TIP) {
		// Post-visit tip (Phase 3B): marks the payment succeeded and records the
		// sessions.tipPaid audit event — idempotently. Never closes the session
		// and never touches the legacy session.tipAmount field.
		await ctx.runMutation(internal.payments.confirmTipPayment, {
			paymentId: payment._id,
			stripePaymentIntentId: paymentIntent.id,
			stripeChargeId: chargeId,
		});
		return payment._id;
	}

	if (payment.kind === PAYMENT_KIND.ORDER) {
		await ctx.runMutation(internal.orders.confirmPayment, {
			paymentId: payment._id,
			stripePaymentIntentId: paymentIntent.id,
			stripeChargeId: chargeId,
			gratuityAmount: Number.isFinite(gratuityAmount) ? gratuityAmount : 0,
		});
		return payment._id;
	}

	// Legacy rows (no `kind`): tab (session-level) payments settle the whole
	// session; per-order payments keep the original order confirmation path.
	if (payment.sessionId) {
		await ctx.runMutation(internal.sessions.confirmTabPayment, {
			paymentId: payment._id,
			stripePaymentIntentId: paymentIntent.id,
			stripeChargeId: chargeId,
			gratuityAmount: Number.isFinite(gratuityAmount) ? gratuityAmount : 0,
		});
		return payment._id;
	}

	await ctx.runMutation(internal.orders.confirmPayment, {
		paymentId: payment._id,
		stripePaymentIntentId: paymentIntent.id,
		stripeChargeId: chargeId,
		gratuityAmount: Number.isFinite(gratuityAmount) ? gratuityAmount : 0,
	});
	return payment._id;
}

/**
 * Marks the matching payment record as failed when Stripe reports a failed
 * PaymentIntent. Finds the row through {@link resolvePaymentForIntent}, the same
 * two routes as the success half: a declined off-session tip charge loses the
 * race to its own webhook exactly as a successful one does, and a tip row left
 * `pending` forever would block the diner from retrying.
 *
 * Routing lives in `failPaymentByKind`, shared with the amount-mismatch branch
 * of `handlePaymentIntentSuccess` — the two differ only in the `failureCode`.
 */
export async function handlePaymentIntentFailure(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	ctx: any,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	paymentIntent: any
): Promise<Id<"payments"> | undefined> {
	const payment = await resolvePaymentForIntent(ctx, paymentIntent, "handlePaymentIntentFailure");
	if (!payment) return undefined;

	await failPaymentByKind(ctx, payment, {
		stripePaymentIntentId: paymentIntent.id,
		failureCode: paymentIntent.last_payment_error?.code ?? undefined,
		failureMessage: paymentIntent.last_payment_error?.message ?? undefined,
	});
	return payment._id;
}

/**
 * Handles a `charge.refunded` event. Resolves the in-app payment from the
 * charge's PaymentIntent, then persists the refund facts (amount refunded,
 * full vs partial, latest refund id + timestamp). Returns the payment id (or
 * `undefined` when the charge is not one we created — e.g. events from shared
 * test keys). Also surfaces refunds issued manually from the Stripe dashboard.
 *
 * Idempotent: duplicate deliveries are short-circuited upstream by the
 * `stripeWebhookEvents` dedup in `fulfillPayment`, and re-applying the same
 * facts is itself a no-op.
 */
export async function handleChargeRefunded(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	ctx: any,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	charge: any,
	eventId?: string
): Promise<Id<"payments"> | undefined> {
	const facts = computeRefundFacts(charge);
	if (!facts.paymentIntentId) return undefined;

	const payment: Doc<"payments"> | null = await ctx.runQuery(
		internal.stripeHelpers.getPaymentByPaymentIntentIdInternal,
		{ stripePaymentIntentId: facts.paymentIntentId }
	);
	if (!payment) return undefined;

	// Stripe does NOT include `refunds` on the charge delivered with
	// `charge.refunded` -- verified against a real test-mode delivery
	// (evt_3TPVpgAdCrGPY0BG07oCiPg0, 2026-07-19), whose `data.object` has no
	// `refunds` key at all. Stripe's own dashboard copy says as much: "Listen to
	// refund.created for information about the refund." `computeRefundFacts`
	// therefore yields an undefined refund id/timestamp in production even
	// though the unit-test fixtures supply them. Look the refund up explicitly
	// so `payments.stripeRefundId` -- our only link back to the Stripe refund --
	// is not silently dropped.
	//
	// Filter by PaymentIntent rather than charge: we early-return above unless
	// `paymentIntentId` is set, so it is always available here, and it is the
	// filter Stripe treats as canonical for destination charges.
	let { latestRefundId, refundedAtMs } = facts;
	if (!latestRefundId) {
		try {
			const { data } = await getStripeClient().refunds.list({
				payment_intent: facts.paymentIntentId,
				limit: 1,
			});
			const latest = data[0];
			if (latest) {
				latestRefundId = latest.id;
				refundedAtMs = stripeSecondsToMs(latest.created);
			}
		} catch (error) {
			console.error("[stripe.fulfillPayment] REFUND LOOKUP FAILED", {
				integration: "stripe-webhook",
				operation: "refunds.list",
				eventId,
				chargeId: redactExternalId(typeof charge.id === "string" ? charge.id : undefined),
				paymentIntentId: redactExternalId(facts.paymentIntentId),
				message: error instanceof Error ? error.message : String(error),
			});
		}

		// Never let this fail silently again: an unresolved refund id means the
		// payment row has no link back to Stripe, which is exactly the defect
		// this branch exists to prevent.
		if (!latestRefundId) {
			console.error("[stripe.fulfillPayment] REFUND ID UNRESOLVED", {
				integration: "stripe-webhook",
				operation: "handleChargeRefunded",
				eventId,
				chargeId: redactExternalId(typeof charge.id === "string" ? charge.id : undefined),
				paymentIntentId: redactExternalId(facts.paymentIntentId),
				chargeHadRefundsKey: charge.refunds !== undefined,
				refundsListReturned: 0,
			});
		}
	}

	await ctx.runMutation(internal.stripeHelpers.recordChargeRefund, {
		paymentId: payment._id,
		amountRefunded: facts.amountRefunded,
		amountCaptured: facts.amountCaptured,
		isFullyRefunded: facts.isFullyRefunded,
		stripeRefundId: latestRefundId,
		refundedAtMs,
		latestStripeEventId: eventId,
	});

	return payment._id;
}

/**
 * Shared implementation for `charge.dispute.created` / `charge.dispute.closed`.
 * Resolves the payment (best-effort, via the dispute's PaymentIntent), logs the
 * dispute loudly for dashboard visibility (structured error tracking lands in
 * TAVLI-9), then upserts the dispute facts. Returns the payment id when known.
 */
async function handleChargeDispute(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	ctx: any,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	dispute: any,
	phase: DisputePhase,
	eventId?: string,
	eventCreatedMs?: number
): Promise<Id<"payments"> | undefined> {
	const facts = computeDisputeFacts(dispute);

	let payment: Doc<"payments"> | null = null;
	if (facts.paymentIntentId) {
		payment = await ctx.runQuery(internal.stripeHelpers.getPaymentByPaymentIntentIdInternal, {
			stripePaymentIntentId: facts.paymentIntentId,
		});
	}

	// Loud, structured log so a chargeback is impossible to miss in the Convex
	// logs until dedicated error tracking exists (TAVLI-9). External ids are
	// redacted per the integration-logging convention.
	console.error("[stripe.fulfillPayment] CHARGE DISPUTE", {
		phase,
		disputeId: redactExternalId(facts.disputeId),
		reason: facts.reason,
		status: facts.status,
		amount: facts.amount,
		currency: facts.currency,
		isLost: facts.isLost,
		chargeId: redactExternalId(facts.chargeId),
		paymentId: payment?._id,
		restaurantId: payment?.restaurantId,
	});

	await ctx.runMutation(internal.stripeHelpers.recordChargeDispute, {
		stripeDisputeId: facts.disputeId,
		phase,
		reason: facts.reason,
		status: facts.status,
		amount: facts.amount,
		currency: facts.currency,
		eventTimeMs: eventCreatedMs ?? facts.createdAtMs ?? Date.now(),
		restaurantId: payment?.restaurantId,
		paymentId: payment?._id,
		orderId: payment?.orderId,
		sessionId: payment?.sessionId,
		stripeChargeId: facts.chargeId,
		stripePaymentIntentId: facts.paymentIntentId,
		latestStripeEventId: eventId,
	});

	return payment?._id;
}

/** Handles `charge.dispute.created`: a chargeback was opened. */
export async function handleChargeDisputeCreated(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	ctx: any,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	dispute: any,
	eventId?: string,
	eventCreatedMs?: number
): Promise<Id<"payments"> | undefined> {
	return handleChargeDispute(ctx, dispute, DISPUTE_PHASE.CREATED, eventId, eventCreatedMs);
}

/** Handles `charge.dispute.closed`: a chargeback was resolved (won or lost). */
export async function handleChargeDisputeClosed(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	ctx: any,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	dispute: any,
	eventId?: string,
	eventCreatedMs?: number
): Promise<Id<"payments"> | undefined> {
	return handleChargeDispute(ctx, dispute, DISPUTE_PHASE.CLOSED, eventId, eventCreatedMs);
}
