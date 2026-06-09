/**
 * `itemsByCategory` widget query: share of sales **revenue** per
 * `MenuCategory` within the window, for a category-proportion donut.
 *
 * The `MenuCategory` is read **live** from each `OrderItem`'s source
 * `MenuItem` (`menuItems.categoryId`) — `OrderItem` does not snapshot the
 * category, mirroring how `prepStation` is read live (see ADR 005). Lookups are
 * cached per menu item / category so a busy window doesn't re-fetch.
 *
 * Single-restaurant; available to any staff member (mirrors `topMenuItems`).
 */
import { v } from "convex/values";
import { query } from "../_generated/server";
import { AsyncReturn } from "../_shared/types";
import { UserInputValidationErrorObject } from "../_shared/errors";
import { TABLE } from "../constants";
import type { Id } from "../_generated/dataModel";
import {
	buildWindow,
	loadOrderItemsInRange,
	resolveRestaurantIds,
	type AnalyticsAccessErrors,
} from "./_shared";

const ITEMS_BY_CATEGORY_MAX_RANGE_DAYS = 92;

export type CategoryRevenueRow = {
	categoryId: string;
	categoryName: string;
	revenue: number;
};

type Errors = AnalyticsAccessErrors | UserInputValidationErrorObject;

export const compute = query({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		range: v.object({ from: v.number(), to: v.number() }),
	},
	handler: async function (ctx, args): AsyncReturn<CategoryRevenueRow[], Errors> {
		const [restaurantIds, accessErr] = await resolveRestaurantIds(ctx, {
			scopeKind: "restaurant",
			restaurantId: args.restaurantId,
		});
		if (accessErr) return [null, accessErr];

		const [windowResult, rangeErr] = buildWindow(
			args.range,
			false,
			ITEMS_BY_CATEGORY_MAX_RANGE_DAYS
		);
		if (rangeErr) return [null, rangeErr];

		const items = await loadOrderItemsInRange(ctx, restaurantIds, windowResult.current);

		// Cache the live menu-item -> category lookup and the category names.
		const menuItemCategory = new Map<string, Id<"menuCategories"> | null>();
		const categoryRevenue = new Map<string, number>();
		const categoryNames = new Map<string, string>();

		for (const item of items) {
			let categoryId = menuItemCategory.get(item.menuItemId);
			if (categoryId === undefined) {
				const menuItem = await ctx.db.get(item.menuItemId);
				categoryId = menuItem?.categoryId ?? null;
				menuItemCategory.set(item.menuItemId, categoryId);
			}
			if (!categoryId) continue;

			const key = categoryId as string;
			categoryRevenue.set(key, (categoryRevenue.get(key) ?? 0) + item.lineTotal);
			if (!categoryNames.has(key)) {
				const category = await ctx.db.get(categoryId);
				categoryNames.set(key, category?.name ?? "—");
			}
		}

		const rows = [...categoryRevenue.entries()]
			.map(([categoryId, revenue]) => ({
				categoryId,
				categoryName: categoryNames.get(categoryId) ?? "—",
				revenue,
			}))
			.sort((a, b) => b.revenue - a.revenue);

		return [rows, null];
	},
});
