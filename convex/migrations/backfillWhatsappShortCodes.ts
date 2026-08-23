import { mutation } from "../_generated/server";
import { NotAuthorizedError } from "../_shared/errors";
import { getCurrentUserId, isAdmin, RoleErrorMessages } from "../_util/auth";
import { TABLE, WHATSAPP_SHORT_CODE_MAX_ATTEMPTS } from "../constants";
import { generateShortCode } from "../whatsapp/shortCode";

/**
 * One-shot admin migration for ADR 012: give every `whatsappChannels` row a
 * short code, and clear the per-restaurant `phoneNumber` it no longer has.
 *
 * Routing moved from the Twilio "To" number to a short code carried in the
 * deep-link text. A row written before that has no `shortCode` and therefore
 * cannot be reached by any link — this stamps one so the existing enablement
 * survives the change instead of having to be re-created by hand.
 *
 * **Conversations are deliberately NOT backfilled.** They already carry a
 * denormalized `restaurantId`, which is exactly the key the new
 * `by_restaurant_customer` index routes on, so every existing thread stays
 * addressable with no data change at all. The stale `channelId` on those rows
 * still points at the same (now differently-meaning) enablement row, and the
 * next inbound message refreshes it.
 *
 * Not paginated: `whatsappChannels` has one row per enabled restaurant, which
 * is bounded by how many restaurants exist. Idempotent — a row that already has
 * a code and no phone number is skipped, so re-running is a no-op.
 *
 *   npx convex run migrations/backfillWhatsappShortCodes:run '{}'
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

		const channels = await ctx.db.query(TABLE.WHATSAPP_CHANNELS).collect();
		const taken = new Set(channels.map((c) => c.shortCode).filter(Boolean) as string[]);

		let stamped = 0;
		let cleared = 0;
		const now = Date.now();

		for (const channel of channels) {
			const patch: { shortCode?: string; phoneNumber?: undefined; updatedAt?: number } = {};

			if (!channel.shortCode) {
				const restaurant = await ctx.db.get(channel.restaurantId);
				let code: string | null = null;
				for (let attempt = 0; attempt < WHATSAPP_SHORT_CODE_MAX_ATTEMPTS && !code; attempt++) {
					const candidate = generateShortCode(restaurant?.name ?? "");
					if (!taken.has(candidate)) code = candidate;
				}
				// A row we cannot mint a free code for is left alone rather than
				// stamped with a duplicate: two restaurants sharing a code would route
				// one restaurant's diners to the other.
				if (code) {
					taken.add(code);
					patch.shortCode = code;
					stamped++;
				}
			}

			if (channel.phoneNumber !== undefined) {
				patch.phoneNumber = undefined;
				cleared++;
			}

			if (Object.keys(patch).length === 0) continue;
			await ctx.db.patch(channel._id, { ...patch, updatedAt: now });
		}

		return { ok: true as const, scanned: channels.length, stamped, cleared };
	},
});
