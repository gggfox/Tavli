/**
 * Feature flags management for the application.
 * Allows enabling/disabling features at runtime without code deployments.
 */
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
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
export const FEATURE_FLAGS = {} as const;

export type FeatureFlagKey = (typeof FEATURE_FLAGS)[keyof typeof FEATURE_FLAGS];

/**
 * Human-readable metadata for each registered flag.
 * The admin UI reads descriptions from here so code stays the source of truth.
 */
export const FEATURE_FLAG_METADATA: Record<FeatureFlagKey, { description: string }> =
	{} as Record<FeatureFlagKey, { description: string }>;

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
 * Get all feature flags.
 */
export const getAllFeatureFlags = query({
	handler: async (ctx) => {
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
				description: args.description ?? existing.description,
				updatedAt: now,
				updatedBy: userId,
			});
			return existing._id;
		}

		return await ctx.db.insert("featureFlags", {
			key: args.key,
			enabled: args.enabled,
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

		const defaultFlags: Array<{ key: string; enabled: boolean; description: string }> = [];

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
