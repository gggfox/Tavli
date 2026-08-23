/**
 * Shared core of "86 one line of an order" (ADR 008, TAVLI-71 Phase 3A).
 *
 * Two callers perform the exact same cancellation once their own guards pass:
 * - `orders.cancelOrderItem` — staff 86 (kitchen out of an ingredient).
 * - `substitutions.declineProposal` — the diner turned down the proposed
 *   replacement, so the line is 86'd with the **diner** as the audit actor.
 *
 * Factored here so the refund-scheduling logic exists exactly once. The caller
 * owns authorization, payment-state guards, and payment resolution; this core
 * owns the stamps, totals, order-status fallout, and the scheduled refund.
 */

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { appendAuditEvent } from "./_util/audit";
import {
	AUDIT_EVENT,
	ORDER_PAYMENT_STATE,
	PAYMENT_STATUS,
	PREP_STATION,
	type PrepStation,
	SUBSTITUTION_PROPOSAL_STATUS,
	TABLE,
} from "./constants";
import { getApplicableStations, recalculateTotal, resolvePrepStation } from "./orderHelpers";

/**
 * Cancels pending substitution proposals attached to an order (optionally
 * narrowed to one line) and retires any in-flight supplemental delta payment
 * rows they carry.
 *
 * Called when the underlying line (or whole order) is cancelled out from under
 * a proposal: the kitchen 86'ing a line with a pending proposal withdraws the
 * proposal implicitly (86 is the stronger signal — rejecting the 86 and making
 * staff hunt down the proposal first would just add a step), and a whole-order
 * cancel withdraws every pending proposal on the order.
 *
 * The supplemental payment row is only retired **in our records** — mutations
 * never call Stripe. If the diner's delta charge lands at Stripe anyway (the
 * webhook race), `substitutions.confirmSubstitutionPayment` sees the proposal
 * is no longer pending and schedules a full refund of that payment.
 */
export async function cancelPendingProposalsForOrder(
	ctx: MutationCtx,
	args: {
		orderId: Id<"orders">;
		/** When set, only proposals for this line are cancelled. */
		orderItemId?: Id<"orderItems">;
		actorUserId: string;
		reason: "line_cancelled" | "order_cancelled";
	}
): Promise<void> {
	const proposals = await ctx.db
		.query(TABLE.SUBSTITUTION_PROPOSALS)
		.withIndex("by_order", (q) => q.eq("orderId", args.orderId))
		.collect();

	const now = Date.now();
	for (const proposal of proposals) {
		if (proposal.status !== SUBSTITUTION_PROPOSAL_STATUS.PENDING) continue;
		if (args.orderItemId !== undefined && proposal.orderItemId !== args.orderItemId) continue;

		await ctx.db.patch(proposal._id, {
			status: SUBSTITUTION_PROPOSAL_STATUS.CANCELLED,
			updatedAt: now,
		});
		await retirePendingSupplementalPayment(ctx, proposal);

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.SUBSTITUTION_PROPOSALS,
			aggregateId: proposal._id,
			eventType: AUDIT_EVENT.SUBSTITUTION_CANCELLED,
			restaurantId: proposal.restaurantId,
			payload: {
				restaurantId: proposal.restaurantId,
				orderId: proposal.orderId,
				orderItemId: proposal.orderItemId,
				proposedMenuItemId: proposal.proposedMenuItemId,
				reason: args.reason,
			},
			userId: args.actorUserId,
		});
	}
}

/**
 * Marks a proposal's pending/processing supplemental delta payment row
 * `cancelled` so it can never be mistaken for live money. See
 * {@link cancelPendingProposalsForOrder} for the Stripe-side race note.
 */
export async function retirePendingSupplementalPayment(
	ctx: MutationCtx,
	proposal: Doc<"substitutionProposals">
): Promise<void> {
	if (!proposal.supplementalPaymentId) return;
	const payment = await ctx.db.get(proposal.supplementalPaymentId);
	if (
		payment &&
		(payment.status === PAYMENT_STATUS.PENDING || payment.status === PAYMENT_STATUS.PROCESSING)
	) {
		await ctx.db.patch(payment._id, {
			status: PAYMENT_STATUS.CANCELLED,
			updatedAt: Date.now(),
		});
	}
}

