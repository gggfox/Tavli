import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { DatabaseReader, DatabaseWriter } from "./_generated/server";
import { NotFoundError, UserInputValidationError } from "./_shared/errors";
import {
	DEFAULT_PREP_STATION,
	ORDER_PAYMENT_STATE,
	PAYMENT_STATUS,
	PREP_STATION,
	type PrepStation,
	TABLE,
} from "./constants";

export type NormalizedSelectedOption = {
	optionGroupId: Id<"optionGroups">;
	optionGroupName: string;
	optionId: Id<"options">;
	optionName: string;
	priceModifier: number;
};

export const selectedOptionValidator = v.object({
	optionGroupId: v.id(TABLE.OPTION_GROUPS),
	optionGroupName: v.string(),
	optionId: v.id(TABLE.OPTIONS),
	optionName: v.string(),
	priceModifier: v.number(),
});

/**
 * `served` is terminal. Cancelling a paid order refunds the diner, and food
 * that reached the table should not be refundable from inside the app — that
 * decision belongs to a manager in the Stripe dashboard, with a reason.
 *
 * This closes an API-only hole: the dashboard already renders no Cancel button
 * on served cards (`statusConfig.ts` sets `served.next = null`, and the button
 * is gated on `hasNextAction`), so no staff-facing capability is lost.
 */
export const VALID_TRANSITIONS: Record<string, string[]> = {
	submitted: ["preparing", "cancelled"],
	preparing: ["ready", "cancelled"],
	ready: ["served", "cancelled"],
};

// Statuses the kitchen dashboard is allowed to surface. `draft` is excluded
// because drafts are pre-submission state and never belong on the dashboard.
export const DASHBOARD_STATUS_VALIDATOR = v.union(
	v.literal("submitted"),
	v.literal("preparing"),
	v.literal("ready"),
	v.literal("served"),
	v.literal("cancelled")
);

/**
 * Validator for the `prepStation` literal used in mutation/query args.
 * Matches `PREP_STATION` constant; keep them in sync.
 */
export const PREP_STATION_VALIDATOR = v.union(
	v.literal(PREP_STATION.KITCHEN),
	v.literal(PREP_STATION.BAR)
);

/**
 * Resolve the prepStation for a menu item, falling back to the default for
 * pre-backfill rows that still have `prepStation === undefined`. Centralizes
 * the read-side fallback so call sites do not have to repeat it.
 */
export function resolvePrepStation(
	menuItem: { prepStation?: PrepStation } | null | undefined
): PrepStation {
	return menuItem?.prepStation ?? DEFAULT_PREP_STATION;
}

/** A line that has been 86'd is no longer prepared, billed, or counted. */
export function isCancelledOrderItem(item: { cancelledAt?: number }): boolean {
	return item.cancelledAt !== undefined;
}

/**
 * Compute the set of prep stations that are "applicable" to an order — i.e.
 * the distinct stations across its non-cancelled order items. Used by
 * `markStationReady` to decide when to flip `Order.status` to "ready"
 * (when every applicable station has a non-null `*ReadyAt`).
 *
 * Cancelled lines drop out so a station whose every item was 86'd stops
 * blocking the order: the remaining stations alone can complete it.
 *
 * Items whose menuItem can no longer be loaded (soft-deleted) fall back to
 * the default station so they never silently block the order from completing.
 */
export function getApplicableStations(
	orderItems: ReadonlyArray<{ menuItemId: Id<"menuItems">; cancelledAt?: number }>,
	menuItemStationMap: ReadonlyMap<Id<"menuItems"> | string, PrepStation>
): Set<PrepStation> {
	const stations = new Set<PrepStation>();
	for (const item of orderItems) {
		if (isCancelledOrderItem(item)) continue;
		stations.add(menuItemStationMap.get(item.menuItemId) ?? DEFAULT_PREP_STATION);
	}
	return stations;
}

/** Rejects zero, negative, fractional, NaN, and Infinity quantities. */
export function assertPositiveIntegerQuantity(quantity: number): void {
	if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity < 1) {
		throw new UserInputValidationError({
			fields: [{ field: "quantity", message: "Must be a positive whole number" }],
		});
	}
}

export async function recalculateTotal(ctx: { db: DatabaseWriter }, orderId: Id<"orders">) {
	const items = await ctx.db
		.query(TABLE.ORDER_ITEMS)
		.withIndex("by_order", (q) => q.eq("orderId", orderId))
		.collect();

	// 86'd lines stay on the order but leave the bill, so this is also the
	// recompute `cancelOrderItem` runs. Draft orders never carry cancelled
	// items, so the draft callers are unaffected.
	const total = items.reduce(
		(sum, item) => (isCancelledOrderItem(item) ? sum : sum + item.lineTotal),
		0
	);

	await ctx.db.patch(orderId, { totalAmount: total, updatedAt: Date.now() });
}

