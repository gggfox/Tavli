/**
 * `tableOccupancy` widget query: average number of seated tables per
 * hour-of-day across the window. Single-restaurant; available to any staff.
 *
 * Algorithm: for each session overlapping the window, increment hour buckets
 * for every full or partial hour the session was open. We then divide each
 * bucket by the number of days in the window to get an average.
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
import { buildWindow, loadSessionsOverlapping, resolveRestaurantIds } from "./_shared";

const TABLE_OCCUPANCY_MAX_RANGE_DAYS = 366;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type OccupancyBucket = { hour: number; averageTables: number };

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
	handler: async function (ctx, args): AsyncReturn<OccupancyBucket[], Errors> {
		const [restaurantIds, accessErr] = await resolveRestaurantIds(ctx, {
			scopeKind: "restaurant",
			restaurantId: args.restaurantId,
		});
		if (accessErr) return [null, accessErr];

		const [windowResult, rangeErr] = buildWindow(args.range, false, TABLE_OCCUPANCY_MAX_RANGE_DAYS);
		if (rangeErr) return [null, rangeErr];

		const sessions = await loadSessionsOverlapping(ctx, restaurantIds, windowResult.current);

		const restaurant = await ctx.db.get(args.restaurantId);
		const timezone = restaurant?.timezone;

		const totalsByHour = new Array<number>(24).fill(0);
		for (const s of sessions) {
			const start = Math.max(s.startedAt, windowResult.current.from);
			const end = Math.min(s.closedAt ?? Date.now(), windowResult.current.to);
			if (end <= start) continue;
			const offsetMs = timezone ? getZoneOffsetMs(timezone, start) : 0;
			let cursor = start;
			while (cursor < end) {
				const localHour = new Date(cursor + offsetMs).getUTCHours();
				const nextHourBoundary = Math.floor((cursor + HOUR_MS) / HOUR_MS) * HOUR_MS;
				const sliceEnd = Math.min(nextHourBoundary, end);
				const sliceMs = sliceEnd - cursor;
				totalsByHour[localHour] += sliceMs / HOUR_MS;
				cursor = sliceEnd;
			}
		}

		const days = Math.max(
			1,
			Math.ceil((windowResult.current.to - windowResult.current.from) / DAY_MS)
		);

		return [
			totalsByHour.map((tableHours, hour) => ({
				hour,
				averageTables: tableHours / days,
			})),
			null,
		];
	},
});
