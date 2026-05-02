import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { TABLE } from "./constants";

/**
 * Next daily order number for this restaurant + service date, persisted on
 * `orderDayCounters`. Call only from a mutation that also patches the order.
 */
export async function allocateNextDailyOrderNumber(
	ctx: MutationCtx,
	restaurantId: Id<"restaurants">,
	serviceDateKey: string,
	now: number
): Promise<number> {
	const row = await ctx.db
		.query(TABLE.ORDER_DAY_COUNTERS)
		.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
		.first();

	if (!row) {
		await ctx.db.insert(TABLE.ORDER_DAY_COUNTERS, {
			restaurantId,
			serviceDateKey,
			lastIssuedNumber: 1,
			updatedAt: now,
		});
		return 1;
	}

	if (row.serviceDateKey !== serviceDateKey) {
		await ctx.db.patch(row._id, {
			serviceDateKey,
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
