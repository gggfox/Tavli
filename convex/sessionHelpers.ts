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
