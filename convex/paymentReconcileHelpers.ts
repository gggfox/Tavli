/**
 * Reconciling a stuck order or tip payment against Stripe (TAVLI-106) — the
 * pure half.
 *
 * Tab settlement has had a backstop since TAVLI-45: `reconcileStuckTabPayments`
 * walks tabs locked past ten minutes, pulls the PaymentIntent from Stripe and
 * settles, unlocks or escalates. Orders and tips had nothing. A dropped
 * `payment_intent.succeeded` left a diner who really paid with a round the
 * kitchen was never released to cook, or a tip charged to a card and never
 * credited to the member who earned it — in both cases permanently, because
 * every other path in the system is waiting for that same webhook.
 *
 * Everything here is pure: no Convex imports beyond the enums, no Stripe
 * client, no clock. `stripe.reconcileStuckPayments` does the I/O and asks these
 * three functions what it means. The same split `sessionHelpers`'
 * {@link decideTabReconciliation} uses, and for the same reason — the decision
 * table is where the subtle cases live, and it should be testable without a
 * database.
 */
import {
	ORDER_PAYMENT_RECONCILE_ALERT_AGE_MS,
	ORDER_PAYMENT_RECONCILE_MIN_AGE_MS,
	OPERATOR_ALERT_SEVERITY,
	PAYMENT_KIND,
	TIP_PAYMENT_RECONCILE_ALERT_AGE_MS,
	TIP_PAYMENT_RECONCILE_MIN_AGE_MS,
	type OperatorAlertSeverity,
} from "./constants";

/**
 * What this sweep treats a candidate row as. Deliberately narrower than
 * `PAYMENT_KIND`: a legacy row carries no `kind` at all and still has to be
 * swept as something.
 */
export const STUCK_PAYMENT_SWEEP_KIND = {
	ORDER: "order",
	TIP: "tip",
} as const;

export type StuckPaymentSweepKind =
	(typeof STUCK_PAYMENT_SWEEP_KIND)[keyof typeof STUCK_PAYMENT_SWEEP_KIND];

export type PaymentReconcileDecision =
	/** Stripe has the money. Hand the intent to the webhook's own success handler. */
	| "settle"
	/** The attempt is dead. Retire the row and let the order be paid another way. */
	| "clear"
	/** Genuinely mid-flight and not yet old enough to be news. */
	| "wait"
	/** Old enough, or strange enough, that a human has to look. */
	| "alert";

/**
 * Which sweep a `processing` payment row belongs to — **the tab discriminator**.
 *
 * Three shapes exist in `payments`, and only the middle one is ambiguous:
 *
 * - `kind: "order"` / `kind: "tip"` — post-pivot rows (ADR 008). Explicit.
 * - No `kind`, `sessionId` set — a legacy **tab** payment. Returns `null`:
 *   `reconcileStuckTabPayments` owns these and must keep owning them, because
 *   settling one also has to unlock the session (`lockedForPaymentAt`), which
 *   this sweep knows nothing about. Sweeping them here as well would mean two
 *   crons retrieving the same intent and racing to settle it.
 * - No `kind`, no `sessionId` — a legacy **pre-pivot per-order** payment. Swept
 *   as an order: it carries an `orderId` and settles through the same
 *   `orders.confirmPayment` that a `kind: "order"` row does.
 *
 * `kind` is checked before `sessionId`, and the order is load-bearing rather
 * than stylistic: a tip row carries a `sessionId` too (the visit it tips), so
 * reading `sessionId` first would file every post-visit tip as a tab and let
 * this sweep hand it to a path that unlocks tabs. `failPaymentByKind` in
 * `_util/stripe.ts` already depends on exactly this ordering.
 */
export function stuckPaymentSweepKind(payment: {
	kind?: string;
	sessionId?: unknown;
}): StuckPaymentSweepKind | null {
	if (payment.kind === PAYMENT_KIND.TIP) return STUCK_PAYMENT_SWEEP_KIND.TIP;
	if (payment.kind === PAYMENT_KIND.ORDER) return STUCK_PAYMENT_SWEEP_KIND.ORDER;
	if (payment.sessionId !== undefined && payment.sessionId !== null) return null;
	return STUCK_PAYMENT_SWEEP_KIND.ORDER;
}

/**
 * The two thresholds for a kind: how long a row must have gone untouched before
 * Stripe is consulted, and how long before a human is told.
 *
 * They differ by an order of magnitude because the situations do. A stuck
 * ORDER payment is a diner at a table whose food is not being cooked; a stuck
 * TIP is a credit that has not landed for a member who has already gone home.
 */
