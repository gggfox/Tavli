/**
 * WhatsApp enablement — which restaurants the Tavli assistant answers for.
 *
 * A `whatsappChannels` row used to mean "this phone number belongs to this
 * restaurant". Since ADR 012 it means "**this restaurant is enabled**, with
 * this short code and this default reply locale": Tavli is the sender on one
 * shared number, so there is no per-restaurant number to map.
 *
 * Enabling is **platform-admin only**, gated exactly like `featureFlags.ts`
 * (`getCurrentUserId` then `requireAdminRole`). It is not self-serve on
 * purpose: every enabled restaurant spends money on Tavli's own Twilio and
 * OpenRouter accounts, and the subscription gate that would make that a
 * restaurant's own cost does not exist yet (TAVLI-95).
 *
 * Reading is wider. A restaurant's own staff need the link and the QR to put on
 * their tables, and diners need the link on the public page — the short code is
 * a router, not a secret (see `constants.ts`).
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { ConflictError, NotFoundError } from "./_shared/errors";
import { getCurrentUserId, requireAdminRole, requireRestaurantStaffAccess } from "./_util/auth";
import { TABLE, WHATSAPP_SHORT_CODE_MAX_ATTEMPTS, type WhatsappLocale } from "./constants";
import { resolveLocale } from "./whatsapp/copy";
import {
	buildDeepLinkText,
	buildDeepLinkUrl,
	formatShortCode,
	generateShortCode,
} from "./whatsapp/shortCode";

/** What every surface that shows the deep link needs, and nothing more. */
export type WhatsappEnablement = {
	restaurantId: Id<"restaurants">;
	/** Named here so a diner-facing surface never needs a second query. */
	restaurantName: string;
	isActive: boolean;
	/** Canonical code, e.g. `VRN8F3`. */
	shortCode: string;
	/** Display code, e.g. `VRN-8F3`. */
	formattedShortCode: string;
	/** `null` when Tavli has no sender number configured on this deployment. */
	deepLinkUrl: string | null;
	/** The sentence the link prefills, so staff can see what a diner will send. */
	deepLinkText: string;
	defaultLocale?: string;
};

async function getChannelByRestaurant(
	ctx: QueryCtx | MutationCtx,
	restaurantId: Id<"restaurants">
): Promise<Doc<"whatsappChannels"> | null> {
	return await ctx.db
		.query(TABLE.WHATSAPP_CHANNELS)
		.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
		.first();
}

function toEnablement(
	channel: Doc<"whatsappChannels">,
	restaurant: Doc<"restaurants">
): WhatsappEnablement | null {
	// A row from before ADR 012 has no code and cannot route until the backfill
	// stamps one. Reporting it as enabled would render a link to nowhere.
	if (!channel.shortCode) return null;
	const locale: WhatsappLocale = resolveLocale(channel.defaultLocale, restaurant.defaultLanguage);
	return {
		restaurantId: restaurant._id,
		restaurantName: restaurant.name,
		isActive: channel.isActive,
		shortCode: channel.shortCode,
		formattedShortCode: formatShortCode(channel.shortCode),
		deepLinkUrl: buildDeepLinkUrl(
			process.env.TWILIO_WHATSAPP_NUMBER,
			restaurant.name,
			channel.shortCode,
			locale
		),
		deepLinkText: buildDeepLinkText(restaurant.name, channel.shortCode, locale),
		defaultLocale: channel.defaultLocale,
	};
}

/**
 * Mint a code that no other restaurant holds.
 *
 * Collisions are handled by retrying, not by widening the code: six readable
 * characters is the point. The final attempt falls back to a fully random
 * prefix, which trades the name abbreviation for a code that definitely lands.
 */
async function mintUniqueShortCode(ctx: MutationCtx, restaurantName: string): Promise<string> {
	for (let attempt = 0; attempt < WHATSAPP_SHORT_CODE_MAX_ATTEMPTS; attempt++) {
		// Past halfway, stop insisting on the name abbreviation — it is the half
		// that keeps colliding.
		const seedName = attempt < WHATSAPP_SHORT_CODE_MAX_ATTEMPTS / 2 ? restaurantName : "";
		const candidate = generateShortCode(seedName);
		const taken = await ctx.db
			.query(TABLE.WHATSAPP_CHANNELS)
			.withIndex("by_short_code", (q) => q.eq("shortCode", candidate))
			.first();
		if (!taken) return candidate;
	}
	throw new ConflictError("ERROR_WHATSAPP_SHORT_CODE_UNAVAILABLE");
}

// ============================================================================
// Queries
// ============================================================================