/**
 * The paid-line-cancellation core shared by `orders.cancelOrderItem` and
 * `substitutions.declineProposal`. Behavior is exactly what `cancelOrderItem`
 * shipped in Phase 1/2:
 *
 * 1. Stamp the line (`cancelledAt`/`cancelledBy`) and recompute the order
 *    total (the 86'd line leaves the bill).
 * 2. If that was the order's **last live line**, cancel the whole order
 *    (paid orders enter `refund_requested`; `stripe.refundOrderItem` then
 *    refunds the payment's entire remaining balance) and audit the status
 *    change.
 * 3. Otherwise, if the order was `preparing` and every remaining station has
 *    already stamped ready, flip the order to `ready` so it cannot hang.
 * 4. Schedule the line refund when the order was paid (`paidPaymentId` set).
 *
 * Any pending substitution proposal on the line is auto-cancelled first (see
 * {@link cancelPendingProposalsForOrder}) — a dead line cannot keep a live
 * offer on the diner's device.
 *
 * Callers must have validated everything else already: staff access or session
 * membership, line liveness, order status, payment state, and (for paid
 * orders) that `paidPaymentId` is a succeeded fee-inclusive ADR 008 payment.
 */
export async function executeOrderItemCancellation(
	ctx: MutationCtx,
	args: {
		item: Doc<"orderItems">;
		order: Doc<"orders">;
		actorUserId: string;
		/** Succeeded fee-inclusive payment to refund from; null when unpaid. */
		paidPaymentId: Id<"payments"> | null;
	}
): Promise<void> {
	const { item, order, actorUserId, paidPaymentId } = args;
	const isPaid = paidPaymentId !== null;

	// A dead line cannot keep a live offer on the diner's device. Declining a
	// proposal flips it to "declined" before calling this core, so only truly
	// pending proposals (staff 86 racing a proposal) are swept here.
	await cancelPendingProposalsForOrder(ctx, {
		orderId: item.orderId,
		orderItemId: item._id,
		actorUserId,
		reason: "line_cancelled",
	});

	const now = Date.now();
	await ctx.db.patch(item._id, { cancelledAt: now, cancelledBy: actorUserId });
	await recalculateTotal(ctx, item.orderId);

	const scheduleLineRefund = async () => {
		if (paidPaymentId === null) return;
		await ctx.scheduler.runAfter(0, internal.stripe.refundOrderItem, {
			orderId: item.orderId,
			orderItemId: item._id,
			paymentId: paidPaymentId,
		});
	};

	const remainingItems = (
		await ctx.db
			.query(TABLE.ORDER_ITEMS)
			.withIndex("by_order", (q) => q.eq("orderId", item.orderId))
			.collect()
	).filter((it) => it.cancelledAt === undefined);

	if (remainingItems.length === 0) {
		await ctx.db.patch(item.orderId, {
			status: "cancelled",
			// The last live line of a paid order settles like a whole-order
			// cancel: refund_requested now, `refundOrderItem` refunds the entire
			// remaining balance and flips it to refunded.
			...(isPaid && { paymentState: ORDER_PAYMENT_STATE.REFUND_REQUESTED }),
			updatedAt: now,
			updatedBy: actorUserId,
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.ORDERS,
			aggregateId: item.orderId,
			eventType: AUDIT_EVENT.ORDER_STATUS_CHANGED,
			restaurantId: order.restaurantId,
			payload: {
				restaurantId: order.restaurantId,
				fromStatus: order.status,
				toStatus: "cancelled",
				refundEligible: isPaid,
				totalAmount: 0,
			},
			userId: actorUserId,
		});

		await scheduleLineRefund();
		return;
	}

	// 86'ing the last line of the one station that had not stamped yet leaves
	// nobody to flip the order — the other stations are already done. Without
	// this the order would sit in "preparing" forever.
	if (order.status === "preparing") {
		const menuItemIds = Array.from(new Set(remainingItems.map((it) => it.menuItemId)));
		const menuItemDocs = await Promise.all(menuItemIds.map((id) => ctx.db.get(id)));
		const menuItemStationMap = new Map<string, PrepStation>();
		for (const doc of menuItemDocs) {
			if (doc) menuItemStationMap.set(doc._id, resolvePrepStation(doc));
		}

		const applicable = getApplicableStations(remainingItems, menuItemStationMap);
		const everyStationDone = Array.from(applicable).every((station) =>
			station === PREP_STATION.KITCHEN
				? order.kitchenReadyAt !== undefined
				: order.barReadyAt !== undefined
		);

		if (everyStationDone) {
			await ctx.db.patch(item.orderId, {
				status: "ready",
				updatedAt: now,
				updatedBy: actorUserId,
			});
		}
	}

	// Paid order keeps cooking; only the 86'd line's money goes back.
	await scheduleLineRefund();
}
