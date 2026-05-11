import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { TABLE } from "./constants";

/**
 * Next order number for this restaurant + period, persisted on
 * `orderDayCounters`. Call only from a mutation that also patches the order.
 *
 * `periodKey` is whatever the caller derived from
 * `restaurants.orderNumberResetFrequency` via `getOrderResetPeriodKey` —
 * `YYYY-MM-DD` for daily, `YYYY-MM` for monthly, `YYYY-Www` / `YYYY-Bnn` for
 * weekly / bi-weekly. Counter resets to 1 whenever the stored key differs.
 */
export async function allocateNextOrderNumber(
	ctx: MutationCtx,
	restaurantId: Id<"restaurants">,
	periodKey: string,
	now: number
): Promise<number> {
	const row = await ctx.db
		.query(TABLE.ORDER_DAY_COUNTERS)
		.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
		.first();

	if (!row) {
		await ctx.db.insert(TABLE.ORDER_DAY_COUNTERS, {
			restaurantId,
			serviceDateKey: periodKey,
			lastIssuedNumber: 1,
			updatedAt: now,
		});
		return 1;
	}

	if (row.serviceDateKey !== periodKey) {
		await ctx.db.patch(row._id, {
			serviceDateKey: periodKey,
			lastIssuedNumber: 1,
			updatedAt: now,
		});
		return 1;
	}

	const next = row.lastIssuedNumber + 1;
	await ctx.db.patch(row._id, {
		lastIssuedNumber: next,
		updatedAt: now,
	});
	return next;
}
