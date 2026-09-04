/**
 * Feature flags management for the application.
 * Allows enabling/disabling features at runtime without code deployments.
 */
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import {
	NotAuthenticatedErrorObject,
	NotAuthorizedErrorObject,
	NotFoundError,
	NotFoundErrorObject,
	UserInputValidationError,
	UserInputValidationErrorObject,
} from "./_shared/errors";
import { AsyncReturn } from "./_shared/types";
import { getCurrentUserId, requireAdminRole } from "./_util/auth";

// ============================================================================
// Error Types
// ============================================================================

type DeleteFeatureFlagErrors =
	| NotAuthenticatedErrorObject
	| NotAuthorizedErrorObject
	| NotFoundErrorObject
	| UserInputValidationErrorObject;

// ============================================================================
// Feature Flag Keys
// ============================================================================

/**
 * Available feature flag keys.
 * Add new feature flags here as constants for type safety.
 *
 * When adding a flag, also add a matching entry to FEATURE_FLAG_METADATA so the
 * admin UI has a description to render.
 */
export const FEATURE_FLAGS = {
	/**
	 * Numeric retention window (in days) for soft-deleted sections and tables.
	 * When `enabled === true`, the cron purge sweep treats `numericValue` as the
	 * delay between soft-delete time and hard-purge. Otherwise we fall back to
	 * `DEFAULT_SOFT_DELETE_PURGE_DELAY_DAYS`.
	 */
	SOFT_DELETE_PURGE_DELAY_DAYS: "softDeletePurgeDelayDays",
	/**
	 * Lets the WhatsApp assistant hand the diner a link to the menu page
	 * (`send_menu_link`). OFF until `/r/:slug/:lang/menu` is viewable **signed
	 * out** — see `isMenuLinkEnabled` below for why that precondition exists.
	 */
	WHATSAPP_MENU_LINK: "whatsappMenuLink",
	/**
	 * Platform-wide master switch for **diner-facing** reservations (TAVLI-100).
	 *
	 * Two levels, and they are different tools. This one is the platform's:
	 * admin-only, and it decides whether the product offers reservations at
	 * all. `reservationSettings.acceptingReservations` is the restaurant's:
	 * manager-editable, and it decides whether *this* restaurant is taking
	 * bookings today. A diner must clear both.
	 *
	 * Staff surfaces are deliberately untouched. A manager still has to see and
	 * manage the bookings they already have after the switch goes off — hiding
	 * those would strand real guests with nobody able to look them up.
	 */
	RESERVATIONS: "reservations",
} as const;

export type FeatureFlagKey = (typeof FEATURE_FLAGS)[keyof typeof FEATURE_FLAGS];

/**
 * Human-readable metadata for each registered flag.
 * The admin UI reads descriptions from here so code stays the source of truth.
 */
export const FEATURE_FLAG_METADATA: Record<FeatureFlagKey, { description: string }> = {
	[FEATURE_FLAGS.SOFT_DELETE_PURGE_DELAY_DAYS]: {
		description:
			"Retention window (in days) before soft-deleted sections and tables are permanently hard-deleted by the cron sweep. Set numericValue on the flag and enable it to override; otherwise the system default applies.",
	},
	[FEATURE_FLAGS.RESERVATIONS]: {
		description:
			"Platform-wide switch for diner-facing reservations: the Reserve tab, /r/:slug/reserve, " +
			"reservations.create, and the WhatsApp assistant's booking path. OFF hides and refuses all " +
			"four for every restaurant. ON hands control back to each restaurant's own " +
			"'accepting reservations' setting. The staff reservations dashboard is never affected — " +
			"existing bookings still have to be manageable after the switch goes off.",
	},
	[FEATURE_FLAGS.WHATSAPP_MENU_LINK]: {
		description:
			"Lets the WhatsApp assistant send diners a link to the menu page. Keep OFF until /r/:slug/:lang/menu renders for a signed-out visitor: today the customer layout shows a Clerk sign-in wall instead, so a diner messaging from home taps the link and lands on a sign-up form rather than on prices.",
	},
};

/**
 * Default retention window for soft-deleted sections/tables when the
 * `softDeletePurgeDelayDays` flag is unset or disabled.
 */
export const DEFAULT_SOFT_DELETE_PURGE_DELAY_DAYS = 2;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Resolve the configured soft-delete retention window in milliseconds.
 * Reads the `softDeletePurgeDelayDays` feature flag, falling back to the
 * default when unset, disabled, or non-positive.
 */
