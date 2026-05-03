import { mutation } from "../_generated/server";
import { NotAuthorizedError } from "../_shared/errors";
import { getCurrentUserId, isAdmin, RoleErrorMessages } from "../_util/auth";
import { AUDIT_SYSTEM_USER_ID, TABLE } from "../constants";
import { insertMenuForRestaurant } from "../menus";

/**
 * One-shot admin migration: create a default menu for any restaurant that has none (name = slug).
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
		let created = 0;
		for (const restaurant of restaurants) {
			const menus = await ctx.db
				.query(TABLE.MENUS)
				.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurant._id))
				.collect();
			if (menus.length > 0) continue;

			await insertMenuForRestaurant(ctx, {
				restaurantId: restaurant._id,
				name: restaurant.slug,
				userId: AUDIT_SYSTEM_USER_ID,
			});
			created++;
		}

		return { ok: true as const, created };
	},
});
