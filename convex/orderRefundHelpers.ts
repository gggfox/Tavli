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
 *
 * ## One refund in flight per payment
 *
 * Every refund the app issues against a payment is first **reserved** on the
 * payment row (`payments.pendingRefund`) by the mutation that decides it —
 * `orders.cancelOrderItem` for a removed line, `orders.updateStatus` for a
 * whole-order cancel. Both read the row, so Convex's OCC serializes two refunds
 * racing on one charge and the loser is refused with `ERROR_REFUND_IN_PROGRESS`
 * before it has changed anything. Without it, two line removals a second apart
 * both sized their refund from the same stale `amountRefunded`: the second
 * asked Stripe for more than remained and the diner was left owed money.
 *
 * The reservation carries the idempotency key and the exact amount (absent for
 * "whatever remains"), so the Stripe call is fully decided inside the
 * transaction. The outcome mutation clears it on success and marks it failed
 * otherwise, and the manager can retry it ({@link armRefundRetryInternal}).
 *
 * ## Which idempotency key a retry sends
 *
 * Stripe stores the first response under an idempotency key — success or
 * failure, 5xx included — and replays it for 24h. So the key a retry sends
 * depends on what the failed attempt learned:
 * - **Unknown outcome** (no Stripe response: timeout, connection error, a
 *   crashed action): the refund may exist, so the retry re-sends the SAME key
 *   and body. Stripe replays it if it landed, or runs it now if it never
 *   arrived. A fresh key here could pay the diner twice.
 * - **Definitive failure** (Stripe answered with an error): no refund exists
 *   under that key, and re-sending it would only replay the cached error. The
 *   retry moves to `${key}:retry:${attempt}` ({@link refundAttemptKey}).
 * `createRefund` classifies the error and records it on the reservation
 * (`lastFailureDefinitive`) before the outcome mutation marks it failed.
 *
 * `payments.amountRefunded` is never summed locally: it is always Stripe's own
 * cumulative figure, and every writer keeps the larger of stored and incoming
 * ({@link mergeRefundTotals}).
 */

import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader, MutationCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./_generated/server";
import {
	AUDIT_EVENT,
	ORDER_PAYMENT_STATE,
	ORDER_STATUS,
	PAYMENT_REFUND_STATUS,
	PAYMENT_STATUS,
	TABLE,
	type OrderPaymentState,
} from "./constants";
import {
	ConflictError,
	NotFoundError,
	type ConflictErrorObject,
	type NotAuthenticatedErrorObject,
	type NotAuthorizedErrorObject,
	type NotFoundErrorObject,
} from "./_shared/errors";
import type { AsyncReturn } from "./_shared/types";
import { appendAuditEvent } from "./_util/audit";
import {
	getCurrentUserId,
	requireRestaurantManagerOrAbove,
	requireRestaurantStaffAccess,
} from "./_util/auth";

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

/** Stable codes for refund conflicts; the frontend maps each to an i18n key. */
export const REFUND_ERRORS = {
	/** Another refund on the same payment is still being issued. */
	IN_PROGRESS: "ERROR_REFUND_IN_PROGRESS",
	/** The order has no failed refund this app can re-send. */
	NOT_RETRYABLE: "ERROR_REFUND_NOT_RETRYABLE",
	/** A manager's retry reached Stripe and failed again. */
	RETRY_FAILED: "ERROR_REFUND_RETRY_FAILED",
} as const;

/**
 * After this long an unreleased reservation is presumed abandoned — the action
 * that held it died between Stripe and the outcome write. Far above a Stripe
 * round-trip and Convex's 10-minute action limit, so a live refund is never
 * mistaken for a dead one; short enough that a crash does not wedge a payment.
 */
export const REFUND_CLAIM_STALE_MS = 15 * 60 * 1000;

type PendingRefund = NonNullable<Doc<"payments">["pendingRefund"]>;

