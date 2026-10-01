/**
 * Superseding a payment attempt, and the two questions that decide whether it
 * is even allowed (TAVLI-104).
 *
 * Every checkout path in Tavli can produce a second PaymentIntent for the same
 * thing: the diner edits the order, moves the tip slider, or simply taps twice.
 * The row for the previous attempt is then patched to `superseded`. Until this
 * ticket, nobody told Stripe — the old intent stayed live, and its client
 * secret stayed confirmable by a stale tab, a back button or a retry. The money
 * moved, the webhook could not place the charge against the order, and it gave
 * up with a `console.warn`.
 *
 * The cure is Stripe-first ordering (`_util/stripe.ts`'s
 * `standDownPaymentIntent`) plus the two guards below, which are pure so they
 * can be reasoned about and tested without a Stripe client or a database:
 *
 * - {@link isPaymentCreateInFlight} — is the previous attempt's
 *   `paymentIntents.create` call *still running*? Then there is no intent id to
 *   cancel, and superseding the row would let a second call charge the card a
 *   second time.
 * - {@link currentOrderChargeAmount} — what would this order cost to charge
 *   *right now*? The webhook asks this when a charge arrives that it cannot
 *   place, to decide between accepting the money and refunding it.
 *
 * Zero Convex imports beyond types, so both are callable from a mutation, an
 * action, or a unit test.
 */
import type { Doc } from "./_generated/dataModel";
import { computeOrderCharge } from "./_shared/tip";
import {
	PAYMENT_CREATE_IN_FLIGHT_WINDOW_MS,
	PAYMENT_REFUND_STATUS,
	PAYMENT_STATUS,
} from "./constants";

/**
 * Stable, diner-facing codes the supersede paths return instead of quietly
 * creating a second intent. Every one means "we did not charge you, and here is
 * what to do", and each maps to an `errors.<CODE>` entry in en.json/es.json.
 */
export const PAYMENT_SUPERSEDE_ERRORS = {
	/**
	 * Stripe could not be reached to stand the previous intent down, so a new
	 * one is refused: creating it would leave two live intents for one order and
	 * the diner one stale tab away from paying twice. The checkout shows "try
	 * again".
	 */
	CANCEL_FAILED: "ERROR_PAYMENT_CANCEL_FAILED",
	/**
	 * The previous intent reads `succeeded` at Stripe — the diner has already
	 * paid, whatever this screen thinks. Nothing new is created; the webhook (or
	 * the TAVLI-105 metadata fallback) settles it moments later.
	 *
	 * Also what `stripeHelpers.createPayment` throws when the order was settled
	 * some other way — staff marked it paid in person — between the action's
	 * snapshot and the insert. Same message, same truth: nothing more to pay.
	 */
	ALREADY_PAID: "ERROR_PAYMENT_ALREADY_PAID",
	/**
	 * A `paymentIntents.create` for this payment is still in flight — a double
	 * tap, a second tab, an impatient retry. See
	 * {@link isPaymentCreateInFlight}.
	 */
	IN_PROGRESS: "ERROR_PAYMENT_IN_PROGRESS",
	/**
	 * The order moved between the snapshot `createPaymentIntent` priced the
	 * charge from and the transaction that inserts the payment row: it was
	 * edited (a shared draft gained or lost a line), left a payable status, or
	 * was deleted. Charging it would take a stale total. Nothing was created at
	 * Stripe; the diner reviews the order and taps Pay again.
	 */
	ORDER_CHANGED: "ERROR_PAYMENT_ORDER_CHANGED",
} as const;

export type PaymentSupersedeError =
	(typeof PAYMENT_SUPERSEDE_ERRORS)[keyof typeof PAYMENT_SUPERSEDE_ERRORS];

/** The fields the in-flight question actually needs. */
type InFlightCandidate = Pick<Doc<"payments">, "status" | "stripePaymentIntentId" | "createdAt">;

/**
 * Is this row's `paymentIntents.create` call still running?
 *
 * Every create path writes the `payments` row FIRST and calls Stripe second, so
 * the intent's metadata can carry the row id (TAVLI-105). That leaves a window
 * in which the row is `pending` and holds no intent id, and the row shape alone
 * cannot distinguish two situations:
 *
 * 1. The call is in flight. On the one-tap tip path (`off_session` +
 *    `confirm: true`) the money moves *inside* that call, so treating the row as
 *    a dead attempt and superseding it is how a double tap tips a server twice
 *    for one gesture — the carried TAVLI-105 finding.
 * 2. The process died between the insert and the call. Then the row is debris
 *    and a retry should be free to supersede it.
 *
 * Age is the only available discriminator, hence
 * {@link PAYMENT_CREATE_IN_FLIGHT_WINDOW_MS}. Inside the window we assume (1)
 * and refuse the second attempt; past it we assume (2). Getting it wrong in the
 * first direction costs a diner one retry a minute later; getting it wrong in
 * the second direction charges their card twice.
 *
 * A row that already carries an intent id is never "in flight" — the create
 * returned, and the intent can be cancelled by id like any other.
 */
