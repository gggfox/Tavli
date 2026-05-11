import type { Id } from "../_generated/dataModel";
import type { DatabaseReader } from "../_generated/server";
import { SHIFT_STATUS, TABLE } from "../constants";

/**
 * Resolve which restaurant member should get credit for an order at payment
 * time.
 *
 * Resolution order (post-sections rollout):
 *   1. The table's section has an active `shiftSectionAssignments` window
 *      covering `atMs` whose shift is not cancelled — return that shift's
 *      member.
 *   2. Else `args.sessionServerMemberId` (set when staff start a session for
 *      a non-shift-attributed party).
 *   3. Else `undefined` (the order will surface as unattributed and managers
 *      can reconcile from the dashboard).
 *
 * This intentionally does NOT consult `shiftTableAssignments` anymore;
 * `sections.backfillDefault` migrates legacy per-table coverage into
 * `shiftSectionAssignments` so the new resolver still credits the correct
 * member for any data created before the rollout.
 *
 * `table.sectionId` is `v.optional` during Phase 1 of the rollout. Tables
 * without a section can only fall back to `sessionServerMemberId`. Phase 2
 * will tighten the schema and remove this branch.
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
	const table = await ctx.db.get(args.tableId);
	if (table?.sectionId) {
		const sectionId = table.sectionId;
		const assignments = await ctx.db
			.query(TABLE.SHIFT_SECTION_ASSIGNMENTS)
			.withIndex("by_section_time", (q) => q.eq("sectionId", sectionId))
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
	}

	return args.sessionServerMemberId;
}
