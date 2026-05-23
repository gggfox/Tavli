/**
 * `ordersByHour` widget query: average paid orders per hour-of-day across the
 * window. Single-restaurant; available to any staff member.
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

const ORDERS_BY_HOUR_MAX_RANGE_DAYS = 92;

export type HourBucket = { hour: number; averagePerDay: number; total: number };

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
	handler: async function (ctx, args): AsyncReturn<HourBucket[], Errors> {
		const [restaurantIds, accessErr] = await resolveRestaurantIds(ctx, {
			scopeKind: "restaurant",
			restaurantId: args.restaurantId,
		});
		if (accessErr) return [null, accessErr];

		const [windowResult, rangeErr] = buildWindow(args.range, false, ORDERS_BY_HOUR_MAX_RANGE_DAYS);
		if (rangeErr) return [null, rangeErr];

		const restaurant = await ctx.db.get(args.restaurantId);
		const timezone = restaurant?.timezone;

		const orders = await loadOrdersInRange(ctx, restaurantIds, windowResult.current);
		const totals = new Array<number>(24).fill(0);
		for (const o of orders) {
			const t = o.paidAt ?? o.submittedAt ?? o.createdAt;
			const offsetMs = timezone ? getZoneOffsetMs(timezone, t) : 0;
			const localDate = new Date(t + offsetMs);
			const hour = localDate.getUTCHours();
			totals[hour] += 1;
		}

		const days = Math.max(
			1,
			Math.ceil((windowResult.current.to - windowResult.current.from) / (24 * 60 * 60 * 1000))
		);

		return [
			totals.map((total, hour) => ({
				hour,
				total,
				averagePerDay: total / days,
			})),
			null,
		];
	},
});