export async function normalizeSelectedOptions(
	ctx: { db: DatabaseReader },
	restaurantId: Id<"restaurants">,
	selectedOptions: Array<{
		optionGroupId: Id<"optionGroups">;
		optionGroupName: string;
		optionId: Id<"options">;
		optionName: string;
		priceModifier: number;
	}>
): Promise<NormalizedSelectedOption[]> {
	const normalized: NormalizedSelectedOption[] = [];
	for (const selectedOption of selectedOptions) {
		const optionGroup = await ctx.db.get(selectedOption.optionGroupId);
		if (!optionGroup || optionGroup.restaurantId !== restaurantId) {
			throw new NotFoundError("Option group not found");
		}

		const option = await ctx.db.get(selectedOption.optionId);
		if (
			!option ||
			option.restaurantId !== restaurantId ||
			option.optionGroupId !== selectedOption.optionGroupId
		) {
			throw new NotFoundError("Option not found");
		}

		normalized.push({
			optionGroupId: selectedOption.optionGroupId,
			optionGroupName: optionGroup.name,
			optionId: selectedOption.optionId,
			optionName: option.name,
			priceModifier: option.priceModifier,
		});
	}

	return normalized;
}

/**
 * Loads `translations` maps for every menu item / option / option group
 * referenced by the given order items so the kitchen and payments
 * dashboards can localize names without depending on the snapshot being
 * perfect at order-placement time. The snapshot (`menuItemName`,
 * `optionName`, `optionGroupName`) remains the canonical fallback when the
 * source row has been deleted or has no translation.
 *
 * Batches `db.get` calls so the query is O(distinct entities) rather than
 * O(items). Returns three lookup maps; callers apply them when shaping the
 * per-item / per-option output.
 */
export async function loadOrderItemTranslations(
	ctx: { db: DatabaseReader },
	allItems: Array<{
		menuItemId: Id<"menuItems">;
		selectedOptions: Array<{
			optionGroupId: Id<"optionGroups">;
			optionId: Id<"options">;
		}>;
	}>
) {
	const menuItemIds = Array.from(new Set(allItems.map((i) => i.menuItemId)));
	const optionIds = Array.from(
		new Set(allItems.flatMap((i) => i.selectedOptions.map((o) => o.optionId)))
	);
	const optionGroupIds = Array.from(
		new Set(allItems.flatMap((i) => i.selectedOptions.map((o) => o.optionGroupId)))
	);

	const [menuItemDocs, optionDocs, optionGroupDocs] = await Promise.all([
		Promise.all(menuItemIds.map((id) => ctx.db.get(id))),
		Promise.all(optionIds.map((id) => ctx.db.get(id))),
		Promise.all(optionGroupIds.map((id) => ctx.db.get(id))),
	]);

	const menuItemTranslations = new Map<
		string,
		Record<string, { name?: string; description?: string }> | undefined
	>();
	for (const doc of menuItemDocs) {
		if (doc) menuItemTranslations.set(doc._id, doc.translations);
	}

	const optionTranslations = new Map<string, Record<string, { name?: string }> | undefined>();
	for (const doc of optionDocs) {
		if (doc) optionTranslations.set(doc._id, doc.translations);
	}

	const optionGroupTranslations = new Map<string, Record<string, { name?: string }> | undefined>();
	for (const doc of optionGroupDocs) {
		if (doc) optionGroupTranslations.set(doc._id, doc.translations);
	}

	return { menuItemTranslations, optionTranslations, optionGroupTranslations };
}

export async function invalidateActivePayment(
	ctx: { db: DatabaseWriter },
	order: {
		_id: Id<"orders">;
		activePaymentId?: Id<"payments">;
		paymentState?: string;
		status: string;
	}
) {
	if (!order.activePaymentId || order.status !== "draft") {
		return;
	}

	const payment = await ctx.db.get(order.activePaymentId);
	if (
		payment &&
		payment.status !== PAYMENT_STATUS.SUCCEEDED &&
		payment.status !== PAYMENT_STATUS.SUPERSEDED &&
		payment.status !== PAYMENT_STATUS.CANCELLED
	) {
		await ctx.db.patch(order.activePaymentId, {
			status: PAYMENT_STATUS.SUPERSEDED,
			updatedAt: Date.now(),
		});
	}

	await ctx.db.patch(order._id, {
		paymentState: ORDER_PAYMENT_STATE.UNPAID,
		updatedAt: Date.now(),
	});
}