export async function getSoftDeletePurgeDelayMs(ctx: QueryCtx | MutationCtx): Promise<number> {
	const flag = await ctx.db
		.query("featureFlags")
		.withIndex("by_key", (q) => q.eq("key", FEATURE_FLAGS.SOFT_DELETE_PURGE_DELAY_DAYS))
		.first();
	const configured =
		flag?.enabled === true && typeof flag.numericValue === "number" && flag.numericValue > 0
			? flag.numericValue
			: DEFAULT_SOFT_DELETE_PURGE_DELAY_DAYS;
	return configured * MS_PER_DAY;
}

/**
 * May the WhatsApp assistant hand a diner a link to the menu page?
 *
 * Default **false**, and the default is the point. The link itself is sound —
 * `/r/:slug/:lang/menu` is the only surface that lists items with prices, and it
 * needs no table — but the customer layout (`src/routes/r/$slug.tsx`) renders a
 * Clerk sign-in wall in front of every child route whenever `!isSignedIn`. A
 * diner messaging from their sofa therefore taps the link and lands on a
 * sign-up form, which is exactly the "link that looks broken to someone at
 * home" TAVLI-94 forbids shipping.
 *
 * The gate is deliberately a runtime flag rather than a code change: whether the
 * menu becomes publicly browsable (and what ordering does for a signed-out
 * visitor) is a product decision, and the assistant should start offering the
 * link the moment that decision lands — without a redeploy. Flip this on only
 * after a signed-out browser can reach the menu.
 *
 * What that costs, since the flag is worthless until someone pays it: the wall
 * is **frontend-only**. Every query the menu page reads — `restaurants.getBySlug`,
 * `menus.getMenusByRestaurant`, `menus.getCategoriesByMenu`, `menuItems.getByMenu`
 * — already answers an unauthenticated caller; only `sessions.create` requires a
 * diner identity, and browsing does not need a session. So lifting the wall is a
 * change to the customer layout (render the menu child for a signed-out visitor
 * with ordering blocked, the way the geofence already blocks it), not a backend
 * one. Until that lands this flag stays off and the assistant sends no link.
 */
export async function isMenuLinkEnabled(ctx: QueryCtx | MutationCtx): Promise<boolean> {
	const flag = await ctx.db
		.query("featureFlags")
		.withIndex("by_key", (q) => q.eq("key", FEATURE_FLAGS.WHATSAPP_MENU_LINK))
		.first();
	return flag?.enabled === true;
}

/**
 * May diners see and use reservations at all?
 *
 * Read as **explicitly seeded**, not as absent-means-false. `seedDefaultFeatureFlags`
 * creates this row ON, so the flag's state is legible in the admin table from
 * day one rather than being an invisible default nobody can point at.
 *
 * The fallback here is `false` to match `isFeatureEnabled`'s contract for a
 * key with no row — which is why the seed matters: a deployment that never
 * runs it has reservations dark, and that is a deliberate dark-launch posture,
 * not an accident. Flip it in `/admin/feature-flags` when ready.
 */
export async function isReservationsEnabled(ctx: {
	// Narrower than `QueryCtx | MutationCtx` on purpose: this reads one row and
	// nothing else, and the reservation-create path threads a db-only context.
	// Demanding the full ctx would force callers to widen theirs for no reason.
	db: Pick<QueryCtx["db"], "query">;
}): Promise<boolean> {
	const flag = await ctx.db
		.query("featureFlags")
		.withIndex("by_key", (q) => q.eq("key", FEATURE_FLAGS.RESERVATIONS))
		.first();
	return flag?.enabled === true;
}

const REGISTERED_FLAG_KEYS = new Set<string>(Object.values(FEATURE_FLAGS));

/**
 * Returns true when the given key is registered in FEATURE_FLAGS.
 * Use this to keep the registry as the single source of truth for which
 * flags exist, even when callers pass arbitrary strings.
 */
export function isRegisteredFlagKey(key: string): key is FeatureFlagKey {
	return REGISTERED_FLAG_KEYS.has(key);
}

function unregisteredFlagKeyError(key: string): UserInputValidationError {
	return new UserInputValidationError({
		fields: [
			{
				field: "key",
				message: `Feature flag "${key}" is not registered. Add it to FEATURE_FLAGS in convex/featureFlags.ts.`,
			},
		],
	});
}

// ============================================================================
// Queries
// ============================================================================

/**
 * Get a single feature flag by key.
 */
