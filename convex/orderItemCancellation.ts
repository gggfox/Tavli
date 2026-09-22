/**
 * Shared core of "remove a line from an order" (ADR 008, ADR 013).
 *
 * `orders.cancelOrderItem` is the only caller: staff remove one line because
 * the kitchen is out of an ingredient or the bar out of a bottle. Factored into
 * its own module so the refund-scheduling logic exists exactly once and so the
 * caller keeps ownership of authorization, payment-state guards, and payment
 * resolution; this core owns the stamps, totals, order-status fallout, and the
 * scheduled refund.
 *
 * When a dish is unavailable **after** payment the money simply comes back —
 * there is no in-app swap to negotiate. Anything the restaurant wants to offer
 * instead is settled with the diner in person (ADR 013).
 */

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { appendAuditEvent } from "./_util/audit";
import {
	AUDIT_EVENT,
	ORDER_PAYMENT_STATE,
	PREP_STATION,
	type PrepStation,
	TABLE,
} from "./constants";
import { getApplicableStations, recalculateTotal, resolvePrepStation } from "./orderHelpers";

/**
 * The paid-line-removal core behind `orders.cancelOrderItem`:
 *
 * 1. Stamp the line (`cancelledAt`/`cancelledBy`) and recompute the order
 *    total (the removed line leaves the bill).
 * 2. If that was the order's **last live line**, cancel the whole order
 *    (paid orders enter `refund_requested`; `stripe.refundOrderItem` then
 *    refunds the payment's entire remaining balance) and audit the status
 *    change.
 * 3. Otherwise, if the order was `preparing` and every remaining station has
 *    already stamped ready, flip the order to `ready` so it cannot hang.
 * 4. Schedule the line refund when the order was paid (`paidPaymentId` set).
 *
 * Callers must have validated everything else already: staff access, line
 * liveness, order status, payment state, and (for paid orders) that
 * `paidPaymentId` is a succeeded fee-inclusive ADR 008 payment.
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

	// Removing the last line of the one station that had not stamped yet leaves
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

	// Paid order keeps cooking; only the removed line's money goes back.
	await scheduleLineRefund();
}
