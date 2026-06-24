/**
 * `topMenuItems` widget query: top N menu items by quantity sold within the
 * window (only items from non-cancelled orders count).
 *
 * Single-restaurant only — comparing top items across restaurants is
 * meaningless. Available to any staff member.
 */
import { v } from "convex/values";
import { query } from "../_generated/server";
import { AsyncReturn } from "../_shared/types";
import {
	NotAuthenticatedErrorObject,
	NotAuthorizedErrorObject,
	NotFoundErrorObject,
	UserInputValidationErrorObject,
} from "../_shared/errors";
import { ORDER_STATUS, TABLE } from "../constants";
import { buildWindow, loadOrdersInRange, resolveRestaurantIds } from "./_shared";

const TOP_MENU_ITEMS_MAX_RANGE_DAYS = 366;

export type TopMenuItemRow = {
	menuItemId: string;
	menuItemName: string;
	quantity: number;
	revenue: number;
};

type Errors =
	| NotAuthenticatedErrorObject
	| NotAuthorizedErrorObject
	| NotFoundErrorObject
	| UserInputValidationErrorObject;

export const compute = query({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		range: v.object({ from: v.number(), to: v.number() }),
		limit: v.number(),
	},
	handler: async function (ctx, args): AsyncReturn<TopMenuItemRow[], Errors> {
		const [restaurantIds, accessErr] = await resolveRestaurantIds(ctx, {
			scopeKind: "restaurant",
			restaurantId: args.restaurantId,
		});
		if (accessErr) return [null, accessErr];

		const [windowResult, rangeErr] = buildWindow(args.range, false, TOP_MENU_ITEMS_MAX_RANGE_DAYS);
		if (rangeErr) return [null, rangeErr];

		const orders = await loadOrdersInRange(ctx, restaurantIds, windowResult.current);
		const eligibleOrderIds = new Set(
			orders.filter((o) => o.status !== ORDER_STATUS.CANCELLED).map((o) => o._id)
		);

		const tally = new Map<
			string,
			{ menuItemId: string; menuItemName: string; quantity: number; revenue: number }
		>();
		for (const orderId of eligibleOrderIds) {
			const items = await ctx.db
				.query(TABLE.ORDER_ITEMS)
				.withIndex("by_order", (q) => q.eq("orderId", orderId))
				.collect();
			for (const item of items) {
				const existing = tally.get(item.menuItemId) ?? {
					menuItemId: item.menuItemId,
					menuItemName: item.menuItemName,
					quantity: 0,
					revenue: 0,
				};
				existing.quantity += item.quantity;
				existing.revenue += item.lineTotal;
				tally.set(item.menuItemId, existing);
			}
		}

		const limit = Math.max(1, Math.min(50, Math.floor(args.limit)));
		const sorted = [...tally.values()]
			.sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue)
			.slice(0, limit);

		return [sorted, null];
	},
});
