/**
 * `busyTimesHeatmap` widget query: order count grouped by day-of-week (0=Sun)
 * and hour-of-day in the restaurant's local timezone. Single-restaurant;
 * available to any staff member.
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
import { TABLE } from "../constants";
import { getZoneOffsetMs } from "../_util/timezone";
import { buildWindow, loadOrdersInRange, resolveRestaurantIds } from "./_shared";

const BUSY_TIMES_MAX_RANGE_DAYS = 366;

export type HeatmapCell = { dayOfWeek: number; hour: number; count: number };

type Errors =
	| NotAuthenticatedErrorObject
	| NotAuthorizedErrorObject
	| NotFoundErrorObject
	| UserInputValidationErrorObject;

export const compute = query({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		range: v.object({ from: v.number(), to: v.number() }),
	},
	handler: async function (ctx, args): AsyncReturn<HeatmapCell[], Errors> {
		const [restaurantIds, accessErr] = await resolveRestaurantIds(ctx, {
			scopeKind: "restaurant",
			restaurantId: args.restaurantId,
		});
		if (accessErr) return [null, accessErr];

		const [windowResult, rangeErr] = buildWindow(args.range, false, BUSY_TIMES_MAX_RANGE_DAYS);
		if (rangeErr) return [null, rangeErr];

		const restaurant = await ctx.db.get(args.restaurantId);
		const timezone = restaurant?.timezone;

		const orders = await loadOrdersInRange(ctx, restaurantIds, windowResult.current);

		const counts = new Map<string, number>();
		for (const o of orders) {
			const t = o.paidAt ?? o.submittedAt ?? o.createdAt;
			const offsetMs = timezone ? getZoneOffsetMs(timezone, t) : 0;
			const localDate = new Date(t + offsetMs);
			const dayOfWeek = localDate.getUTCDay();
			const hour = localDate.getUTCHours();
			const key = `${dayOfWeek}:${hour}`;
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}

		const cells: HeatmapCell[] = [];
		for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek += 1) {
			for (let hour = 0; hour < 24; hour += 1) {
				cells.push({
					dayOfWeek,
					hour,
					count: counts.get(`${dayOfWeek}:${hour}`) ?? 0,
				});
			}
		}
		return [cells, null];
	},
});