/** Whether `held` still blocks a new refund: reserved, not failed, not abandoned. */
export function isRefundClaimLive(held: PendingRefund, now: number): boolean {
	return held.failedAt === undefined && now - held.reservedAt < REFUND_CLAIM_STALE_MS;
}

/**
 * Throws `ERROR_REFUND_IN_PROGRESS` when another refund is being issued against
 * `payment`. Call it before the first write of the mutation that decides a
 * refund, so a refused request leaves nothing behind.
 */
export function assertRefundClaimable(payment: Doc<"payments">, now: number): void {
	if (payment.pendingRefund && isRefundClaimLive(payment.pendingRefund, now)) {
		throw new ConflictError(REFUND_ERRORS.IN_PROGRESS);
	}
}

/** The idempotency key actually sent to Stripe for a reservation's current attempt. */
export function refundAttemptKey(held: { idempotencyKey: string; attempt?: number }): string {
	return held.attempt ? `${held.idempotencyKey}:retry:${held.attempt}` : held.idempotencyKey;
}

/**
 * The attempt a retry of `held` must use: the same one after an unknown
 * outcome, the next one after a definitive Stripe error (see the module doc).
 */
export function nextRefundAttempt(held: PendingRefund): number {
	const attempt = held.attempt ?? 0;
	return held.lastFailureDefinitive === true ? attempt + 1 : attempt;
}

/**
 * Reserves the refund on the payment row (see the module doc). Throws
 * `ERROR_REFUND_IN_PROGRESS` when another one is live.
 *
 * Re-reserving a key that was reserved before (a failed attempt) keeps the
 * original `amount`: Stripe only replays an idempotent request whose body is
 * identical, so a key must never be re-sent with a different amount. The
 * attempt carries over by {@link nextRefundAttempt}.
 */
export async function claimRefund(
	ctx: MutationCtx,
	payment: Doc<"payments">,
	claim: {
		idempotencyKey: string;
		orderId: Id<"orders">;
		orderItemId?: Id<"orderItems">;
		/** Omit to refund whatever remains on the charge. */
		amount?: number;
		/** Start on a retry generation other than 0 (see `armRefundRetryInternal`). */
		attempt?: number;
	},
	now: number
): Promise<void> {
	assertRefundClaimable(payment, now);
	const held = payment.pendingRefund;
	const sameKey = held?.idempotencyKey === claim.idempotencyKey;
	const amount = sameKey ? held.amount : claim.amount;
	const attempt = sameKey ? nextRefundAttempt(held) : (claim.attempt ?? 0);
	await ctx.db.patch(payment._id, {
		pendingRefund: {
			idempotencyKey: claim.idempotencyKey,
			orderId: claim.orderId,
			...(claim.orderItemId !== undefined && { orderItemId: claim.orderItemId }),
			...(amount !== undefined && { amount }),
			...(attempt > 0 && { attempt }),
			reservedAt: now,
		},
		updatedAt: now,
	});
}

/**
 * Releases the reservation `idempotencyKey` holds, if it still holds one:
 * cleared when the refund settled, kept with `failedAt` when it did not so the
 * retry can re-send it.
 */
async function settleRefundClaim(
	ctx: MutationCtx,
	payment: Doc<"payments">,
	idempotencyKey: string,
	settled: boolean,
	now: number
): Promise<void> {
	const held = payment.pendingRefund;
	if (held?.idempotencyKey !== idempotencyKey) return;
	await ctx.db.patch(payment._id, {
		pendingRefund: settled ? undefined : { ...held, failedAt: now },
		updatedAt: now,
	});
}

/** Whether Stripe has returned the whole charge, by our recorded totals. */
export function isPaymentFullyRefunded(
	payment: Pick<Doc<"payments">, "amount" | "amountRefunded" | "refundStatus">
): boolean {
	return (
		payment.refundStatus === PAYMENT_REFUND_STATUS.SUCCEEDED ||
		(payment.amount > 0 && (payment.amountRefunded ?? 0) >= payment.amount)
	);
}

