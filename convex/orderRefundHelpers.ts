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
import {
	AUDIT_EVENT,
	AUDIT_SYSTEM_USER_ID,
	ORDER_PAYMENT_STATE,
	PAYMENT_STATUS,
	TABLE,
} from "./constants";
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
 *
 * The whole-order cancel also uses this shape for the **substitution** payments
 * it sweeps (`refund:<substitutionPaymentId>:<orderId>`), which is deliberately
 * distinct from the per-line key the 86 path uses on the same payment
 * (`refund:<substitutionPaymentId>:<orderItemId>` — see
 * {@link buildLineRefundIdempotencyKey}). The two can never collide: a Convex
 * `orders` id is never an `orderItems` id.
 */
export function buildRefundIdempotencyKey(
	paymentId: Id<"payments">,
	orderId: Id<"orders">
): string {
	return `refund:${paymentId}:${orderId}`;
}

/**
 * Builds the Stripe idempotency key for refunding a single 86'd line of a paid
 * order (ADR 008). Keyed on **(payment, orderItem)** for the same reason the
 * whole-order key above is keyed on (payment, order): one payment can see
 * several line refunds, and a payment-only key would silently replay the first
 * one. The whole-order key stays in use for whole-order cancels — the two never
 * collide because a Convex `orderItems` id is never an `orders` id.
 */
export function buildLineRefundIdempotencyKey(
	paymentId: Id<"payments">,
	orderItemId: Id<"orderItems">
): string {
	return `refund:${paymentId}:${orderItemId}`;
}

/**
 * How much of `payment` to refund for one 86'd line of a paid order (ADR 008).
 *
 * The diner paid `lineTotal` plus the customer-borne service fee on it, so the
 * line's refund is `lineTotal + round(lineTotal × feeRate)`, clamped to the
 * payment's remaining balance (Stripe rejects a refund for more than is left).
 *
 * When the 86'd line is the order's **last live line** the whole order is
 * cancelled and the refund is the payment's entire remaining balance instead.
 * That makes per-order rounding residue structurally zero: however the earlier
 * per-line `round()`s fell, the final line sweeps whatever is left, so the sum
 * of a fully-86'd order's refunds is exactly `payment.amount`. (This replaces
 * the ~1.09%-of-refund residue documented in the stripe-go-live runbook, which
 * came from letting Stripe apportion fees proportionally.)
 */
export function computeLineRefundAmount(args: {
	lineTotal: number;
	feeRate: number;
	paymentAmount: number;
	paymentAmountRefunded: number | undefined;
	isLastLiveLine: boolean;
}): number {
	const remaining = Math.max(0, args.paymentAmount - (args.paymentAmountRefunded ?? 0));
	if (args.isLastLiveLine) {
		return remaining;
	}
	return Math.min(args.lineTotal + Math.round(args.lineTotal * args.feeRate), remaining);
}

/**
 * How much of one **substitution** payment a whole-order cancel sweeps back.
 *
 * A substitution payment is its own PaymentIntent charging exactly one accepted
 * proposal's `deltaAmount + feeOnDelta` — money that belongs to a single line of
 * a single order. So a whole-order cancel returns its **entire remaining
 * balance**: there is nothing else on that charge to strand. (Contrast the
 * legacy tab payment, where "remaining" belongs to many orders and the clamp in
 * {@link computeOrderRefundAmount} is load-bearing.)
 *
 * Returns `0` — i.e. "skip this payment" — when the line was already refunded
 * individually (86 on a paid order stamps `orderItems.refundedAt` and
 * `stripe.refundOrderItem` already returned both this delta and the line's
 * share of the order payment). Without that guard the sweep would issue a
 * second refund for money the diner already has back; the remaining-balance
 * clamp catches it too, but only once the per-line refund has been recorded,
 * and correctness here must not depend on that write having landed.
 */
export function computeSupplementalSweepAmount(args: {
	paymentAmount: number;
	paymentAmountRefunded: number | undefined;
	/** `orderItems.refundedAt !== undefined` for the proposal's line. */
	lineAlreadyRefunded: boolean;
}): number {
	if (args.lineAlreadyRefunded) return 0;
	return Math.max(0, args.paymentAmount - (args.paymentAmountRefunded ?? 0));
}

