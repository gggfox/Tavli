import { mutation } from "../_generated/server";
import { NotAuthorizedError } from "../_shared/errors";
import { getCurrentUserId, isAdmin, RoleErrorMessages } from "../_util/auth";
import { TABLE, TABLE_ASSIGNED_BY } from "../constants";

/**
 * One-shot admin migration: stamp `reservations.tableAssignedBy` on rows that
 * predate auto-assignment (TAVLI-101).
 *
 * `staff` is not a default here, it is the truth: before `placeParty` existed,
 * `tableIds` was only ever written by `confirm`, `reschedule` or `markSeated` —
 * all of which require a staff identity. Every legacy table was chosen by a
 * human.
 *
 * Marking these `auto` instead would be actively harmful rather than merely
 * wrong: `reschedule` re-places `auto` rows freely, so a mismarked row would let
 * a time change move a party off a table a manager picked on purpose.
 *
 * Rows with no tables are left unmarked. They are sitting in the unassigned
 * queue and have no assignment to describe; `placeParty` will stamp them when
 * someone places them.
 *
 * Idempotent: rows that already carry a marker are skipped, so re-running is
 * safe and reports `patched: 0`.
 *
 * Run with `npx convex run migrations/backfillTableAssignedBy:run` per env.
 */
export const run = mutation({
	args: {},
	handler: async (ctx) => {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return { ok: false as const, error: err, patched: 0 };

		if (!(await isAdmin(ctx, userId))) {
			return {
				ok: false as const,
				error: new NotAuthorizedError(RoleErrorMessages.ADMIN_REQUIRED).toObject(),
				patched: 0,
			};
		}

		const reservations = await ctx.db.query(TABLE.RESERVATIONS).collect();
		let patched = 0;
		for (const reservation of reservations) {
			if (reservation.tableAssignedBy !== undefined) continue;
			if (reservation.tableIds.length === 0) continue;
			await ctx.db.patch(reservation._id, { tableAssignedBy: TABLE_ASSIGNED_BY.STAFF });
			patched++;
		}

		return { ok: true as const, error: null, patched };
	},
});