export function stuckPaymentReconcileAges(kind: StuckPaymentSweepKind): {
	minAgeMs: number;
	alertAgeMs: number;
} {
	return kind === STUCK_PAYMENT_SWEEP_KIND.TIP
		? {
				minAgeMs: TIP_PAYMENT_RECONCILE_MIN_AGE_MS,
				alertAgeMs: TIP_PAYMENT_RECONCILE_ALERT_AGE_MS,
			}
		: {
				minAgeMs: ORDER_PAYMENT_RECONCILE_MIN_AGE_MS,
				alertAgeMs: ORDER_PAYMENT_RECONCILE_ALERT_AGE_MS,
			};
}

/**
 * What to do about a `processing` payment row given what Stripe says about its
 * intent. Mirrors {@link decideTabReconciliation}, with one deliberate
 * divergence noted below.
 *
 * `ageMs` is the row's age from `createdAt`, not from `updatedAt`: this is the
 * "how long has somebody been waiting" question, and a status-preserving patch
 * (a late `stripeChargeId`, a `latestStripeEventId`) must not reset it. The
 * `updatedAt` cutoff is a separate thing entirely — it is how the candidate
 * query finds rows that stopped moving.
 *
 * - `succeeded` — the money is at Stripe and the webhook never landed. Settle.
 * - `canceled` — terminally dead at Stripe. Clear the attempt.
 * - `requires_payment_method` — the card was declined, or the diner opened the
 *   payment sheet and walked away. Every candidate reaching here is already
 *   past its kind's `minAgeMs` by construction (that is what the candidate
 *   query selects on), so this is not a live checkout: clear it. Doing so is
 *   the whole point of the carried TAVLI-104 finding — a served, cash-released
 *   round whose diner abandoned the card sheet is otherwise locked out of
 *   `markOrderPaidInPerson` with ERROR_ORDER_PAYMENT_IN_FLIGHT and no
 *   staff-side release.
 * - `requires_confirmation` / `requires_action` — **diverges from the tab
 *   sweep, which unlocks these.** A tab's lock blocks a whole table from
 *   ordering, so the tab sweep trades an over-eager unlock against that; an
 *   order payment blocks only its own round, and `requires_action` means the
 *   diner is quite possibly mid-3DS in their banking app right now. Clearing
 *   under them would retire a row their confirm is about to charge against.
 *   Wait, then alert.
 * - `processing` / `requires_capture` — genuinely mid-flight at Stripe (the
 *   latter is impossible on this automatic-capture integration, which is why it
 *   is grouped with the waits rather than guessed at). Wait, then alert.
 * - Anything else — a status this code has never seen. Do not guess at the
 *   money state, and do not sit on it either: alert straight away. Unlike the
 *   wait statuses there is no story where time resolves it, and the row is
 *   already past `minAgeMs`.
 */
export function decidePaymentReconciliation(input: {
	paymentIntentStatus: string;
	/** Age from `payments.createdAt`. */
	ageMs: number;
	kind: StuckPaymentSweepKind;
}): PaymentReconcileDecision {
	const { alertAgeMs } = stuckPaymentReconcileAges(input.kind);

	switch (input.paymentIntentStatus) {
		case "succeeded":
			return "settle";
		case "canceled":
		case "requires_payment_method":
			return "clear";
		case "processing":
		case "requires_action":
		case "requires_confirmation":
		case "requires_capture":
			return input.ageMs >= alertAgeMs ? "alert" : "wait";
		default:
			return "alert";
	}
}

/**
 * How loud the `payment_stuck` alert is.
 *
 * Severe for an ORDER past its alert age, and only there. Severe emails every
 * platform admin, so it has to mean "drop what you are doing": an order payment
 * stuck a quarter of an hour is a diner sitting at a table with a card charge
 * in limbo and a kitchen that was never released — nobody else in the system is
 * going to notice, and the diner's next move is a chargeback.
 *
 * Everything else is a warning, which lands on `/admin/alerts` without mail. A
 * stuck TIP is money owed to a staff member with nobody waiting on it, and an
 * order held up by a status we do not recognise (rather than by age) is
 * genuinely unclassified — worth a human's eye, not worth an inbox.
 */
export function stuckPaymentAlertSeverity(
	kind: StuckPaymentSweepKind,
	ageMs: number
): OperatorAlertSeverity {
	const { alertAgeMs } = stuckPaymentReconcileAges(kind);
	return kind === STUCK_PAYMENT_SWEEP_KIND.ORDER && ageMs >= alertAgeMs
		? OPERATOR_ALERT_SEVERITY.SEVERE
		: OPERATOR_ALERT_SEVERITY.WARNING;
}