/**
 * Works out how much of `payment` to refund for a single order.
 *
 * Two vintages of payment rows, two rules — branched on `subtotalAmount`
 * presence, the ADR 008 marker:
 *
 * **Fee-inclusive (new model, `subtotalAmount` set):** the payment covers
 * exactly one order and its charge is `subtotal + customer-borne fee`, so a
 * whole-order cancel refunds the payment's entire remaining balance — the
 * diner's fee comes back with their subtotal. Clamping to `orderTotalAmount`
 * here would strand the fee on the charge forever.
 *
 * **Legacy (`subtotalAmount` absent):** a tab payment covers many orders, so
 * the refund is the order's own total and **no share of the tip**: the platform
 * takes no fee on tips and tips are attributed to a specific server, so clawing
 * one back takes money from staff rather than from the kitchen that made the
 * mistake. Refunding "remaining" here would hand one order the other orders'
 * money — the per-order clamp is load-bearing and must stay exactly as shipped.
 *
 * The clamp against the remaining balance is mandatory in both branches —
 * Stripe rejects a refund for more than is left on a charge.
 */
export function computeOrderRefundAmount(args: {
	orderTotalAmount: number;
	paymentAmount: number;
	paymentAmountRefunded: number | undefined;
	/** `payments.subtotalAmount` — present only on fee-inclusive ADR 008 rows. */
	paymentSubtotalAmount?: number;
}): { amount: number; isFullRefund: boolean } {
	const alreadyRefunded = args.paymentAmountRefunded ?? 0;
	const remaining = Math.max(0, args.paymentAmount - alreadyRefunded);

	if (args.paymentSubtotalAmount !== undefined) {
		return { amount: remaining, isFullRefund: remaining > 0 };
	}

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
 *
 * Scope: this plan covers the **order payment** only. An order holding accepted
 * substitutions was also charged one supplemental PaymentIntent per accepted
 * proposal, and those are swept separately by `stripe.cancelOrderAndRefund`
 * (see {@link computeSupplementalSweepAmount}) — the same split
 * `stripe.refundOrderItem` makes for a single 86'd substituted line. A `null`
 * plan therefore does **not** mean "no money to return": the caller must still
 * run the substitution sweep before reporting nothing was refundable.
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
			paymentSubtotalAmount: payment.subtotalAmount,
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
 *
 * `supplementalRefunds` carries the substitution payments the whole-order sweep
 * returned (ADR 008), each accumulated onto its own payment row — the same
 * shape and the same optimistic accounting as
 * {@link recordOrderItemRefundOutcomeInternal}. They are recorded whatever
 * `succeeded` says: a refund that moved money is a fact, and a partial failure
 * must not erase the parts that worked.
 */
export const recordOrderRefundOutcomeInternal = internalMutation({
	args: {
		orderId: v.id(TABLE.ORDERS),
		succeeded: v.boolean(),
		amount: v.number(),
		/** The manager who initiated the cancel, for the audit trail. */
		userId: v.string(),
		/** Substitution-payment shares swept by a whole-order cancel. */
		supplementalRefunds: v.optional(
			v.array(
				v.object({
					paymentId: v.id(TABLE.PAYMENTS),
					amount: v.number(),
					stripeRefundId: v.optional(v.string()),
				})
			)
		),
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

		for (const supplemental of args.supplementalRefunds ?? []) {
			const payment = await ctx.db.get(supplemental.paymentId);
			if (payment) {
				await ctx.db.patch(supplemental.paymentId, {
					amountRefunded: (payment.amountRefunded ?? 0) + supplemental.amount,
					updatedAt: now,
					updatedBy: AUDIT_SYSTEM_USER_ID,
				});
			}
		}

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
				...(args.supplementalRefunds !== undefined &&
					args.supplementalRefunds.length > 0 && {
						supplementalRefunds: args.supplementalRefunds,
					}),
				...(args.stripeRefundId !== undefined && { stripeRefundId: args.stripeRefundId }),
				...(args.failureMessage !== undefined && { failureMessage: args.failureMessage }),
			},
			userId: args.userId,
		});
	},
});

/**
 * Records the terminal outcome of a single-line (86-on-paid) refund — the
 * per-line sibling of {@link recordOrderRefundOutcomeInternal} (ADR 008).
 *
 * Order-state policy, decided here so every caller agrees:
 * - A **partial** line refund leaves `order.paymentState` at `"paid"` — the
 *   order keeps cooking and flipping it to `refunded` would pull a live ticket
 *   off staff surfaces. The refund's durable record is the order item's
 *   `refundedAt`/`refundAmount`, the audit trail, and the payment's
 *   `amountRefunded`.
 * - The **last live line** refund settles a now-cancelled order, so it follows
 *   the whole-order flow: `refund_requested` (stamped by `cancelOrderItem`) →
 *   `refunded` here.
 * - A **failed** refund flips the order to `refund_failed` in both cases —
 *   money is owed and staff must see it, cooking or not.
 *
 * On success this also accumulates `payments.amountRefunded` optimistically so
 * the next line's refund math sees the reduced balance immediately; the
 * `charge.refunded` webhook later overwrites it with Stripe's authoritative
 * cumulative figure, which converges to the same number.
 *
 * A **substituted** line's refund spans two payments (ADR 008 Phase 3A): the
 * original share comes back on the order payment and the delta (+ fee on
 * delta) on the substitution payment. `amount` is the combined figure recorded
 * on the line; `paymentAmountPortion` is the order-payment share of it
 * (defaults to `amount` for the unsubstituted case) and `supplementalRefunds`
 * carries the per-substitution-payment shares, each accumulated onto its own
 * payment row — including when `succeeded` is false, because a delta refund
 * that went through before a later leg failed still moved the diner's money.
 */
