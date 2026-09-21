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
	PAYMENT_KIND,
	STRIPE_ACCOUNT_STATUS,
	USER_ROLES,
	type StripeAccountStatus,
} from "../constants";
import {
	ConflictError,
	fromErrorObject,
	NotAuthorizedError,
	NotFoundError,
} from "../_shared/errors";
import { buildIntegrationErrorLog, redactExternalId } from "../_shared/integrationLogging";
import {
	computeDisputeFacts,
	computeDisputeFee,
	computeRefundFacts,
	DISPUTE_PHASE,
	STRIPE_NOT_CONFIGURED,
	type DisputePhase,
	stripeSecondsToMs,
} from "../stripeWebhookHelpers";
import { getCurrentUserId } from "./auth";

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
		// Marked like the two signing secrets: this is the same class of failure
		// (the deployment is not configured), and the webhook HTTP routes must
		// answer 500 for it rather than a 400 that reads as "wrong secret".
		throw new Error(
			`${STRIPE_NOT_CONFIGURED}: STRIPE_SECRET_KEY is not set. ` +
				"Add it to your Convex deployment environment variables in the Convex Dashboard. " +
				"You can find your secret key at https://dashboard.stripe.com/apikeys"
		);
	}
	return new Stripe(key, {
		apiVersion: STRIPE_API_VERSION,
		// Convex actions already retry, but a network blip mid-charge is worth
		// absorbing here: Stripe's own retries reuse the idempotency key.
		maxNetworkRetries: 2,
		appInfo: { name: "Tavli" },
	});
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
 * "off_session"` attaches the card to, enabling one-tap tips and substitution
 * deltas later.
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
	accountStatus: StripeAccountStatus;
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
		// A retrieve can only ever answer "can this account take money or not":
		// `closed` is not derivable here, it is asserted by
		// `v2.core.account.closed` and then defended by the mutation layer.
		accountStatus: isComplete ? STRIPE_ACCOUNT_STATUS.ACTIVE : STRIPE_ACCOUNT_STATUS.RESTRICTED,
	};
}

/**
 * Shared helper for thin event handlers: re-fetches the V2 account,
 * determines the current onboarding/payment status, and updates the
 * restaurant record in our DB.
 *
 * The stored `stripeAccountStatus` moves with the boolean so the admin page and
 * the payment gates never disagree about the same account. A closed account is
 * left alone — see `isClosedAndStaysClosed` in `convex/stripeHelpers.ts`.
 */
export async function handleAccountStatusChange(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	ctx: any,
	stripeClient: Stripe,
	stripeAccountId: string
): Promise<void> {
	const { isComplete, accountStatus } = await inferV2AccountStatus(stripeClient, stripeAccountId);

	await ctx.runMutation(internal.stripeHelpers.updateOnboardingByAccountId, {
		stripeAccountId,
		stripeOnboardingComplete: isComplete,
		stripeAccountStatus: accountStatus,
	});
}

/**
 * Applies a `v2.core.account.closed` thin event (TAVLI-65).
 *
 * Thin events carry no object, only `related_object: {id, type, url}`, so the
 * versioned event is fetched from Stripe before anything is written — the
 * handler acts on Stripe's own record of the closure rather than on an
 * unverified id lifted out of the payload. The account id still comes from the
 * signed notification as a fallback, because a `v2.core.events.retrieve` that
 * omits `related_object` must not turn a real closure into a silent no-op.
 *
 * Deliberately NOT `handleAccountStatusChange`: that helper retrieves the
 * account, and a closed account has nothing useful left to report — the
 * closure is the event, not something to be re-derived.
 *
 * The operator alert is raised even when no restaurant claims the account id.
 * Dev and staging share one Stripe test account, so an unclaimed closure is
 * usually another environment's — but it can equally be a restaurant whose
 * `stripeAccountId` was cleared while Stripe was still delivering, and that is
 * exactly the case nobody would otherwise ever see. `dedupeKey` caps it at one
 * open row per account either way.
 */
export async function handleAccountClosed(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	ctx: any,
	stripeClient: Stripe,
	notification: { id: string; relatedObjectId: string | undefined }
): Promise<void> {
	// The retrieve is best-effort. Events are only readable through the v2 API
	// for a limited window, and a redelivery of an old closure (or a key that
	// cannot read events) would 404 here — which must not turn a real closure
	// into a silent no-op, because the notification Stripe SIGNED already told
	// us which account closed. So a failed retrieve falls back to it and says
	// so, and only a closure with no account id anywhere is dropped.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let event: any = null;
	try {
		event = await stripeClient.v2.core.events.retrieve(notification.id);
	} catch (error) {
		console.warn(
			"[stripe.handleAccountClosed] could not fetch the versioned event; " +
				"falling back to the signed notification's related object",
			buildIntegrationErrorLog(error, {
				integration: "stripe-connect-webhook",
				operation: "v2.core.events.retrieve",
				eventId: notification.id,
			})
		);
	}

	const stripeAccountId: string | undefined =
		event?.related_object?.id ?? notification.relatedObjectId;

	if (!stripeAccountId) {
		console.error(
			"[stripe.handleAccountClosed] account closed event carries no related object",
			JSON.stringify({ eventId: notification.id })
		);
		return;
	}

	const closed: { restaurantId: Id<"restaurants"> } | null = await ctx.runMutation(
		internal.stripeHelpers.markStripeAccountClosedByAccountId,
		{ stripeAccountId }
	);

	await ctx.runMutation(internal.operatorAlerts.raiseOperatorAlertInternal, {
		kind: OPERATOR_ALERT_KIND.ACCOUNT_CLOSED,
		severity: OPERATOR_ALERT_SEVERITY.SEVERE,
		...(closed && { restaurantId: closed.restaurantId }),
		stripeObjectId: stripeAccountId,
		dedupeKey: `account_closed:${stripeAccountId}`,
	});
}

/**
 * The one payment gate, shared by every path that builds a PaymentIntent
 * against a restaurant's connected account (TAVLI-65).
 *
 * Callers narrow `stripeAccountId` themselves (they need it as a `string` for
 * `transfer_data.destination`); this owns the *policy* — what makes an account
 * chargeable — so a new status or a new rule lands in one place instead of
 * three. The error is a stable code, not prose: `createPaymentIntent` surfaces
 * straight to the diner's checkout sheet, which maps
 * `ERROR_RESTAURANT_NOT_ACCEPTING_PAYMENTS` to "this restaurant is not
 * accepting payments right now" in the diner's own language. Before this, a
 * closed account produced an opaque Stripe failure several seconds later.
 *
 * **`stripeOnboardingComplete` owns "can this account be charged right now";
 * the status only adds `closed`.** A `restricted` status does not by itself
 * refuse, and that is deliberate twice over. The boolean is the field every
 * writer maintains — including the v1 `account.updated` handler, which writes
 * it with no status at all — so a restaurant can legitimately be
 * `{ complete: true, status: "restricted" }` while the status is merely stale.
 * And `restricted` is the same "not finished onboarding" the boolean already
 * says `false` for, so making it refuse independently would only ever fire on
 * the disagreement, which is the case where the boolean is the fresher fact.
 * `closed` is different in kind: it is asserted by an event, it is terminal,
 * and no writer of the boolean knows about it.
 *
 * A restaurant with no stored status therefore passes on the boolean alone —
 * which is every restaurant onboarded before TAVLI-65, until a thin event or a
 * status refresh writes one.
 */
export function assertRestaurantAcceptsPayments(restaurant: Doc<"restaurants">): void {
	if (
		!restaurant.stripeOnboardingComplete ||
		restaurant.stripeAccountStatus === STRIPE_ACCOUNT_STATUS.CLOSED
	) {
		throw fromErrorObject(new ConflictError("ERROR_RESTAURANT_NOT_ACCEPTING_PAYMENTS").toObject());
	}
}

/**
 * Confirms the matching payment record when Stripe reports a successful
 * PaymentIntent. Returns the payment id (or `undefined` if no matching
 * payment exists -- Stripe occasionally delivers events for payments we did
 * not create, e.g. tests run by another developer against shared keys).
 *
 * Dispatch order (ADR 008): the payment row's `kind` decides first —
 * `order` settles that order via `confirmPayment`; `substitution` applies the
 * swap via `confirmSubstitutionPayment`; `tip` records the post-visit tip via
 * `confirmTipPayment`. Rows without a `kind` are legacy: `sessionId` marks a
 * tab payment, otherwise a pre-pivot per-order payment, both on their
 * original paths.
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

	// Persist the saved card (`setup_future_usage: "off_session"`) so one-tap
	// tips and substitution deltas can charge it later (ADR 008). Done for
	// every success — legacy rows simply never read it.
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

	if (payment.kind === PAYMENT_KIND.SUBSTITUTION) {
		// Supplemental delta charge for an accepted substitution (Phase 3A):
		// applies the swap, raises the order total by the delta, and marks the
		// proposal accepted — idempotently.
		await ctx.runMutation(internal.substitutions.confirmSubstitutionPayment, {
			paymentId: payment._id,
			stripePaymentIntentId: paymentIntent.id,
			stripeChargeId: chargeId,
		});
		return payment._id;
	}

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
		// The dispute recovery ledger is drawn down HERE, after the charge has
		// settled, and never when the intent was priced (TAVLI-102). The
		// deduction was applied to `transfer_data.amount` at creation time, but
		// an intent that fails or is superseded moves no money — drawing the
		// ledger down then would forgive a debt nobody ever paid. A no-op for
		// every payment that carries no deduction, which is almost all of them.
		await ctx.runMutation(internal.disputes.applyDisputeRecoveryOnSettleInternal, {
			paymentId: payment._id,
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
 * PaymentIntent. Returns the payment id (or `undefined` when no matching
 * record exists, see `handlePaymentIntentSuccess`).
 *
 * Kind `order` rows (ADR 008) carry an `orderId` and no `sessionId`, so they
 * fall through to `failPayment` exactly like legacy per-order rows — the
 * routing needs no `kind` branch. Tip/substitution rows are dispatched by
 * `kind` before the `sessionId` check so a Phase 3 intent can never unlock a
 * tab.
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

	if (payment.kind === PAYMENT_KIND.SUBSTITUTION) {
		// A declined delta charge leaves the proposal pending — the diner can
		// retry from their device (a fresh intent supersedes the failed row).
		await ctx.runMutation(internal.substitutions.failSubstitutionPayment, {
			paymentId: payment._id,
			stripePaymentIntentId: paymentIntent.id,
			failureCode: paymentIntent.last_payment_error?.code ?? undefined,
			failureMessage: paymentIntent.last_payment_error?.message ?? undefined,
		});
		return payment._id;
	}

	if (payment.kind === PAYMENT_KIND.TIP) {
		// A declined tip charge is marked failed so the diner can retry from the
		// close-out screen (a fresh attempt supersedes the failed row).
		await ctx.runMutation(internal.payments.failTipPayment, {
			paymentId: payment._id,
			stripePaymentIntentId: paymentIntent.id,
			failureCode: paymentIntent.last_payment_error?.code ?? undefined,
			failureMessage: paymentIntent.last_payment_error?.message ?? undefined,
		});
		return payment._id;
	}

	if (payment.sessionId) {
		await ctx.runMutation(internal.sessions.failTabPayment, {
			paymentId: payment._id,
			stripePaymentIntentId: paymentIntent.id,
			failureCode: paymentIntent.last_payment_error?.code ?? undefined,
			failureMessage: paymentIntent.last_payment_error?.message ?? undefined,
		});
		return payment._id;
	}

	await ctx.runMutation(internal.orders.failPayment, {
		paymentId: payment._id,
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
	//
	// The lookup now runs on EVERY delivery, not only when the id is missing
	// (TAVLI-102). The fetched refund is the only place `transfer_reversal`
	// exists, and that field is what tells a refund Tavli issued from one an
	// operator issued by hand in the Stripe Dashboard. The charge-supplied id
	// still wins when there is one — the fetch is for the object, not the id.
	let { latestRefundId, refundedAtMs } = facts;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let fetchedRefund: any = null;
	try {
		const { data } = await getStripeClient().refunds.list({
			payment_intent: facts.paymentIntentId,
			limit: 1,
		});
		fetchedRefund = data[0] ?? null;
		if (fetchedRefund && !latestRefundId) {
			latestRefundId = fetchedRefund.id;
			refundedAtMs = stripeSecondsToMs(fetchedRefund.created);
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

	// Never let this fail silently: an unresolved refund id means the payment
	// row has no link back to Stripe, which is exactly the defect this lookup
	// exists to prevent.
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

	// A refund Tavli issued goes through `createRefund`, which always passes
	// `reverse_transfer: true`, so Stripe attaches a `transfer_reversal` and the
	// restaurant's share comes back off the connected account. A refund typed
	// into the Stripe Dashboard has no reversal unless the operator ticked the
	// box: the diner is repaid out of the PLATFORM balance while the restaurant
	// keeps its transfer, which is silently Tavli's loss — the same shape of
	// hole a lost dispute used to be (TAVLI-102).
	//
	// Deliberately NO ledger entry: unlike a chargeback, this is an action a
	// Tavli operator took, and the right response is for a human to look at what
	// they did, not for the next diner's order to quietly pay for it.
	//
	// Judged only on the FETCHED refund. The charge's own `refunds` list is
	// abbreviated and may omit the field, and inferring "no reversal" from an
	// absent key would alert on every properly-reversed refund.
	if (fetchedRefund && !fetchedRefund.transfer_reversal) {
		await ctx.runMutation(internal.operatorAlerts.raiseOperatorAlertInternal, {
			kind: OPERATOR_ALERT_KIND.DASHBOARD_REFUND,
			severity: OPERATOR_ALERT_SEVERITY.SEVERE,
			restaurantId: payment.restaurantId,
			paymentId: payment._id,
			...(payment.orderId && { orderId: payment.orderId }),
			stripeObjectId: fetchedRefund.id,
			dedupeKey: `dashboard_refund:${fetchedRefund.id}`,
		});
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
 * Resolve Stripe's dispute fee when the delivered object does not carry it.
 *
 * Stripe puts `balance_transactions` on the dispute, but not on every
 * delivery — a warning-stage dispute has none at all, and some payloads arrive
 * without the array. Since the fee is the number the platform's own accounting
 * turns on (Tavli absorbs it), it is worth one retrieve rather than leaving a
 * gap somebody has to reconcile by hand in the Dashboard.
 *
 * Best-effort: a failed retrieve logs and returns nothing, because the fee is
 * not what the dispute handler is fundamentally about and the next delivery
 * will try again.
 */
async function resolveDisputeFee(
	disputeId: string,
	eventId?: string
): Promise<{ feeAmount: number | undefined; feeAtMs: number | undefined }> {
	try {
		const dispute = await getStripeClient().disputes.retrieve(disputeId);
		if (!dispute) return { feeAmount: undefined, feeAtMs: undefined };
		return computeDisputeFee(dispute as unknown as Parameters<typeof computeDisputeFee>[0]);
	} catch (error) {
		console.warn(
			"[stripe.fulfillPayment] could not read the dispute's balance transactions",
			buildIntegrationErrorLog(error, {
				integration: "stripe-webhook",
				operation: "disputes.retrieve",
				eventId,
			})
		);
		return { feeAmount: undefined, feeAtMs: undefined };
	}
}

/**
 * Shared implementation for every `charge.dispute.*` event.
 *
 * Resolves the payment (best-effort, via the dispute's PaymentIntent), logs the
 * dispute loudly for dashboard visibility, resolves Stripe's dispute fee, then
 * hands the facts to `disputes.recordDisputeEventInternal`, which owns
 * everything that follows: the upsert, the recovery ledger, the aggregates, the
 * notifications and the operator alert.
 *
 * The phase is what the event says; the **status** is what decides the money.
 * Stripe's delivery order is not guaranteed and `updated` overlaps `closed`, so
 * a `charge.dispute.updated` carrying `lost` opens a ledger row exactly like a
 * `closed` would — keying off the event name alone is how a real loss gets
 * missed because it arrived under the "wrong" type.
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
	// logs. External ids are redacted per the integration-logging convention.
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

	// The fee only has to be learned once; the mutation ignores it when the
	// dispute row already carries one, so a retrieve is skipped whenever the
	// delivery itself told us.
	const fee =
		facts.feeAmount !== undefined
			? { feeAmount: facts.feeAmount, feeAtMs: facts.feeAtMs }
			: await resolveDisputeFee(facts.disputeId, eventId);

	await ctx.runMutation(internal.disputes.recordDisputeEventInternal, {
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
		...(fee.feeAmount !== undefined && { feeAmount: fee.feeAmount }),
		...(fee.feeAtMs !== undefined && { feeAtMs: fee.feeAtMs }),
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

/**
 * Handles `charge.dispute.updated`: the dispute moved without closing.
 *
 * Usually evidence being submitted or the bank moving it into review — nothing
 * that costs money. It is handled anyway because Stripe can deliver a status
 * change here that never arrives as a `closed`, and because a manager watching
 * the disputes card should see "under review" rather than a status frozen at
 * the moment the chargeback landed.
 */
export async function handleChargeDisputeUpdated(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	ctx: any,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	dispute: any,
	eventId?: string,
	eventCreatedMs?: number
): Promise<Id<"payments"> | undefined> {
	return handleChargeDispute(ctx, dispute, DISPUTE_PHASE.UPDATED, eventId, eventCreatedMs);
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

/**
 * Handles `charge.dispute.funds_reinstated`: we won and the money is back.
 *
 * Its own phase rather than a variant of `closed`, because the two mean
 * opposite things to the recovery ledger — `closed` may open a debt, this
 * always cancels one and returns whatever was already recovered. Stripe sends
 * it for a dispute that was lost and later reversed, which is exactly the case
 * where a ledger row is already being drawn down.
 */
export async function handleChargeDisputeFundsReinstated(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	ctx: any,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	dispute: any,
	eventId?: string,
	eventCreatedMs?: number
): Promise<Id<"payments"> | undefined> {
	return handleChargeDispute(ctx, dispute, DISPUTE_PHASE.FUNDS_REINSTATED, eventId, eventCreatedMs);
}
