import { v } from "convex/values";
import { mutation } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { NotAuthorizedError } from "../_shared/errors";
import { getCurrentUserId, isAdmin, RoleErrorMessages } from "../_util/auth";
import { normalizeContactPhone } from "../_util/phone";
import { TABLE } from "../constants";

/** Rows per invocation. Keeps one run well inside the per-function read cap. */
const DEFAULT_BATCH_SIZE = 500;

/**
 * One-shot admin migration: canonicalize `reservations.contact.phone`.
 *
 * Every write path now stores the canonical E.164 form, but rows written before
 * that hold whatever their source produced — `8114906208` typed by staff,
 * `811 490 6208` pasted into the web form, `+5218114906208` delivered by
 * WhatsApp. `contact.phone` is the customer's whole identity (ADR-011) and
 * `findUpcomingByPhone` matches it through an exact index lookup, so until the
 * old rows agree with the new ones the same human stays split across spellings
 * and the assistant cannot find a booking made anywhere but WhatsApp.
 *
 * Country comes from each reservation's own restaurant timezone, cached per
 * restaurant so a batch does one read per restaurant rather than one per row.
 * A number that cannot be placed confidently is left exactly as typed — see
 * `normalizeContactPhone`.
 *
 * Idempotent: rows already canonical are skipped, so re-running is safe and
 * becomes a no-op once the backlog clears.
 *
 * Paginated because reservations is one of the tables that actually grows. Run
 * repeatedly, feeding back `cursor`, until `isDone` is true:
 *
 *   npx convex run migrations/backfillContactPhone:run '{}'
 *   npx convex run migrations/backfillContactPhone:run '{"cursor":"<cursor>"}'
 */
export const run = mutation({
	args: {
		cursor: v.optional(v.string()),
		batchSize: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return { ok: false as const, error: err };

		if (!(await isAdmin(ctx, userId))) {
			return {
				ok: false as const,
				error: new NotAuthorizedError(RoleErrorMessages.ADMIN_REQUIRED).toObject(),
			};
		}

		const page = await ctx.db.query(TABLE.RESERVATIONS).paginate({
			cursor: args.cursor ?? null,
			numItems: args.batchSize ?? DEFAULT_BATCH_SIZE,
		});

		const timezones = new Map<Id<"restaurants">, string | undefined>();
		let patched = 0;

		for (const row of page.page) {
			if (!timezones.has(row.restaurantId)) {
				const restaurant = await ctx.db.get(row.restaurantId);
				timezones.set(row.restaurantId, restaurant?.timezone);
			}

			const next = normalizeContactPhone(row.contact.phone, timezones.get(row.restaurantId));
			if (next === row.contact.phone) continue;

			await ctx.db.patch(row._id, { contact: { ...row.contact, phone: next } });
			patched++;
		}

		return {
			ok: true as const,
			patched,
			scanned: page.page.length,
			isDone: page.isDone,
			// Feed back into the next invocation; null once there is nothing left.
			cursor: page.isDone ? null : page.continueCursor,
		};
	},
});
