/**
 * `numberWithDelta` widget query: a single big number with optional delta vs
 * the previous equivalent period.
 *
 * Supported metrics:
 * - `reservations.count`     — count of reservations starting in window (any status)
 * - `reservations.confirmed` — count where status = confirmed | seated | completed
 * - `orders.count`           — paid orders by `paidAt`
 * - `payments.revenueTotal`  — sum of payments.amount where status = succeeded
 * - `covers`                 — sum of `partySize` of seated/completed reservations
 *
 * Money metrics (`payments.revenueTotal`) require manager-or-above; counts are
 * available to any staff member with restaurant access.
 */
import { v } from "convex/values";
import { query } from "../_generated/server";
import { AsyncReturn } from "../_shared/types";
import { UserInputValidationErrorObject } from "../_shared/errors";
import { PAYMENT_STATUS, RESERVATION_STATUS, TABLE } from "../constants";
import type { Id } from "../_generated/dataModel";
import {
	buildWindow,
	loadOrdersInRange,
	loadPaymentsInRange,
	loadReservationsInRange,
	resolveRestaurantIds,
	type AnalyticsAccessErrors,
	type AnalyticsCtx,
	type DashboardRange,
} from "./_shared";

const NUMBER_WITH_DELTA_MAX_RANGE_DAYS = 366;

const metricValidator = v.union(
	v.literal("reservations.count"),
	v.literal("reservations.confirmed"),
	v.literal("orders.count"),
	v.literal("payments.revenueTotal"),
	v.literal("covers")
);

type Metric = typeof metricValidator.type;

const MONEY_METRICS: ReadonlySet<Metric> = new Set(["payments.revenueTotal"]);

export type NumberWithDeltaResult = {
	current: number;
	previous: number | null;
	deltaAbs: number | null;
	deltaPct: number | null;
};

type Errors =
	| AnalyticsAccessErrors
	| UserInputValidationErrorObject;

export const compute = query({
	args: {
		scopeKind: v.union(v.literal("restaurant"), v.literal("portfolio")),
		restaurantId: v.optional(v.id(TABLE.RESTAURANTS)),
		metric: metricValidator,
		range: v.object({ from: v.number(), to: v.number() }),
		compareToPrev: v.boolean(),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<NumberWithDeltaResult, Errors> {
		const requireManagerOrAbove = MONEY_METRICS.has(args.metric);

		const [restaurantIds, accessErr] = await resolveRestaurantIds(ctx, {
			scopeKind: args.scopeKind,
			restaurantId: args.restaurantId,
			requireManagerOrAbove,
		});
		if (accessErr) return [null, accessErr];
		if (restaurantIds.length === 0) {
			return [
				{ current: 0, previous: args.compareToPrev ? 0 : null, deltaAbs: args.compareToPrev ? 0 : null, deltaPct: null },
				null,
			];
		}

		const [windowResult, rangeErr] = buildWindow(
			args.range,
			args.compareToPrev,
			NUMBER_WITH_DELTA_MAX_RANGE_DAYS
		);
		if (rangeErr) return [null, rangeErr];

		const current = await computeMetric(ctx, args.metric, restaurantIds, windowResult.current);
		const previous = windowResult.comparison
			? await computeMetric(ctx, args.metric, restaurantIds, windowResult.comparison)
			: null;

		const deltaAbs = previous !== null ? current - previous : null;
		const deltaPct =
			previous !== null && previous !== 0 ? (current - previous) / previous : null;

		return [{ current, previous, deltaAbs, deltaPct }, null];
	},
});

async function computeMetric(
	ctx: AnalyticsCtx,
	metric: Metric,
	restaurantIds: Id<"restaurants">[],
	range: DashboardRange
): Promise<number> {
	switch (metric) {
		case "reservations.count": {
			const rows = await loadReservationsInRange(ctx, restaurantIds, range);
			return rows.length;
		}
		case "reservations.confirmed": {
			const rows = await loadReservationsInRange(ctx, restaurantIds, range);
			return rows.filter((r) =>
				r.status === RESERVATION_STATUS.CONFIRMED ||
				r.status === RESERVATION_STATUS.SEATED ||
				r.status === RESERVATION_STATUS.COMPLETED
			).length;
		}
		case "orders.count": {
			const rows = await loadOrdersInRange(ctx, restaurantIds, range);
			return rows.length;
		}
		case "payments.revenueTotal": {
			const rows = await loadPaymentsInRange(ctx, restaurantIds, range);
			return rows
				.filter((p) => p.status === PAYMENT_STATUS.SUCCEEDED)
				.reduce((sum, p) => sum + p.amount, 0);
		}
		case "covers": {
			const rows = await loadReservationsInRange(ctx, restaurantIds, range);
			return rows
				.filter((r) =>
					r.status === RESERVATION_STATUS.SEATED ||
					r.status === RESERVATION_STATUS.COMPLETED
				)
				.reduce((sum, r) => sum + r.partySize, 0);
		}
		default: {
			const exhaustive: never = metric;
			return exhaustive;
		}
	}
}
