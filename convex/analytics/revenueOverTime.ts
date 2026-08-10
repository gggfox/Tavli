/**
 * `revenueOverTime` widget query: **restaurant** revenue bucketed by day in
 * the restaurant's local timezone (or UTC if absent). Manager-or-above;
 * portfolio-capable.
 *
 * Revenue here means the food the restaurant sold — not Tavli's customer-borne
 * service fee (which lives inside `payments.amount` post-ADR 008) and not tips
 * (their own `kind: "tip"` rows). Cash orders carry no `payments` row at all
 * and are added back from `orders.totalAmount`. See
 * `convex/paymentMoneyHelpers.ts` for the rules and the legacy-row caveat.
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
import { isCashSettledOrder, restaurantRevenueFromPayment } from "../paymentMoneyHelpers";
import { utcMsToYmdInTimezone } from "../_util/timezone";
import {
	buildWindow,
	loadOrdersInRange,
	loadPaymentsInRange,
	resolveRestaurantIds,
} from "./_shared";

const REVENUE_OVER_TIME_MAX_RANGE_DAYS = 366;

export type RevenueBucket = { date: string; amount: number };

export type RevenueOverTimeResult = {
	buckets: RevenueBucket[];
	previousBuckets: RevenueBucket[] | null;
	currency: string | null;
};

type Errors =
	| NotAuthenticatedErrorObject
	| NotAuthorizedErrorObject
	| NotFoundErrorObject
	| UserInputValidationErrorObject;

export const compute = query({
	args: {
		scopeKind: v.union(v.literal("restaurant"), v.literal("portfolio")),
		restaurantId: v.optional(v.id(TABLE.RESTAURANTS)),
		range: v.object({ from: v.number(), to: v.number() }),
		compareToPrev: v.boolean(),
	},
	handler: async function (ctx, args): AsyncReturn<RevenueOverTimeResult, Errors> {
		const [restaurantIds, accessErr] = await resolveRestaurantIds(ctx, {
			scopeKind: args.scopeKind,
			restaurantId: args.restaurantId,
			requireManagerOrAbove: true,
		});
		if (accessErr) return [null, accessErr];

		const [windowResult, rangeErr] = buildWindow(
			args.range,
			args.compareToPrev,
			REVENUE_OVER_TIME_MAX_RANGE_DAYS
		);
		if (rangeErr) return [null, rangeErr];

		// Pick the first restaurant's timezone for bucketing; for portfolio scope
		// this is best-effort and we fall back to UTC.
		let timezone: string | undefined;
		let currency: string | null = null;
		if (restaurantIds.length > 0) {
			const r = await ctx.db.get(restaurantIds[0]);
			timezone = r?.timezone;
			currency = r?.currency ?? null;
		}

		const current = await bucketByDay(ctx, restaurantIds, windowResult.current, timezone);
		const previous = windowResult.comparison
			? await bucketByDay(ctx, restaurantIds, windowResult.comparison, timezone)
			: null;

		return [{ buckets: current, previousBuckets: previous, currency }, null];
	},
});

async function bucketByDay(
	ctx: Parameters<typeof loadPaymentsInRange>[0],
	restaurantIds: Parameters<typeof loadPaymentsInRange>[1],
	range: Parameters<typeof loadPaymentsInRange>[2],
	timezone: string | undefined
): Promise<RevenueBucket[]> {
	const payments = await loadPaymentsInRange(ctx, restaurantIds, range);
	const tally = new Map<string, number>();
	const addTo = (t: number, amount: number) => {
		if (amount === 0) return;
		const key = timezone
			? utcMsToYmdInTimezone(t, timezone)
			: new Date(t).toISOString().slice(0, 10);
		tally.set(key, (tally.get(key) ?? 0) + amount);
	};

	for (const p of payments) {
		addTo(p.succeededAt ?? p.createdAt, restaurantRevenueFromPayment(p));
	}

	// Cash orders are paid restaurant revenue with no `payments` row by design
	// (`markOrderPaidInPerson`), so they are added back from the order total.
	const orders = await loadOrdersInRange(ctx, restaurantIds, range);
	for (const o of orders) {
		if (!isCashSettledOrder(o)) continue;
		addTo(o.paidAt ?? o.createdAt, o.totalAmount);
	}

	return [...tally.entries()]
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([date, amount]) => ({ date, amount }));
}
