/**
 * Pure/shared helpers for the session tab flow (TAVLI-6).
 *
 * A Session doubles as the group's shared tab: orders are submitted to the
 * kitchen unpaid and one Stripe payment settles the whole tab at the end of
 * the visit (subtotal + tip).
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";
import {
	JOIN_CODE_ALPHABET,
	JOIN_CODE_LENGTH,
	SESSION_PAYMENT_STATE,
	TAB_PAYABLE_ORDER_STATUSES,
	TABLE,
} from "./constants";

export const SESSION_PAYMENT_STATE_VALIDATOR = v.union(
	v.literal(SESSION_PAYMENT_STATE.UNPAID),
	v.literal(SESSION_PAYMENT_STATE.PENDING),
	v.literal(SESSION_PAYMENT_STATE.PROCESSING),
	v.literal(SESSION_PAYMENT_STATE.PAID),
	v.literal(SESSION_PAYMENT_STATE.FAILED)
);

export function generateJoinCode(): string {
	let code = "";
	for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
		code += JOIN_CODE_ALPHABET[Math.floor(Math.random() * JOIN_CODE_ALPHABET.length)];
	}
	return code;
}

const PAYABLE_STATUSES = new Set<string>(TAB_PAYABLE_ORDER_STATUSES);

export function isPayableOrder(order: Doc<typeof TABLE.ORDERS>): boolean {
	return PAYABLE_STATUSES.has(order.status) && order.paymentState !== "paid";
}

/**
 * The tab balance: every submitted-or-later, non-cancelled, not-yet-paid
 * order in the session. Draft orders are excluded — they were never sent to
 * the kitchen.
 */
export async function getPayableOrders(
	ctx: { db: DatabaseReader },
	sessionId: Id<typeof TABLE.SESSIONS>
): Promise<Array<Doc<typeof TABLE.ORDERS>>> {
	const orders = await ctx.db
		.query(TABLE.ORDERS)
		.withIndex("by_session", (q) => q.eq("sessionId", sessionId))
		.collect();
	return orders.filter(isPayableOrder);
}

export function sumOrderTotals(orders: Array<Doc<typeof TABLE.ORDERS>>): number {
	let total = 0;
	for (const order of orders) total += order.totalAmount;
	return total;
}

/**
 * Outcome of reconciling a tab stuck locked-for-payment against its Stripe
 * PaymentIntent:
 *
 * - `settle` — the PaymentIntent succeeded; the `payment_intent.succeeded`
 *   webhook was dropped/delayed, so run the same idempotent fulfillment.
 * - `unlock` — the attempt is terminally dead (canceled, or waiting on the
 *   customer after a declined/abandoned checkout); clear the lock so the group
 *   can retry or so staff can close the tab.
 * - `wait` — Stripe is genuinely still processing; leave the lock in place.
 * - `alert` — still processing, but the lock has outlived `alertAgeMs`; leave
 *   it locked but surface it (console.error) so staff can investigate.
 */
export type TabReconcileDecision = "settle" | "unlock" | "wait" | "alert";

/**
 * Pure decision function for {@link stripe.reconcileStuckTabPayments}. Maps a
 * PaymentIntent status plus the age of the payment lock to the action the cron
 * should take. Kept side-effect-free so every branch is unit-testable without
 * Stripe or a database.
 *
 * Candidates are already filtered to locks older than `TAB_RECONCILE_MIN_AGE_MS`
 * before this runs, so a `requires_*`/`canceled` status here means a genuinely
 * abandoned or failed attempt rather than one still in progress.
 */
export function decideTabReconciliation(input: {
	paymentIntentStatus: string;
	lockAgeMs: number;
	alertAgeMs: number;
}): TabReconcileDecision {
	switch (input.paymentIntentStatus) {
		case "succeeded":
			return "settle";
		// Terminally canceled, or stalled waiting on the customer (declined card
		// left it in `requires_payment_method`, abandoned 3DS, never confirmed).
		// The in-flight payment is effectively dead — unlock so ordering resumes.
		case "canceled":
		case "requires_payment_method":
		case "requires_confirmation":
		case "requires_action":
			return "unlock";
		case "processing":
			return input.lockAgeMs >= input.alertAgeMs ? "alert" : "wait";
		default:
			// Unknown/unexpected status (e.g. `requires_capture`, which this
			// automatic-capture integration never produces). Don't guess at the
			// money state — hold the lock and escalate to an alert once it is old.
			return input.lockAgeMs >= input.alertAgeMs ? "alert" : "wait";
	}
}
