/**
 * `tipsTotal` widget query: total tip amount over the window plus a daily
 * sparkline. Manager-or-above; single-restaurant.
 *
 * Two sources, because tips arrive two ways:
 * - `tipEntries` — cash / other tips keyed in by staff, already carrying a
 *   business date;
 * - `payments` — card tips. Under ADR 008 these are the primary path: each
 *   member tips at visit close-out on their own `kind: "tip"` row. Pre-pivot
 *   tab settlements folded a tip into `gratuityAmount` on the tab payment, and
 *   those count too.
 *
 * Card tips are bucketed by the restaurant-local day of `succeededAt`, which
 * can differ from a `tipEntries.businessDate` for a tip taken after the
 * business-day cutoff.
 *
 * **Historical discontinuity (ADR 008 cutover).** Before the pivot this widget
 * read `tipEntries` only, so card tips folded into a tab settlement's
 * `gratuityAmount` were never counted. They are counted now, which raises
 * pre-pivot tip totals retroactively. That is a correction, not a double
 * count — `tips.addTipEntry` only accepts `cash`/`other` sources, so a card
 * tip can never be in both places — but it does mean a number a manager
 * screenshotted last month can legitimately read higher today.
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
import type { Id } from "../_generated/dataModel";
import { tipFromPayment } from "../paymentMoneyHelpers";
import { utcMsToYmdInTimezone } from "../_util/timezone";
import {
	buildWindow,
	loadPaymentsInRange,
	resolveRestaurantIds,
	type AnalyticsCtx,
	type DashboardRange,
} from "./_shared";

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
	handler: async function (ctx, args): AsyncReturn<TipsTotalResult, Errors> {
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
		const add = (date: string, amountCents: number) => {
			if (amountCents === 0) return;
			tally.set(date, (tally.get(date) ?? 0) + amountCents);
			totalCents += amountCents;
		};

		for (const e of entries) add(e.businessDate, e.amountCents);

		for (const { date, amountCents } of await cardTips(
			ctx,
			args.restaurantId,
			windowResult.current,
			timezone
		)) {
			add(date, amountCents);
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
			const prevCardTips = await cardTips(
				ctx,
				args.restaurantId,
				windowResult.comparison,
				timezone
			);
			previousTotalCents =
				prevEntries.reduce((sum, e) => sum + e.amountCents, 0) +
				prevCardTips.reduce((sum, p) => sum + p.amountCents, 0);
		}

		const buckets = [...tally.entries()]
			.sort((a, b) => a[0].localeCompare(b[0]))
			.map(([date, amountCents]) => ({ date, amountCents }));

		return [{ totalCents, buckets, previousTotalCents }, null];
	},
});

/** Card tips (ADR 008 tip rows + legacy tab gratuities) bucketed by local day. */
async function cardTips(
	ctx: AnalyticsCtx,
	restaurantId: Id<"restaurants">,
	range: DashboardRange,
	timezone: string | undefined
): Promise<Array<{ date: string; amountCents: number }>> {
	const payments = await loadPaymentsInRange(ctx, [restaurantId], range);
	const out: Array<{ date: string; amountCents: number }> = [];
	for (const p of payments) {
		const amountCents = tipFromPayment(p);
		if (amountCents === 0) continue;
		out.push({
			date: formatBusinessDate(p.succeededAt ?? p.createdAt, timezone),
			amountCents,
		});
	}
	return out;
}

function formatBusinessDate(t: number, timezone: string | undefined): string {
	if (timezone) return utcMsToYmdInTimezone(t, timezone);
	return new Date(t).toISOString().slice(0, 10);
}
