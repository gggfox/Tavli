/**
 * `numberWithDelta` widget query: a single big number with optional delta vs
 * the previous equivalent period.
 *
 * Supported metrics:
 * - `reservations.count`     — count of reservations starting in window (any status)
 * - `reservations.confirmed` — count where status = confirmed | seated | completed
 * - `orders.count`           — paid orders by `paidAt`
 * - `orders.avgDishValue`    — Σ order-item lineTotal ÷ Σ order-item quantity
 * - `orders.avgCheck`        — restaurant revenue ÷ count of paid orders
 * - `payments.revenueTotal`  — restaurant revenue over the window
 * - `covers`                 — sum of `partySize` of seated/completed reservations
 *
 * Money metrics (`payments.revenueTotal`, `orders.avgDishValue`,
 * `orders.avgCheck`) require manager-or-above; counts are available to any
 * staff member with restaurant access.
 *
 * "Restaurant revenue" is the ADR 008 definition: food only — excluding the
 * customer-borne Tavli service fee that now sits inside `payments.amount` and
 * excluding tips (their own `kind: "tip"` rows), and including cash orders,
 * which carry no `payments` row. See `convex/paymentMoneyHelpers.ts`.
 */
import { v } from "convex/values";
import { query } from "../_generated/server";
import { AsyncReturn } from "../_shared/types";
import { UserInputValidationErrorObject } from "../_shared/errors";
import { RESERVATION_STATUS, TABLE } from "../constants";
import type { Doc, Id } from "../_generated/dataModel";
import {
	sumCashSettledOrderRevenue,
	sumRestaurantRevenueFromPayments,
} from "../paymentMoneyHelpers";
import {
	buildWindow,
	loadOrderItemsInRange,
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
	v.literal("orders.avgDishValue"),
	v.literal("orders.avgCheck"),
	v.literal("payments.revenueTotal"),
	v.literal("covers")
);

type Metric = typeof metricValidator.type;

const MONEY_METRICS: ReadonlySet<Metric> = new Set([
	"payments.revenueTotal",
	"orders.avgDishValue",
	"orders.avgCheck",
]);

export type NumberWithDeltaResult = {
	current: number;
	previous: number | null;
	deltaAbs: number | null;
	deltaPct: number | null;
};

type Errors = AnalyticsAccessErrors | UserInputValidationErrorObject;

export const compute = query({
	args: {
		scopeKind: v.union(v.literal("restaurant"), v.literal("portfolio")),
		restaurantId: v.optional(v.id(TABLE.RESTAURANTS)),
		metric: metricValidator,
		range: v.object({ from: v.number(), to: v.number() }),
		compareToPrev: v.boolean(),
	},
	handler: async function (ctx, args): AsyncReturn<NumberWithDeltaResult, Errors> {
		const requireManagerOrAbove = MONEY_METRICS.has(args.metric);

		const [restaurantIds, accessErr] = await resolveRestaurantIds(ctx, {
			scopeKind: args.scopeKind,
			restaurantId: args.restaurantId,
			requireManagerOrAbove,
		});
		if (accessErr) return [null, accessErr];
		if (restaurantIds.length === 0) {
			return [
				{
					current: 0,
					previous: args.compareToPrev ? 0 : null,
					deltaAbs: args.compareToPrev ? 0 : null,
					deltaPct: null,
				},
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
		const deltaPct = previous !== null && previous !== 0 ? (current - previous) / previous : null;

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
			return rows.filter(
				(r) =>
					r.status === RESERVATION_STATUS.CONFIRMED ||
					r.status === RESERVATION_STATUS.SEATED ||
					r.status === RESERVATION_STATUS.COMPLETED
			).length;
		}
		case "orders.count": {
			const rows = await loadOrdersInRange(ctx, restaurantIds, range);
			return rows.length;
		}
		case "orders.avgDishValue": {
			const items = await loadOrderItemsInRange(ctx, restaurantIds, range);
			let totalLine = 0;
			let totalQty = 0;
			for (const it of items) {
				totalLine += it.lineTotal;
				totalQty += it.quantity;
			}
			return totalQty > 0 ? totalLine / totalQty : 0;
		}
		case "orders.avgCheck": {
			const orders = await loadOrdersInRange(ctx, restaurantIds, range);
			const paidOrderCount = orders.filter((o) => o.paidAt !== undefined).length;
			if (paidOrderCount === 0) return 0;
			// Cash orders are in the denominator (they have `paidAt`), so they
			// have to be in the numerator too — they just have no payments row.
			return (await restaurantRevenue(ctx, restaurantIds, range, orders)) / paidOrderCount;
		}
		case "payments.revenueTotal": {
			return await restaurantRevenue(ctx, restaurantIds, range);
		}
		case "covers": {
			const rows = await loadReservationsInRange(ctx, restaurantIds, range);
			return rows
				.filter(
					(r) => r.status === RESERVATION_STATUS.SEATED || r.status === RESERVATION_STATUS.COMPLETED
				)
				.reduce((sum, r) => sum + r.partySize, 0);
		}
		default: {
			const exhaustive: never = metric;
			return exhaustive;
		}
	}
}

/**
 * Restaurant revenue over a window: succeeded-payment food value (excluding
 * the Tavli service fee and tips) plus cash orders, which are paid but carry
 * no `payments` row. `preloadedOrders` lets a caller that already loaded the
 * window's orders avoid a second scan.
 */
async function restaurantRevenue(
	ctx: AnalyticsCtx,
	restaurantIds: Id<"restaurants">[],
	range: DashboardRange,
	preloadedOrders?: Doc<"orders">[]
): Promise<number> {
	const payments = await loadPaymentsInRange(ctx, restaurantIds, range);
	const orders = preloadedOrders ?? (await loadOrdersInRange(ctx, restaurantIds, range));
	return sumRestaurantRevenueFromPayments(payments) + sumCashSettledOrderRevenue(orders);
}