/**
 * Folds a cumulative refund total reported by Stripe into what is stored.
 *
 * Monotonic by construction: `charge.refunded` deliveries can arrive out of
 * order (a partial's event after the full one's), and `createRefund` records
 * the same figure the webhook later repeats. Taking the max of the two
 * cumulative totals means neither a late event nor a replay can shrink the
 * figure, and nothing is ever counted twice. A payment once fully refunded
 * stays fully refunded — `succeeded` never regresses to `partial`, which would
 * count a refunded sale as revenue again.
 */
export function mergeRefundTotals(
	stored: Pick<Doc<"payments">, "amount" | "amountRefunded" | "refundStatus">,
	incoming: { amountRefunded: number; isFullyRefunded: boolean; amountCaptured?: number }
): { amountRefunded: number; isFullyRefunded: boolean } {
	const amountRefunded = Math.max(stored.amountRefunded ?? 0, incoming.amountRefunded);
	const captured =
		incoming.amountCaptured !== undefined && incoming.amountCaptured > 0
			? incoming.amountCaptured
			: stored.amount;
	const isFullyRefunded =
		incoming.isFullyRefunded ||
		stored.refundStatus === PAYMENT_REFUND_STATUS.SUCCEEDED ||
		(captured > 0 && amountRefunded >= captured);
	return { amountRefunded, isFullyRefunded };
}

/**
 * Builds the Stripe idempotency key for refunding one order's share.
 *
 * Keyed on **(payment, order)**, not payment alone. A tab payment can be
 * refunded once per order it covers; a payment-only key would make Stripe
 * replay the first refund's response for 24h and silently move no money on the
 * second order. Deterministic, so a genuine network retry of the *same* cancel
 * still de-duplicates.
 *
 * Deliberately distinct in shape from the per-line key
 * ({@link buildLineRefundIdempotencyKey}): the two can never collide, because a
 * Convex `orders` id is never an `orderItems` id.
 */
export function buildRefundIdempotencyKey(
	paymentId: Id<"payments">,
	orderId: Id<"orders">
): string {
	return `refund:${paymentId}:${orderId}`;
}

/**
 * Builds the Stripe idempotency key for refunding a single line removed from a
 * paid order (ADR 008). Keyed on **(payment, orderItem)** for the same reason the
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
 * How much of `payment` to refund for one line removed from a paid order
 * (ADR 008).
 *
 * The diner paid `lineTotal` plus the customer-borne service fee on it, so the
 * line's refund is `lineTotal + round(lineTotal × feeRate)`, clamped to the
 * payment's remaining balance (Stripe rejects a refund for more than is left).
 *
 * When the removed line is the order's **last live line** the whole order is
 * cancelled and the refund is the payment's entire remaining balance instead.
 * That makes per-order rounding residue structurally zero: however the earlier
 * per-line `round()`s fell, the final line sweeps whatever is left, so the sum
 * of a fully-emptied order's refunds is exactly `payment.amount`. (This replaces
 * the ~1.09%-of-refund residue documented in the stripe-go-live runbook, which
 * came from letting Stripe apportion fees proportionally.) The caller sends
 * that sweep to Stripe **without** an amount, so Stripe — not our possibly
 * lagging `amountRefunded` — decides what "remaining" is.
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
	/** Send no `amount` to Stripe: refund whatever remains on the charge. */
	isFullRefund: boolean;
	/** The logical refund's key — what the reservation is held under. */
	idempotencyKey: string;
	/** The key to send to Stripe for the reservation's current attempt. */
	stripeIdempotencyKey: string;
};

/**
 * Resolves an order to a refund plan, or explains why no refund is due.
 * Read-only; shared by the cancel mutation (which reserves the plan) and the
 * action that executes it.
 *
 * `refund_failed` counts as paid: the money is still owed, and a later
 * whole-order cancel has to refund what remains rather than report "nothing
 * due" and strand the diner's balance.
 *
 * When this order's refund is already reserved on the payment, the reservation
 * fixes the plan — the key must be re-sent with the body it was first sent
 * with, and the reserved amount was decided in the transaction that
 * serialized it against every other refund on the charge.
 */
