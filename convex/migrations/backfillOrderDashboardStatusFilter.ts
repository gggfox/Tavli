import { mutation } from "../_generated/server";
import { NotAuthorizedError } from "../_shared/errors";
import { getCurrentUserId, isAdmin, RoleErrorMessages } from "../_util/auth";
import { TABLE } from "../constants";

/**
 * Highest-priority-first order used to collapse the legacy multi-select
 * filter into the single-select value: the earliest status in this list
 * present in the legacy array wins. Matches the dashboard's workflow order —
 * a user who had "submitted" among their filters cares about the queue first.
 */
const STATUS_PRIORITY = ["submitted", "preparing", "ready", "served", "cancelled"] as const;

type DashboardStatusFilter = (typeof STATUS_PRIORITY)[number];

const DEFAULT_FILTER: DashboardStatusFilter = "submitted";

/**
 * One-shot admin migration (ADR 008 / TAVLI-71): collapse the legacy
 * `orderDashboardStatusFilters` array into the new single-select
 * `orderDashboardStatusFilter`. The single value is the highest-priority
 * member of the legacy array per STATUS_PRIORITY; rows whose array is empty
 * or absent get the "submitted" default. The legacy array is left in place —
 * it is removed from the schema (and stripped) in a later phase, after every
 * environment has run this.
 *
 * `awaiting_payment` never appears here: the legacy array predates that
 * status, so no legacy row can contain it.
 *
 * Idempotent: rows that already have `orderDashboardStatusFilter` are
 * skipped, so re-running is safe (and a no-op once the backlog is cleared).
 *
 * Run with `npx convex run migrations/backfillOrderDashboardStatusFilter:run` per env.
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

		const settings = await ctx.db.query(TABLE.USER_SETTINGS).collect();
		let patched = 0;
		for (const row of settings) {
			if (row.orderDashboardStatusFilter !== undefined) continue;

			const legacy = row.orderDashboardStatusFilters ?? [];
			const derived = STATUS_PRIORITY.find((status) => legacy.includes(status)) ?? DEFAULT_FILTER;

			await ctx.db.patch(row._id, { orderDashboardStatusFilter: derived });
			patched++;
		}

		return { ok: true as const, patched, scanned: settings.length };
	},
});