export const getFeatureFlag = query({
	args: { key: v.string() },
	handler: async (ctx, args) => {
		return await ctx.db
			.query("featureFlags")
			.withIndex("by_key", (q) => q.eq("key", args.key))
			.first();
	},
});

/**
 * Check if a feature flag is enabled.
 * Returns false if the flag doesn't exist.
 */
export const isFeatureEnabled = query({
	args: { key: v.string() },
	handler: async (ctx, args) => {
		const flag = await ctx.db
			.query("featureFlags")
			.withIndex("by_key", (q) => q.eq("key", args.key))
			.first();
		return flag?.enabled ?? false;
	},
});

/**
 * Get all feature flags (admin only).
 *
 * Admin-gated because it enumerates the whole registry -- including each flag's
 * `description`, which names unreleased work. `getFeatureFlag` and
 * `isFeatureEnabled` above stay anonymous on purpose: the app evaluates flags on
 * every render, and a keyed lookup tells a caller nothing it did not already
 * name. Only the admin flags table calls this.
 */
export const getAllFeatureFlags = query({
	handler: async (ctx) => {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) {
			throw error;
		}
		const [_, error2] = await requireAdminRole(ctx, userId);
		if (error2) {
			throw error2;
		}

		return await ctx.db.query("featureFlags").collect();
	},
});

// ============================================================================
// Mutations
// ============================================================================

/**
 * Create or update a feature flag (admin only).
 */
export const setFeatureFlag = mutation({
	args: {
		key: v.string(),
		enabled: v.boolean(),
		numericValue: v.optional(v.number()),
		description: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) {
			throw error;
		}
		const [_, error2] = await requireAdminRole(ctx, userId);
		if (error2) {
			throw error2;
		}

		if (!isRegisteredFlagKey(args.key)) {
			throw unregisteredFlagKeyError(args.key);
		}

		const now = Date.now();

		const existing = await ctx.db
			.query("featureFlags")
			.withIndex("by_key", (q) => q.eq("key", args.key))
			.first();

		if (existing) {
			await ctx.db.patch(existing._id, {
				enabled: args.enabled,
				numericValue: args.numericValue ?? existing.numericValue,
				description: args.description ?? existing.description,
				updatedAt: now,
				updatedBy: userId,
			});
			return existing._id;
		}

		return await ctx.db.insert("featureFlags", {
			key: args.key,
			enabled: args.enabled,
			numericValue: args.numericValue,
			description: args.description,
			createdAt: now,
			updatedAt: now,
			updatedBy: userId,
		});
	},
});

/**
 * Delete a feature flag (admin only).
 */

export const deleteFeatureFlag = mutation({
	args: { key: v.string() },
	handler: async function (ctx, args): AsyncReturn<Id<"featureFlags">, DeleteFeatureFlagErrors> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) {
			return [null, error];
		}
		const [_, error2] = await requireAdminRole(ctx, userId);
		if (error2) {
			return [null, error2];
		}

		if (!isRegisteredFlagKey(args.key)) {
			return [null, unregisteredFlagKeyError(args.key).toObject()];
		}

		const flag = await ctx.db
			.query("featureFlags")
			.withIndex("by_key", (q) => q.eq("key", args.key))
			.first();

		if (!flag) {
			return [null, new NotFoundError("Feature flag not found").toObject()];
		}

		await ctx.db.delete(flag._id);
		return [flag._id, null];
	},
});

/**
 * Seed default feature flags.
 * This is idempotent - it only creates flags that don't exist.
 */
export const seedDefaultFeatureFlags = mutation({
	handler: async (ctx) => {
		const now = Date.now();
		const results = { created: 0, skipped: 0 };

		const defaultFlags: Array<{ key: string; enabled: boolean; description: string }> = [
			{
				key: FEATURE_FLAGS.RESERVATIONS,
				// Seeded ON so an existing deployment does not lose a live feature
				// the moment this ships. A fresh deployment that never runs the
				// seed has it off, which is the intended dark-launch posture.
				enabled: true,
				description: FEATURE_FLAG_METADATA[FEATURE_FLAGS.RESERVATIONS].description,
			},
		];

		for (const flag of defaultFlags) {
			const existing = await ctx.db
				.query("featureFlags")
				.withIndex("by_key", (q) => q.eq("key", flag.key))
				.first();

			if (existing) {
				results.skipped++;
			} else {
				await ctx.db.insert("featureFlags", {
					...flag,
					createdAt: now,
					updatedAt: now,
				});
				results.created++;
			}
		}

		return results;
	},
});