export async function planOrderRefund(
	ctx: { db: DatabaseReader },
	order: Doc<"orders">
): Promise<{
	plan: OrderRefundPlan | null;
	blocked: OrderRefundBlockReason | null;
	payment: Doc<"payments"> | null;
}> {
	// `refund_requested` is the state `updateStatus` moves a paid order into
	// when it is cancelled, so it is the expected input here — not a red flag.
	const wasPaid =
		order.paymentState === ORDER_PAYMENT_STATE.PAID ||
		order.paymentState === ORDER_PAYMENT_STATE.REFUND_REQUESTED ||
		order.paymentState === ORDER_PAYMENT_STATE.REFUND_FAILED;
	if (!wasPaid) return { plan: null, blocked: ORDER_REFUND_BLOCK_REASON.NOT_PAID, payment: null };

	const payment = await resolveSucceededPaymentForOrder(ctx, order);
	if (!payment) {
		return { plan: null, blocked: ORDER_REFUND_BLOCK_REASON.PAYMENT_UNRESOLVED, payment: null };
	}

	const idempotencyKey = buildRefundIdempotencyKey(payment._id, order._id);
	const { amount, isFullRefund } = computeOrderRefundAmount({
		orderTotalAmount: order.totalAmount,
		paymentAmount: payment.amount,
		paymentAmountRefunded: payment.amountRefunded,
		paymentSubtotalAmount: payment.subtotalAmount,
	});

	const held = payment.pendingRefund;
	if (held?.idempotencyKey === idempotencyKey) {
		return {
			plan: {
				paymentId: payment._id,
				orderId: order._id,
				amount: held.amount ?? amount,
				isFullRefund: held.amount === undefined,
				idempotencyKey,
				stripeIdempotencyKey: refundAttemptKey(held),
			},
			blocked: null,
			payment,
		};
	}

	if (amount <= 0) {
		return { plan: null, blocked: ORDER_REFUND_BLOCK_REASON.NOTHING_REFUNDABLE, payment };
	}

	return {
		plan: {
			paymentId: payment._id,
			orderId: order._id,
			amount,
			isFullRefund,
			idempotencyKey,
			stripeIdempotencyKey: idempotencyKey,
		},
		blocked: null,
		payment,
	};
}

export const resolveOrderRefundPlanInternal = internalQuery({
	args: { orderId: v.id(TABLE.ORDERS) },
	handler: async (
		ctx,
		args
	): Promise<{ plan: OrderRefundPlan | null; blocked: OrderRefundBlockReason | null }> => {
		const order = await ctx.db.get(args.orderId);
		if (!order) return { plan: null, blocked: ORDER_REFUND_BLOCK_REASON.PAYMENT_UNRESOLVED };
		const { plan, blocked } = await planOrderRefund(ctx, order);
		return { plan, blocked };
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
 * A failed Stripe call does not make the order `refund_failed` when the charge
 * is in fact fully refunded (Stripe answered `charge_already_refunded`, or the
 * recorded cumulative total already covers it): the diner has their money, and
 * flagging it would send staff to refund them twice.
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
		/** The refunded payment and its reservation's key, to release it. */
		paymentId: v.optional(v.id(TABLE.PAYMENTS)),
		idempotencyKey: v.optional(v.string()),
	},
	handler: async (ctx, args): Promise<{ paymentState: OrderPaymentState } | null> => {
		const order = await ctx.db.get(args.orderId);
		if (!order) return null;
		const payment = args.paymentId ? await ctx.db.get(args.paymentId) : null;

		const now = Date.now();
		const settled =
			args.succeeded ||
			(payment !== null && isPaymentFullyRefunded(payment)) ||
			order.paymentState === ORDER_PAYMENT_STATE.REFUNDED;
		const paymentState = settled ? ORDER_PAYMENT_STATE.REFUNDED : ORDER_PAYMENT_STATE.REFUND_FAILED;
		await ctx.db.patch(args.orderId, {
			paymentState,
			updatedAt: now,
			updatedBy: args.userId,
		});

		if (payment && args.idempotencyKey !== undefined) {
			await settleRefundClaim(ctx, payment, args.idempotencyKey, settled, now);
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
				...(args.stripeRefundId !== undefined && { stripeRefundId: args.stripeRefundId }),
				...(args.failureMessage !== undefined && { failureMessage: args.failureMessage }),
			},
			userId: args.userId,
		});

		return { paymentState };
	},
});

