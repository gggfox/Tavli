import { mutation } from "../_generated/server";
import { NotAuthorizedError } from "../_shared/errors";
import { getCurrentUserId, isAdmin, RoleErrorMessages } from "../_util/auth";
import { TABLE } from "../constants";

/**
 * One-shot admin migration: backfill `allEvents.restaurantId` for rows written
 * before the column existed. Events appended after it landed always set it via
 * `appendAuditEvent` (the field is required there), so this only catches the
 * historical backlog.
 *
 * Best-effort derivation, in order:
 * 1. `aggregateType === "restaurants"` → the aggregateId IS the restaurant id.
 * 2. A string `payload.restaurantId` written by our own call sites.
 * Rows matching neither (org-level events, odd payload shapes) are left as-is —
 * that is the same meaning `restaurantId: null` has for new events.
 *
 * Ids are decoded with `normalizeId`, which does not require the restaurant to
 * still exist — events of already-purged restaurants get their dangling id
 * back-filled too, which is exactly what the `by_restaurant_time` index is for.
 *
 * Idempotent: rows with a `restaurantId` are skipped, so re-running is safe.
 *
 * Run with `npx convex run migrations/backfillAllEventsRestaurantId:run` per env.
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

		const events = await ctx.db.query(TABLE.ALL_EVENTS).collect();
		let patched = 0;
		let underivable = 0;
		for (const event of events) {
			if (event.restaurantId !== undefined) continue;

			const candidate =
				event.aggregateType === TABLE.RESTAURANTS
					? event.aggregateId
					: typeof (event.payload as { restaurantId?: unknown } | null)?.restaurantId === "string"
						? ((event.payload as { restaurantId: string }).restaurantId as string)
						: null;

			const restaurantId = candidate ? ctx.db.normalizeId(TABLE.RESTAURANTS, candidate) : null;
			if (!restaurantId) {
				underivable++;
				continue;
			}

			await ctx.db.patch(event._id, { restaurantId });
			patched++;
		}

		return { ok: true as const, patched, underivable, scanned: events.length };
	},
});
