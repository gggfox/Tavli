import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { NotFoundError } from "./_shared/errors";
import { ORDER_PAYMENT_STATE, PAYMENT_STATUS, TABLE } from "./constants";

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

export const VALID_TRANSITIONS: Record<string, string[]> = {
	submitted: ["preparing", "cancelled"],
	preparing: ["ready", "cancelled"],
	ready: ["served", "cancelled"],
	served: ["cancelled"],
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

export async function recalculateTotal(
	ctx: { db: { query: any; patch: any; get: any } },
	orderId: string
) {
	const items = await ctx.db
		.query(TABLE.ORDER_ITEMS)
		.withIndex("by_order", (q: any) => q.eq("orderId", orderId))
		.collect();

	const total = items.reduce((sum: number, item: any) => sum + item.lineTotal, 0);

	await ctx.db.patch(orderId, { totalAmount: total, updatedAt: Date.now() });
}

export async function normalizeSelectedOptions(
	ctx: { db: { get: any } },
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
	ctx: { db: { get: (id: Id<"menuItems"> | Id<"options"> | Id<"optionGroups">) => Promise<any> } },
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

	const menuItemTranslations = new Map<string, Record<string, { name?: string; description?: string }> | undefined>();
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
	ctx: { db: { get: any; patch: any } },
	order: {
		_id: string;
		activePaymentId?: string;
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
