import type { Id } from "../_generated/dataModel";
import type { DatabaseReader } from "../_generated/server";
import { SHIFT_STATUS, TABLE } from "../constants";

/**
 * Resolve which restaurant member should get credit for an order at payment time.
 * 1) Active shift table assignment covering `tableId` at `atMs` (uses the shift's member).
 * 2) Else `session.serverMemberId` if set.
 */
export async function resolveAttributedMemberId(
	ctx: { db: DatabaseReader },
	args: {
		restaurantId: Id<"restaurants">;
		tableId: Id<"tables">;
		atMs: number;
		sessionServerMemberId?: Id<"restaurantMembers">;
	}
): Promise<Id<"restaurantMembers"> | undefined> {
	const assignments = await ctx.db
		.query(TABLE.SHIFT_TABLE_ASSIGNMENTS)
		.withIndex("by_table_time", (q) => q.eq("tableId", args.tableId))
		.collect();

	for (const a of assignments) {
		if (a.restaurantId !== args.restaurantId) continue;
		if (a.startsAt <= args.atMs && a.endsAt >= args.atMs) {
			const shift = await ctx.db.get(a.shiftId);
			if (
				shift &&
				shift.status !== SHIFT_STATUS.CANCELLED &&
				shift.restaurantId === args.restaurantId
			) {
				return shift.memberId;
			}
		}
	}

	return args.sessionServerMemberId;
}
