import type { TableNames } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { NotAuthorizedError } from "../_shared/errors";
import { getCurrentUserId, isAdmin, RoleErrorMessages } from "../_util/auth";
import { AUDIT_SYSTEM_USER_ID, TABLE } from "../constants";

const TABLES_WITH_UPDATED_BY: TableNames[] = [
	TABLE.USER_SETTINGS,
	TABLE.USER_ROLES,
	TABLE.RESTAURANT_MEMBERS,
	TABLE.ORGANIZATIONS,
	TABLE.FEATURE_FLAGS,
	TABLE.RESTAURANTS,
	TABLE.MENUS,
	TABLE.MENU_CATEGORIES,
	TABLE.MENU_ITEMS,
	TABLE.OPTION_GROUPS,
	TABLE.OPTIONS,
	TABLE.ORDERS,
	TABLE.PAYMENTS,
	TABLE.RESERVATIONS,
	TABLE.RESERVATION_SETTINGS,
	TABLE.INVITATIONS,
	TABLE.SHIFTS,
	TABLE.SHIFT_TABLE_ASSIGNMENTS,
	TABLE.ABSENCES,
	TABLE.TIP_POOLS,
	TABLE.TIP_ENTRIES,
];

/**
 * One-shot admin migration: set `updatedBy` to the system sentinel wherever it is missing.
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

		let patched = 0;
		for (const table of TABLES_WITH_UPDATED_BY) {
			const docs = await ctx.db.query(table).collect();
			for (const doc of docs) {
				const row = doc as { updatedBy?: string };
				if (row.updatedBy !== undefined && row.updatedBy !== "") continue;
				await ctx.db.patch(doc._id, { updatedBy: AUDIT_SYSTEM_USER_ID });
				patched++;
			}
		}

		return { ok: true as const, patched };
	},
});
