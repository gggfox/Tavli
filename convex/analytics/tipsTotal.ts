/**
 * `tipsTotal` widget query: total tip amount over the window plus a daily
 * sparkline. Sources `tipPools` (totalAmountCents) and `tipEntries` (cash and
 * other entries). Manager-or-above; single-restaurant.
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
import {
	utcMsToYmdInTimezone,
} from "../_util/timezone";
import { buildWindow, resolveRestaurantIds } from "./_shared";

const TIPS_TOTAL_MAX_RANGE_DAYS = 366;

export type TipsBucket = { date: string; amountCents: number };

export type TipsTotalResult = {
	totalCents: number;
	buckets: TipsBucket[];
	previousTotalCents: number | null;
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
		compareToPrev: v.boolean(),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<TipsTotalResult, Errors> {
		const [, accessErr] = await resolveRestaurantIds(ctx, {
			scopeKind: "restaurant",
			restaurantId: args.restaurantId,
			requireManagerOrAbove: true,
		});
		if (accessErr) return [null, accessErr];

		const [windowResult, rangeErr] = buildWindow(
			args.range,
			args.compareToPrev,
			TIPS_TOTAL_MAX_RANGE_DAYS
		);
		if (rangeErr) return [null, rangeErr];

		const restaurant = await ctx.db.get(args.restaurantId);
		const timezone = restaurant?.timezone;
		const fromYmd = formatBusinessDate(windowResult.current.from, timezone);
		const toYmd = formatBusinessDate(windowResult.current.to - 1, timezone);

		const entries = await ctx.db
			.query(TABLE.TIP_ENTRIES)
			.withIndex("by_restaurant_date", (q) =>
				q
					.eq("restaurantId", args.restaurantId)
					.gte("businessDate", fromYmd)
					.lte("businessDate", toYmd)
			)
			.collect();

		const tally = new Map<string, number>();
		let totalCents = 0;
		for (const e of entries) {
			tally.set(e.businessDate, (tally.get(e.businessDate) ?? 0) + e.amountCents);
			totalCents += e.amountCents;
		}

		let previousTotalCents: number | null = null;
		if (windowResult.comparison) {
			const prevFromYmd = formatBusinessDate(windowResult.comparison.from, timezone);
			const prevToYmd = formatBusinessDate(windowResult.comparison.to - 1, timezone);
			const prevEntries = await ctx.db
				.query(TABLE.TIP_ENTRIES)
				.withIndex("by_restaurant_date", (q) =>
					q
						.eq("restaurantId", args.restaurantId)
						.gte("businessDate", prevFromYmd)
						.lte("businessDate", prevToYmd)
				)
				.collect();
			previousTotalCents = prevEntries.reduce((sum, e) => sum + e.amountCents, 0);
		}

		const buckets = [...tally.entries()]
			.sort((a, b) => a[0].localeCompare(b[0]))
			.map(([date, amountCents]) => ({ date, amountCents }));

		return [{ totalCents, buckets, previousTotalCents }, null];
	},
});

function formatBusinessDate(t: number, timezone: string | undefined): string {
	if (timezone) return utcMsToYmdInTimezone(t, timezone);
	return new Date(t).toISOString().slice(0, 10);
}
