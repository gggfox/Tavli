import { mutation } from "../_generated/server";
import { NotAuthorizedError } from "../_shared/errors";
import { getCurrentUserId, isAdmin, RoleErrorMessages } from "../_util/auth";
import { DEFAULT_RESTAURANT_TIMEZONE, TABLE } from "../constants";

/**
 * One-shot admin migration: set `America/Mexico_City` on restaurants with a
 * missing or empty timezone.
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

		const restaurants = await ctx.db.query(TABLE.RESTAURANTS).collect();
		let patched = 0;
		for (const restaurant of restaurants) {
			const raw = restaurant.timezone?.trim();
			if (raw) continue;
			await ctx.db.patch(restaurant._id, { timezone: DEFAULT_RESTAURANT_TIMEZONE });
			patched++;
		}

		return { ok: true as const, patched };
	},
});
