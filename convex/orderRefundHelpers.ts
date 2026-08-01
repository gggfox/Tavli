/**
 * Refund planning for a single order.
 *
 * Deliberately **not** `"use node"`: mutations and queries import these helpers,
 * and the pure functions here are unit-tested without pulling in the Stripe SDK.
 * The Stripe call itself lives in `convex/stripe.ts`.
 *
 * ## Why an order needs a "plan" at all
 *
 * A tab (session-level) payment is one PaymentIntent covering several orders,
 * and `payments.orderId` is unset for it — the XOR documented on the `payments`
 * table. Cancelling one order out of that tab therefore means a **partial**
 * refund, and the payment has to be found by walking the session rather than
 * read off the order.
 */

import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";
import { internalMutation, internalQuery } from "./_generated/server";
import { AUDIT_EVENT, ORDER_PAYMENT_STATE, PAYMENT_STATUS, TABLE } from "./constants";
import { appendAuditEvent } from "./_util/audit";

/** Why no refund was issued. Maps 1:1 to a stable error code in the caller. */
export const ORDER_REFUND_BLOCK_REASON = {
	/** The order was never paid — cancelling is all that is needed. */
	NOT_PAID: "not_paid",
	/** Order claims `paid` but no succeeded payment could be resolved. */
	PAYMENT_UNRESOLVED: "payment_unresolved",
	/** The payment has no refundable balance left. */
	NOTHING_REFUNDABLE: "nothing_refundable",
} as const;

export type OrderRefundBlockReason =
	(typeof ORDER_REFUND_BLOCK_REASON)[keyof typeof ORDER_REFUND_BLOCK_REASON];

/**
 * Builds the Stripe idempotency key for refunding one order's share.
 *
 * Keyed on **(payment, order)**, not payment alone. A tab payment can be
 * refunded once per order it covers; a payment-only key would make Stripe
 * replay the first refund's response for 24h and silently move no money on the
 * second order. Deterministic, so a genuine network retry of the *same* cancel
 * still de-duplicates.
 */
export function buildRefundIdempotencyKey(
	paymentId: Id<"payments">,
	orderId: Id<"orders">
): string {
	return `refund:${paymentId}:${orderId}`;
}

/**
 * Works out how much of `payment` to refund for a single order.
 *
 * Refunds the order's own total and **no share of the tip**: the platform takes
 * no fee on tips (`convex/stripe.ts` applies the commission to the tab subtotal
 * only) and tips are attributed to a specific server, so clawing one back takes
 * money from staff rather than from the kitchen that made the mistake.
 *
 * The clamp against the remaining balance is mandatory — Stripe rejects a
 * refund for more than is left on a charge.
 */
export function computeOrderRefundAmount(args: {
	orderTotalAmount: number;
	paymentAmount: number;
	paymentAmountRefunded: number | undefined;
}): { amount: number; isFullRefund: boolean } {
	const alreadyRefunded = args.paymentAmountRefunded ?? 0;
	const remaining = Math.max(0, args.paymentAmount - alreadyRefunded);
	const amount = Math.max(0, Math.min(args.orderTotalAmount, remaining));

	return { amount, isFullRefund: amount > 0 && amount >= remaining };
}

/**
 * Finds the succeeded payment backing an order, across all three data shapes.
 *
 * 1. `order.activePaymentId` — legacy per-order payments, and tab payments
 *    written after this ticket (`confirmTabPayment` now stamps it).
 * 2. The order's session's `activePaymentId`. Safe because `confirmTabPayment`
 *    refuses to settle unless the session still points at the payment it is
 *    settling, and closes the session in the same transaction.
 * 3. Indexed scan of the session's payments, newest successful attempt wins.
 *    Covers rows settled by the stuck-tab reconciliation cron.
 *
 * Step 3 is a fallback rather than the default because a tab accumulates a
 * `superseded` row per retry.
 */