/**
 * The enablement record for one restaurant, for its own staff.
 *
 * Staff-level access rather than admin: a manager cannot enable the assistant,
 * but they are the person who prints the QR code and tapes it to a table.
 */
export const getForRestaurant = query({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async (ctx, args): Promise<WhatsappEnablement | null> => {
		const [userId, authError] = await getCurrentUserId(ctx);
		if (authError) throw authError;
		const [restaurant, accessError] = await requireRestaurantStaffAccess(
			ctx,
			userId,
			args.restaurantId
		);
		if (accessError) throw accessError;

		const channel = await getChannelByRestaurant(ctx, args.restaurantId);
		if (!channel) return null;
		return toEnablement(channel, restaurant);
	},
});

/**
 * The deep link for a restaurant's public page, by slug. Anonymous on purpose:
 * this is the diner-facing entry point, and the code it carries is a router.
 * Returns `null` unless the assistant is enabled AND active, so a disabled
 * restaurant's page shows nothing rather than a link that answers with the
 * "open the restaurant's link" guidance.
 */
export const getPublicBySlug = query({
	args: { slug: v.string() },
	handler: async (ctx, args): Promise<WhatsappEnablement | null> => {
		const restaurant = await ctx.db
			.query(TABLE.RESTAURANTS)
			.withIndex("by_slug", (q) => q.eq("slug", args.slug))
			.first();
		if (!restaurant || restaurant.deletedAt != null) return null;

		const channel = await getChannelByRestaurant(ctx, restaurant._id);
		if (!channel?.isActive) return null;
		return toEnablement(channel, restaurant);
	},
});

// ============================================================================
// Mutations (platform admin only)
// ============================================================================

async function requirePlatformAdmin(ctx: MutationCtx): Promise<string> {
	const [userId, authError] = await getCurrentUserId(ctx);
	if (authError) throw authError;
	const [, roleError] = await requireAdminRole(ctx, userId);
	if (roleError) throw roleError;
	return userId;
}

/**
 * Enable or disable the assistant for a restaurant. Idempotent: enabling an
 * already-enabled restaurant keeps its code, because the code is printed on
 * tables and silently rotating it would kill every QR in the room.
 */
export const setEnabled = mutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		isActive: v.boolean(),
		defaultLocale: v.optional(v.string()),
	},
	handler: async (ctx, args): Promise<WhatsappEnablement | null> => {
		const userId = await requirePlatformAdmin(ctx);

		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant || restaurant.deletedAt != null) {
			throw new NotFoundError("ERROR_RESTAURANT_NOT_FOUND");
		}

		const now = Date.now();
		const existing = await getChannelByRestaurant(ctx, args.restaurantId);
		if (existing) {
			await ctx.db.patch(existing._id, {
				isActive: args.isActive,
				// A row predating ADR 012 gets its code here, so re-saving from the
				// admin UI is a second way to repair one the backfill missed.
				shortCode: existing.shortCode ?? (await mintUniqueShortCode(ctx, restaurant.name)),
				...(args.defaultLocale !== undefined ? { defaultLocale: args.defaultLocale } : {}),
				updatedAt: now,
				updatedBy: userId,
			});
		} else {
			await ctx.db.insert(TABLE.WHATSAPP_CHANNELS, {
				restaurantId: args.restaurantId,
				shortCode: await mintUniqueShortCode(ctx, restaurant.name),
				isActive: args.isActive,
				defaultLocale: args.defaultLocale,
				createdAt: now,
				updatedAt: now,
				updatedBy: userId,
			});
		}

		const channel = await getChannelByRestaurant(ctx, args.restaurantId);
		return channel ? toEnablement(channel, restaurant) : null;
	},
});

/**
 * Issue a fresh short code, retiring the old one immediately.
 *
 * Regeneration is the answer to a code that has been printed somewhere it
 * should not be, or that reads badly. Every existing QR and link stops routing
 * the moment this runs — which is the point, and why it is admin-only.
 */
export const regenerateShortCode = mutation({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async (ctx, args): Promise<WhatsappEnablement | null> => {
		const userId = await requirePlatformAdmin(ctx);

		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant || restaurant.deletedAt != null) {
			throw new NotFoundError("ERROR_RESTAURANT_NOT_FOUND");
		}
		const channel = await getChannelByRestaurant(ctx, args.restaurantId);
		if (!channel) throw new NotFoundError("ERROR_WHATSAPP_NOT_ENABLED");

		await ctx.db.patch(channel._id, {
			shortCode: await mintUniqueShortCode(ctx, restaurant.name),
			updatedAt: Date.now(),
			updatedBy: userId,
		});

		const updated = await ctx.db.get(channel._id);
		return updated ? toEnablement(updated, restaurant) : null;
	},
});
