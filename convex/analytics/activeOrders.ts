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

const ACTIVE_ORDER_STATUSES = [
	ORDER_STATUS.SUBMITTED,
	ORDER_STATUS.PREPARING,
	ORDER_STATUS.READY,
] as const;

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

		// Indexed reads only — this widget polls live, so it must not scan the
		// restaurant's full (unbounded) session/order history.
		const activeSessions = await ctx.db
			.query(TABLE.SESSIONS)
			.withIndex("by_restaurant_status", (q) =>
				q.eq("restaurantId", args.restaurantId).eq("status", SESSION_STATUS.ACTIVE)
			)
			.collect();
		const seatedTables = activeSessions.length;

		const ordersPerStatus = await Promise.all(
			ACTIVE_ORDER_STATUSES.map((status) =>
				ctx.db
					.query(TABLE.ORDERS)
					.withIndex("by_restaurant_status", (q) =>
						q.eq("restaurantId", args.restaurantId).eq("status", status)
					)
					.collect()
			)
		);

		let activeOrderCount = 0;
		let activeOrderValue = 0;
		for (const o of ordersPerStatus.flat()) {
			activeOrderCount += 1;
			activeOrderValue += o.totalAmount;
		}

		return [{ seatedTables, activeOrderCount, activeOrderValue }, null];
	},
});
