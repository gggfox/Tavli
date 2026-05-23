import { mutation } from "../_generated/server";
import { allocateNextOrderNumber } from "../orderDayCounters";
import { getOrderResetPeriodKey, getOrderServiceDateKey } from "../orderServiceDate";
import { NotAuthorizedError } from "../_shared/errors";
import { getCurrentUserId, isAdmin, RoleErrorMessages } from "../_util/auth";
import { AUDIT_SYSTEM_USER_ID, DEFAULT_ORDER_NUMBER_RESET_FREQUENCY, TABLE } from "../constants";

const BACKFILL_STATUSES = new Set(["submitted", "preparing", "ready", "served"]);

/**
 * One-shot admin migration: assign `dailyOrderNumber` and `orderServiceDateKey`
 * to every active/served order that is missing one.
 *
 * Bucketed under today's period (per restaurant timezone + reset frequency)
 * because `orderDayCounters` holds a single row per restaurant keyed by the
 * current period — calling `allocateNextOrderNumber` with an old period key
 * would overwrite the live counter. Trade-off accepted: legacy orders count
 * against today's tip-pool/business-day stats.
 *
 * Idempotent: only patches rows where `dailyOrderNumber === undefined`, so a
 * re-run after the first patch returns `patched: 0`.
 *
 * Skips `cancelled` and `draft` so the forward invariant holds (cancelled and
 * draft orders never get numbers).
 */
export const run = mutation({
	args: {},
	handler: async (ctx) => {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return { ok: false as const, error: err };

		if (!(await isAdmin(ctx, userId))) {
			return {
				ok: false as const,
				error: new NotAuthorizedError(RoleErrorMessages.ADMIN_REQUIRED).toObject(),
			};
		}

		const now = Date.now();
		const restaurants = await ctx.db.query(TABLE.RESTAURANTS).collect();
		let patched = 0;

		for (const restaurant of restaurants) {
			const orderServiceDateKey = getOrderServiceDateKey(
				now,
				restaurant.timezone,
				restaurant.orderDayStartMinutesFromMidnight
			);
			const periodKey = getOrderResetPeriodKey(
				now,
				restaurant.timezone,
				restaurant.orderDayStartMinutesFromMidnight,
				restaurant.orderNumberResetFrequency ?? DEFAULT_ORDER_NUMBER_RESET_FREQUENCY
			);

			const candidates = await ctx.db
				.query(TABLE.ORDERS)
				.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurant._id))
				.collect();

			const eligible = candidates
				.filter((o) => o.dailyOrderNumber === undefined && BACKFILL_STATUSES.has(o.status))
				.sort((a, b) => (a.submittedAt ?? a.createdAt) - (b.submittedAt ?? b.createdAt));

			for (const order of eligible) {
				const dailyOrderNumber = await allocateNextOrderNumber(ctx, restaurant._id, periodKey, now);
				await ctx.db.patch(order._id, {
					dailyOrderNumber,
					orderServiceDateKey,
					updatedAt: now,
					updatedBy: AUDIT_SYSTEM_USER_ID,
				});
				patched++;
			}
		}

		return { ok: true as const, patched };
	},
});