/**
 * Records the terminal outcome of a single-line refund on a paid order — the
 * per-line sibling of {@link recordOrderRefundOutcomeInternal} (ADR 008).
 *
 * Order-state policy, decided here so every caller agrees:
 * - A **partial** line refund leaves `order.paymentState` at `"paid"` — the
 *   order keeps cooking and flipping it to `refunded` would pull a live ticket
 *   off staff surfaces. The refund's durable record is the order item's
 *   `refundedAt`/`refundAmount`, the audit trail, and the payment's
 *   `amountRefunded`. A retried line that settles takes a `refund_failed`
 *   order back to `paid`.
 * - The **last live line** refund settles a now-cancelled order, so it follows
 *   the whole-order flow: `refund_requested` (stamped by `cancelOrderItem`) →
 *   `refunded` here.
 * - A **failed** refund flips the order to `refund_failed` in both cases —
 *   money is owed and staff must see it, cooking or not — unless the charge is
 *   in fact fully refunded, in which case the order is `refunded`.
 *
 * `payments.amountRefunded` is deliberately **not** touched here: `createRefund`
 * already recorded Stripe's cumulative total from the refund's charge, and
 * adding this line on top counted it twice whenever the `charge.refunded`
 * webhook had landed first.
 */
export const recordOrderItemRefundOutcomeInternal = internalMutation({
	args: {
		orderId: v.id(TABLE.ORDERS),
		orderItemId: v.id(TABLE.ORDER_ITEMS),
		succeeded: v.boolean(),
		amount: v.number(),
		/** Whether this refund settled the order's last live line (order cancelled). */
		isLastLiveLine: v.boolean(),
		/** The staff member who removed the line, for the audit trail. */
		userId: v.string(),
		paymentId: v.optional(v.id(TABLE.PAYMENTS)),
		/** The reservation's key, to release it. */
		idempotencyKey: v.optional(v.string()),
		stripeRefundId: v.optional(v.string()),
		failureMessage: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const order = await ctx.db.get(args.orderId);
		if (!order) return;
		const payment = args.paymentId ? await ctx.db.get(args.paymentId) : null;

		const now = Date.now();
		if (args.succeeded) {
			await ctx.db.patch(args.orderItemId, {
				refundedAt: now,
				refundAmount: args.amount,
				...(args.stripeRefundId !== undefined && { stripeRefundId: args.stripeRefundId }),
			});
		}

		const fullyRefunded = payment !== null && isPaymentFullyRefunded(payment);
		let nextState: OrderPaymentState | undefined;
		if (args.succeeded) {
			if (args.isLastLiveLine) nextState = ORDER_PAYMENT_STATE.REFUNDED;
			else if (order.paymentState === ORDER_PAYMENT_STATE.REFUND_FAILED) {
				nextState = ORDER_PAYMENT_STATE.PAID;
			}
		} else if (order.paymentState !== ORDER_PAYMENT_STATE.REFUNDED) {
			nextState = fullyRefunded ? ORDER_PAYMENT_STATE.REFUNDED : ORDER_PAYMENT_STATE.REFUND_FAILED;
		}
		if (nextState !== undefined) {
			await ctx.db.patch(args.orderId, {
				paymentState: nextState,
				updatedAt: now,
				updatedBy: args.userId,
			});
		}

		if (payment && args.idempotencyKey !== undefined) {
			await settleRefundClaim(
				ctx,
				payment,
				args.idempotencyKey,
				args.succeeded || fullyRefunded,
				now
			);
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
				...(args.stripeRefundId !== undefined && { stripeRefundId: args.stripeRefundId }),
				...(args.failureMessage !== undefined && { failureMessage: args.failureMessage }),
			},
			userId: args.userId,
		});
	},
});