export async function resolveSucceededPaymentForOrder(
	ctx: { db: DatabaseReader },
	order: Doc<"orders">
): Promise<Doc<"payments"> | null> {
	if (order.activePaymentId) {
		const direct = await ctx.db.get(order.activePaymentId);
		if (direct?.status === PAYMENT_STATUS.SUCCEEDED) return direct;
	}

	if (!order.sessionId) return null;

	const session = await ctx.db.get(order.sessionId);
	if (session?.activePaymentId) {
		const viaSession = await ctx.db.get(session.activePaymentId);
		if (viaSession?.status === PAYMENT_STATUS.SUCCEEDED) return viaSession;
	}

	const sessionPayments = await ctx.db
		.query(TABLE.PAYMENTS)
		.withIndex("by_session", (q) => q.eq("sessionId", order.sessionId))
		.collect();

	return sessionPayments
		.filter((p) => p.status === PAYMENT_STATUS.SUCCEEDED)
		.reduce<Doc<"payments"> | null>(
			(best, p) => (best === null || p.attemptNumber > best.attemptNumber ? p : best),
			null
		);
}

export type OrderRefundPlan = {
	paymentId: Id<"payments">;
	orderId: Id<"orders">;
	amount: number;
	isFullRefund: boolean;
	idempotencyKey: string;
};

/**
 * Resolves an order to a refund plan, or explains why no refund is due.
 * Read-only; the caller performs the Stripe call and records the outcome.
 */
export const resolveOrderRefundPlanInternal = internalQuery({
	args: { orderId: v.id(TABLE.ORDERS) },
	handler: async (
		ctx,
		args
	): Promise<{ plan: OrderRefundPlan | null; blocked: OrderRefundBlockReason | null }> => {
		const order = await ctx.db.get(args.orderId);
		if (!order) return { plan: null, blocked: ORDER_REFUND_BLOCK_REASON.PAYMENT_UNRESOLVED };

		// `refund_requested` is the state `updateStatus` moves a paid order into
		// when it is cancelled, so it is the expected input here — not a red flag.
		const wasPaid =
			order.paymentState === ORDER_PAYMENT_STATE.PAID ||
			order.paymentState === ORDER_PAYMENT_STATE.REFUND_REQUESTED;
		if (!wasPaid) return { plan: null, blocked: ORDER_REFUND_BLOCK_REASON.NOT_PAID };

		const payment = await resolveSucceededPaymentForOrder(ctx, order);
		if (!payment) return { plan: null, blocked: ORDER_REFUND_BLOCK_REASON.PAYMENT_UNRESOLVED };

		const { amount, isFullRefund } = computeOrderRefundAmount({
			orderTotalAmount: order.totalAmount,
			paymentAmount: payment.amount,
			paymentAmountRefunded: payment.amountRefunded,
		});
		if (amount <= 0) {
			return { plan: null, blocked: ORDER_REFUND_BLOCK_REASON.NOTHING_REFUNDABLE };
		}

		return {
			plan: {
				paymentId: payment._id,
				orderId: order._id,
				amount,
				isFullRefund,
				idempotencyKey: buildRefundIdempotencyKey(payment._id, order._id),
			},
			blocked: null,
		};
	},
});

/**
 * Records the terminal outcome of an order-level refund.
 *
 * This is the **only** writer of per-order refund state on the tab path: the
 * `charge.refunded` webhook (`stripeHelpers.recordChargeRefund`) only patches an
 * order when the refund is full *and* `payments.orderId` is set, and neither
 * holds for a partial refund of a tab payment.
 */
export const recordOrderRefundOutcomeInternal = internalMutation({
	args: {
		orderId: v.id(TABLE.ORDERS),
		succeeded: v.boolean(),
		amount: v.number(),
		/** The manager who initiated the cancel, for the audit trail. */
		userId: v.string(),
		stripeRefundId: v.optional(v.string()),
		failureMessage: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const order = await ctx.db.get(args.orderId);
		if (!order) return;

		const now = Date.now();
		await ctx.db.patch(args.orderId, {
			paymentState: args.succeeded
				? ORDER_PAYMENT_STATE.REFUNDED
				: ORDER_PAYMENT_STATE.REFUND_FAILED,
			updatedAt: now,
			updatedBy: args.userId,
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.ORDERS,
			aggregateId: args.orderId,
			eventType: args.succeeded
				? AUDIT_EVENT.ORDER_REFUND_SUCCEEDED
				: AUDIT_EVENT.ORDER_REFUND_FAILED,
			restaurantId: order.restaurantId,
			payload: {
				restaurantId: order.restaurantId,
				amount: args.amount,
				...(args.stripeRefundId !== undefined && { stripeRefundId: args.stripeRefundId }),
				...(args.failureMessage !== undefined && { failureMessage: args.failureMessage }),
			},
			userId: args.userId,
		});
	},
});
