/**
 * `activeOrders` widget query: a live operational snapshot of the restaurant
 * right now. Unlike the range-based analytics queries this deliberately ignores
 * the dashboard date window — it reports currently-open `Sessions` (seated
 * tables) and in-flight `Orders` (status submitted / preparing / ready) with
 * their combined value. Single-restaurant; available to any staff member.
 */
import { v } from "convex/values";
import { query } from "../_generated/server";
import { AsyncReturn } from "../_shared/types";
import { ORDER_STATUS, SESSION_STATUS, TABLE } from "../constants";
import { resolveRestaurantIds, type AnalyticsAccessErrors } from "./_shared";

export type ActiveOrdersResult = {
	/** Count of currently-open sessions (tables being served right now). */
	seatedTables: number;
	/** Count of orders not yet served / paid (submitted | preparing | ready). */
	activeOrderCount: number;
	/** Combined `totalAmount` of those active orders. */
	activeOrderValue: number;
};

type Errors = AnalyticsAccessErrors;

const ACTIVE_ORDER_STATUSES: ReadonlySet<string> = new Set([
	ORDER_STATUS.SUBMITTED,
	ORDER_STATUS.PREPARING,
	ORDER_STATUS.READY,
]);

export const compute = query({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
	},
	handler: async function (ctx, args): AsyncReturn<ActiveOrdersResult, Errors> {
		const [, accessErr] = await resolveRestaurantIds(ctx, {
			scopeKind: "restaurant",
			restaurantId: args.restaurantId,
		});
		if (accessErr) return [null, accessErr];

		const sessions = await ctx.db
			.query(TABLE.SESSIONS)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();
		const seatedTables = sessions.filter((s) => s.status === SESSION_STATUS.ACTIVE).length;

		const orders = await ctx.db
			.query(TABLE.ORDERS)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();

		let activeOrderCount = 0;
		let activeOrderValue = 0;
		for (const o of orders) {
			if (!ACTIVE_ORDER_STATUSES.has(o.status)) continue;
			activeOrderCount += 1;
			activeOrderValue += o.totalAmount;
		}

		return [{ seatedTables, activeOrderCount, activeOrderValue }, null];
	},
});