export function isPaymentCreateInFlight(payment: InFlightCandidate, nowMs: number): boolean {
	if (payment.status !== PAYMENT_STATUS.PENDING) return false;
	if (payment.stripePaymentIntentId) return false;
	return nowMs - payment.createdAt < PAYMENT_CREATE_IN_FLIGHT_WINDOW_MS;
}

/** The fields the recompute needs off the payment row. */
type ChargeShapedPayment = Pick<Doc<"payments">, "subtotalAmount" | "gratuityAmount">;

/**
 * What this order would cost to charge right now, in the same shape the
 * payment row records: subtotal + service fee + the tip the diner chose.
 *
 * Used by `orders.confirmPayment` to decide what to do with a charge it cannot
 * place against the order (TAVLI-104). If the money collected equals this
 * number, the charge pays for exactly what the order costs today and can be
 * accepted whatever happened to `activePaymentId` or the `updatedAt` snapshot.
 * If it does not, the order was genuinely repriced and the money goes back.
 *
 * The fee is re-derived with {@link computeOrderCharge} — the same helper
 * `createPaymentIntent` uses, so the two can never drift apart. The **tip is
 * not** re-derived: the order does not store the percentage the diner picked,
 * and 10% of a repriced subtotal is not a number they ever agreed to. What the
 * order controls (subtotal, fee) is recomputed; what the diner controls (the
 * gratuity) is taken from the row.
 *
 * Legacy rows carry no `subtotalAmount`: those intents charged the order total
 * flat, with no service fee and no separate gratuity. They keep exactly the
 * comparison they always had.
 */
export function currentOrderChargeAmount(
	orderTotalAmount: number,
	payment: ChargeShapedPayment,
	feeRate: number
): number {
	if (payment.subtotalAmount === undefined) return orderTotalAmount;
	const { amount } = computeOrderCharge(orderTotalAmount, feeRate, 0);
	return amount + (payment.gratuityAmount ?? 0);
}

/**
 * May this payment row record a failure? The forward-only guard shared by
 * `orders.failPayment` and `payments.failTipPayment` (review rounds 1 and 2).
 *
 * Round 1 tightened these from "refuse SUCCEEDED" to "accept PENDING or
 * PROCESSING only", because the stuck-payment sweep acts on a row it read
 * minutes earlier: if a fresh attempt superseded it in that gap, rewriting
 * SUPERSEDED to FAILED would lose the more precise fact — "replaced", not
 * "declined" — and log a decline that never happened.
 *
 * That went one state too far. FAILED → FAILED is not a backwards move, it is
 * the **same** move with better information: Stripe delivers
 * `payment_intent.payment_failed` once per declined attempt, and an intent the
 * diner retries in place declines more than once. Refusing the second delivery
 * froze the row on the FIRST reason, so a row would say "insufficient funds"
 * while the card had since been reported lost — and `failedAt` would name the
 * wrong moment. The failure fields are the only thing a re-fail rewrites, and
 * they are exactly what is out of date.
 *
 * So the refusals are the states where a failure is no longer the truth:
 * - **SUCCEEDED** — Stripe has the money. Always was refused.
 * - **SUPERSEDED / CANCELLED** — retired deliberately, by a newer attempt or by
 *   a staff cancel. The row already says something more precise.
 * - **A row that saw refund activity** — money moved back, so this row's story
 *   is about a refund, not a decline. Unreachable through the normal paths (a
 *   refund lands on a SUCCEEDED row) but a manual Stripe-dashboard refund
 *   writes refund facts wherever it finds them, and a "declined" stamp on top
 *   of that would be a lie in the ledger.
 */
export function canRecordPaymentFailure(
	payment: {
		status: string;
		refundStatus?: string;
	},
	options?: {
		/**
		 * Refuse a row that is already FAILED (`onlyIfInFlight` on the mutations).
		 *
		 * The FAILED → FAILED refresh belongs to `handlePaymentIntentFailure`,
		 * whose reason IS the news: Stripe declined again, and the newer decline
		 * is the truer one. It does NOT belong to the stuck-payment sweep, whose
		 * "reason" is a sentence about reconciliation (`reconcile_canceled`). The
		 * sweep decides about a row it read minutes ago; if a real
		 * `payment_intent.payment_failed` landed in that gap, the row now carries
		 * the decline code the diner's bank gave — and overwriting
		 * "insufficient_funds" with "PaymentIntent status is canceled" would
		 * destroy the only useful fact on the row, for a state change that had
		 * already happened anyway.
		 */
		onlyIfInFlight?: boolean;
	}
): boolean {
	const terminalIsAllowed = !options?.onlyIfInFlight;
	if (
		payment.status !== PAYMENT_STATUS.PENDING &&
		payment.status !== PAYMENT_STATUS.PROCESSING &&
		!(terminalIsAllowed && payment.status === PAYMENT_STATUS.FAILED)
	) {
		return false;
	}
	return payment.refundStatus === undefined || payment.refundStatus === PAYMENT_REFUND_STATUS.NONE;
}