/**
 * Drops a reservation whose refund will not run after all (the scheduled line
 * refund found nothing to do), so it does not block the payment until it goes
 * stale.
 */
export const releaseRefundClaimInternal = internalMutation({
	args: { paymentId: v.id(TABLE.PAYMENTS), idempotencyKey: v.string() },
	handler: async (ctx, args) => {
		const payment = await ctx.db.get(args.paymentId);
		if (payment?.pendingRefund?.idempotencyKey !== args.idempotencyKey) return;
		await ctx.db.patch(args.paymentId, { pendingRefund: undefined, updatedAt: Date.now() });
	},
});

/**
 * Records whether a failed attempt got a definitive Stripe answer, so the retry
 * knows whether it may move to a fresh key. Written by `createRefund` before it
 * rethrows, i.e. before the caller's outcome mutation marks the reservation
 * failed. An attempt that dies without reaching here stays "unknown".
 */
export const noteRefundFailureInternal = internalMutation({
	args: {
		paymentId: v.id(TABLE.PAYMENTS),
		idempotencyKey: v.string(),
		definitive: v.boolean(),
	},
	handler: async (ctx, args) => {
		const payment = await ctx.db.get(args.paymentId);
		const held = payment?.pendingRefund;
		if (!held || held.idempotencyKey !== args.idempotencyKey) return;
		await ctx.db.patch(args.paymentId, {
			pendingRefund: { ...held, lastFailureDefinitive: args.definitive },
			updatedAt: Date.now(),
		});
	},
});

export type RefundRetryTarget =
	| { kind: "line"; paymentId: Id<"payments">; orderItemId: Id<"orderItems"> }
	| { kind: "order" }
	/** Nothing left to send: the charge is already fully refunded. */
	| { kind: "settled" };

/**
 * The transactional half of `stripe.retryOrderRefund`: authorizes the manager
 * and re-arms the order's failed refund, returning what the action must re-run.
 *
 * Gated exactly like cancelling an order (`orders.updateStatus`): restaurant
 * staff access, then manager or above — a retry moves money.
 *
 * Accepts `refund_failed`, and also `refund_requested` when this order's
 * reservation has gone stale — the refund action died between reserving (or a
 * previous retry arming) and writing its outcome, which otherwise leaves the
 * order stuck in `refund_requested` forever. A live reservation is refused
 * with `ERROR_REFUND_IN_PROGRESS`.
 *
 * The failed reservation is re-armed with its own amount, on the key chosen by
 * {@link nextRefundAttempt}: the same key after an unknown outcome (a refund
 * that did land is replayed, not paid twice), a fresh one after a definitive
 * Stripe error (the old key would only replay that error).
 *
 * Only when the order has no reservation of its own (it failed before
 * reservations existed, or another order on the same legacy tab has since used
 * the slot) is a whole-order refund rebuilt from its plan, and then nothing is
 * known about earlier attempts. A sweep (no amount) is rebuilt on a fresh key —
 * safe whatever happened, because Stripe refunds only what remains. An
 * explicit amount keeps the deterministic key: if an earlier refund under it
 * landed, Stripe replays it (or rejects a changed amount) instead of a fresh
 * key paying the diner a second time. A still-cooking order's line refund
 * cannot be rebuilt at all, so it answers `ERROR_REFUND_NOT_RETRYABLE` and a
 * whole-order cancel remains the way out.
 */
