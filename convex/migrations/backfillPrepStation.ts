import { mutation } from "../_generated/server";
import { NotAuthorizedError } from "../_shared/errors";
import { getCurrentUserId, isAdmin, RoleErrorMessages } from "../_util/auth";
import { DEFAULT_PREP_STATION, TABLE } from "../constants";

/**
 * One-shot admin migration: backfill `menuItems.prepStation = "kitchen"`
 * for every row that does not have a value yet. Items created after the
 * `prepStation` field landed always set it explicitly via `createMenuItem`,
 * so this migration is only required once per environment to catch the
 * pre-existing rows.
 *
 * Idempotent: rows that already have a `prepStation` are left untouched, so
 * re-running is safe (and a no-op once the backlog is cleared).
 *
 * Run with `npx convex run migrations/backfillPrepStation:run` per env.
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

		const items = await ctx.db.query(TABLE.MENU_ITEMS).collect();
		let patched = 0;
		for (const item of items) {
			if (item.prepStation !== undefined) continue;
			await ctx.db.patch(item._id, { prepStation: DEFAULT_PREP_STATION });
			patched++;
		}

		return { ok: true as const, patched, scanned: items.length };
	},
});
