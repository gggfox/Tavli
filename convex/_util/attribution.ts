/**
 * Waiter ↔ floor resolution, both directions of the same chain:
 *
 *   table.sectionId → active `shiftSectionAssignments` window → shift.memberId
 *
 * `resolveAttributedMemberId` walks it forwards (given a table, who gets
 * credit for its money) and `resolveMemberFloorCoverage` walks it backwards
 * (given a member, which tables are theirs right now). Keeping both in one
 * module keeps a single description of what "covering a section" means.
 */
import type { Doc, Id } from "../_generated/dataModel";
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

/**
 * How many already-started shifts to look at when asking "is this member on
 * the floor right now?".
 *
 * The scan is newest-`startsAt`-first among shifts that have already begun,
 * so a shift covering `atMs` is normally the very first row. A member's
 * shifts do not meaningfully overlap — twenty rows back is far past the point
 * where an older one could still be running — and the alternative (an
 * unbounded walk of a member's whole shift history on every dashboard read)
 * costs more than the case it protects.
 */
const ACTIVE_SHIFT_SCAN_CAP = 20;

/** What a member covers on the floor at one instant. */
export type MemberFloorCoverage = {
	/** This member's shifts that cover `atMs` and are not cancelled. */
	readonly shifts: ReadonlyArray<Doc<"shifts">>;
	/** Sections those shifts cover at `atMs`. */
	readonly sectionIds: ReadonlySet<Id<"sections">>;
	/**
	 * Every table in those sections, plus any table held by a legacy
	 * per-table assignment. Empty means the member covers nothing right now —
	 * a normal state (off shift, or on shift with no section assigned), not an
	 * error.
	 */
	readonly tableIds: ReadonlySet<Id<"tables">>;
};

/**
 * Which tables a member is responsible for at `atMs`.
 *
 * Unlike `resolveAttributedMemberId` this DOES consult
 * `shiftTableAssignments`. The two answer different questions: attribution
 * picks exactly one member to bill a tip to, so it needs the single
 * authoritative source, while coverage decides what a server is allowed to
 * see — and a server holding a legacy per-table assignment should not be
 * blind to their own tables just because the row predates sections.
 */
export async function resolveMemberFloorCoverage(
	ctx: { db: DatabaseReader },
	args: {
		restaurantId: Id<"restaurants">;
		memberId: Id<"restaurantMembers">;
		atMs: number;
	}
): Promise<MemberFloorCoverage> {
	const recentShifts = await ctx.db
		.query(TABLE.SHIFTS)
		.withIndex("by_member_time", (q) => q.eq("memberId", args.memberId).lte("startsAt", args.atMs))
		.order("desc")
		.take(ACTIVE_SHIFT_SCAN_CAP);

	const shifts = recentShifts.filter(
		(shift) =>
			shift.restaurantId === args.restaurantId &&
			shift.status !== SHIFT_STATUS.CANCELLED &&
			shift.endsAt >= args.atMs
	);

	const sectionIds = new Set<Id<"sections">>();
	const tableIds = new Set<Id<"tables">>();

	for (const shift of shifts) {
		const sectionAssignments = await ctx.db
			.query(TABLE.SHIFT_SECTION_ASSIGNMENTS)
			.withIndex("by_shift", (q) => q.eq("shiftId", shift._id))
			.collect();
		for (const assignment of sectionAssignments) {
			if (assignment.restaurantId !== args.restaurantId) continue;
			if (assignment.startsAt <= args.atMs && assignment.endsAt >= args.atMs) {
				sectionIds.add(assignment.sectionId);
			}
		}

		const tableAssignments = await ctx.db
			.query(TABLE.SHIFT_TABLE_ASSIGNMENTS)
			.withIndex("by_shift", (q) => q.eq("shiftId", shift._id))
			.collect();
		for (const assignment of tableAssignments) {
			if (assignment.restaurantId !== args.restaurantId) continue;
			if (assignment.startsAt <= args.atMs && assignment.endsAt >= args.atMs) {
				tableIds.add(assignment.tableId);
			}
		}
	}

	// Soft-deleted tables stay in: an order placed before the table left the
	// floor plan still belongs to whoever covers its section.
	for (const sectionId of sectionIds) {
		const tables = await ctx.db
			.query(TABLE.TABLES)
			.withIndex("by_section", (q) => q.eq("sectionId", sectionId))
			.collect();
		for (const table of tables) {
			if (table.restaurantId !== args.restaurantId) continue;
			tableIds.add(table._id);
		}
	}

	return { shifts, sectionIds, tableIds };
}