export const armRefundRetryInternal = internalMutation({
	args: { orderId: v.id(TABLE.ORDERS) },
	handler: async (
		ctx,
		args
	): AsyncReturn<
		RefundRetryTarget,
		| NotAuthenticatedErrorObject
		| NotAuthorizedErrorObject
		| NotFoundErrorObject
		| ConflictErrorObject
	> => {
		const [userId, authError] = await getCurrentUserId(ctx);
		if (authError) return [null, authError];

		const order = await ctx.db.get(args.orderId);
		if (!order) return [null, new NotFoundError("Order not found").toObject()];

		const [, staffError] = await requireRestaurantStaffAccess(ctx, userId, order.restaurantId);
		if (staffError) return [null, staffError];
		const [, managerError] = await requireRestaurantManagerOrAbove(ctx, userId, order.restaurantId);
		if (managerError) return [null, managerError];

		const isFailed = order.paymentState === ORDER_PAYMENT_STATE.REFUND_FAILED;
		const isRequested = order.paymentState === ORDER_PAYMENT_STATE.REFUND_REQUESTED;
		if (!isFailed && !isRequested) {
			return [null, new ConflictError(REFUND_ERRORS.NOT_RETRYABLE).toObject()];
		}

		const payment = await resolveSucceededPaymentForOrder(ctx, order);
		if (!payment) return [null, new ConflictError("ERROR_REFUND_PAYMENT_UNRESOLVED").toObject()];

		const now = Date.now();
		const held = payment.pendingRefund;
		if (held && isRefundClaimLive(held, now)) {
			return [null, new ConflictError(REFUND_ERRORS.IN_PROGRESS).toObject()];
		}
		// `refund_requested` is only retryable as the leftover of a crashed
		// refund: this order's own reservation, stale (live was refused above).
		if (isRequested && held?.orderId !== order._id) {
			return [null, new ConflictError(REFUND_ERRORS.NOT_RETRYABLE).toObject()];
		}

		// The money is already back (e.g. the crashed refund did land and its
		// webhook recorded it): settle instead of asking Stripe again.
		if (isPaymentFullyRefunded(payment)) {
			await ctx.db.patch(order._id, {
				paymentState: ORDER_PAYMENT_STATE.REFUNDED,
				updatedAt: now,
				updatedBy: userId,
			});
			if (held?.orderId === order._id) {
				await ctx.db.patch(payment._id, { pendingRefund: undefined, updatedAt: now });
			}
			return [{ kind: "settled" }, null];
		}

		const markRequested = () =>
			ctx.db.patch(order._id, {
				paymentState: ORDER_PAYMENT_STATE.REFUND_REQUESTED,
				updatedAt: now,
				updatedBy: userId,
			});

		if (held?.orderId === order._id) {
			const {
				failedAt: _failedAt,
				lastFailureDefinitive: _lastFailureDefinitive,
				attempt: _attempt,
				...rearmed
			} = held;
			const attempt = nextRefundAttempt(held);
			await ctx.db.patch(payment._id, {
				pendingRefund: { ...rearmed, ...(attempt > 0 && { attempt }), reservedAt: now },
				updatedAt: now,
			});
			if (held.orderItemId !== undefined) {
				return [{ kind: "line", paymentId: payment._id, orderItemId: held.orderItemId }, null];
			}
			await markRequested();
			return [{ kind: "order" }, null];
		}

		if (order.status !== ORDER_STATUS.CANCELLED) {
			return [null, new ConflictError(REFUND_ERRORS.NOT_RETRYABLE).toObject()];
		}
		const { plan } = await planOrderRefund(ctx, order);
		if (!plan) return [null, new ConflictError("ERROR_REFUND_ALREADY_ISSUED").toObject()];
		await claimRefund(
			ctx,
			payment,
			{
				idempotencyKey: plan.idempotencyKey,
				orderId: order._id,
				...(plan.isFullRefund ? { attempt: 1 } : { amount: plan.amount }),
			},
			now
		);
		await markRequested();
		return [{ kind: "order" }, null];
	},
});