export const recordOrderItemRefundOutcomeInternal = internalMutation({
	args: {
		orderId: v.id(TABLE.ORDERS),
		orderItemId: v.id(TABLE.ORDER_ITEMS),
		succeeded: v.boolean(),
		amount: v.number(),
		/** Whether this refund settled the order's last live line (order cancelled). */
		isLastLiveLine: v.boolean(),
		/** The staff member who 86'd the line, for the audit trail. */
		userId: v.string(),
		paymentId: v.optional(v.id(TABLE.PAYMENTS)),
		/** Share of `amount` refunded from `paymentId` (defaults to `amount`). */
		paymentAmountPortion: v.optional(v.number()),
		/** Substitution-payment shares of a substituted line's refund. */
		supplementalRefunds: v.optional(
			v.array(
				v.object({
					paymentId: v.id(TABLE.PAYMENTS),
					amount: v.number(),
					stripeRefundId: v.optional(v.string()),
				})
			)
		),
		stripeRefundId: v.optional(v.string()),
		failureMessage: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const order = await ctx.db.get(args.orderId);
		if (!order) return;

		const now = Date.now();
		if (args.succeeded) {
			await ctx.db.patch(args.orderItemId, {
				refundedAt: now,
				refundAmount: args.amount,
				...(args.stripeRefundId !== undefined && { stripeRefundId: args.stripeRefundId }),
			});

			const orderPaymentPortion = args.paymentAmountPortion ?? args.amount;
			if (args.paymentId !== undefined && orderPaymentPortion > 0) {
				const payment = await ctx.db.get(args.paymentId);
				if (payment) {
					await ctx.db.patch(args.paymentId, {
						amountRefunded: (payment.amountRefunded ?? 0) + orderPaymentPortion,
						updatedAt: now,
						updatedBy: AUDIT_SYSTEM_USER_ID,
					});
				}
			}
		}

		// Outside the success branch on purpose: a substitution refund that went
		// through before a later leg failed still moved the diner's money, and the
		// payment row has to say so — otherwise the whole-order sweep (which reads
		// `amountRefunded` to decide what is left) would try to return it twice.
		for (const supplemental of args.supplementalRefunds ?? []) {
			const payment = await ctx.db.get(supplemental.paymentId);
			if (payment) {
				await ctx.db.patch(supplemental.paymentId, {
					amountRefunded: (payment.amountRefunded ?? 0) + supplemental.amount,
					updatedAt: now,
					updatedBy: AUDIT_SYSTEM_USER_ID,
				});
			}
		}

		if (args.succeeded && args.isLastLiveLine) {
			await ctx.db.patch(args.orderId, {
				paymentState: ORDER_PAYMENT_STATE.REFUNDED,
				updatedAt: now,
				updatedBy: args.userId,
			});
		} else if (!args.succeeded) {
			await ctx.db.patch(args.orderId, {
				paymentState: ORDER_PAYMENT_STATE.REFUND_FAILED,
				updatedAt: now,
				updatedBy: args.userId,
			});
		}

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.ORDERS,
			aggregateId: args.orderId,
			eventType: args.succeeded ? AUDIT_EVENT.ORDER_ITEM_REFUNDED : AUDIT_EVENT.ORDER_REFUND_FAILED,
			restaurantId: order.restaurantId,
			payload: {
				restaurantId: order.restaurantId,
				orderItemId: args.orderItemId,
				amount: args.amount,
				isLastLiveLine: args.isLastLiveLine,
				...(args.supplementalRefunds !== undefined &&
					args.supplementalRefunds.length > 0 && {
						supplementalRefunds: args.supplementalRefunds,
					}),
				...(args.stripeRefundId !== undefined && { stripeRefundId: args.stripeRefundId }),
				...(args.failureMessage !== undefined && { failureMessage: args.failureMessage }),
			},
			userId: args.userId,
		});
	},
});
