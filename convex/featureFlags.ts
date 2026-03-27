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
} from "./_shared/errors";
import { AsyncReturn } from "./_shared/types";
import { getCurrentUserId, requireAdminRole } from "./_util/auth";

// ============================================================================
// Error Types
// ============================================================================

type DeleteFeatureFlagErrors =
	| NotAuthenticatedErrorObject
	| NotAuthorizedErrorObject
	| NotFoundErrorObject;

// ============================================================================
// Feature Flag Keys
// ============================================================================

/**
 * Available feature flag keys.
 * Add new feature flags here as constants for type safety.
 */
export const FEATURE_FLAGS = {} as const;

export type FeatureFlagKey = (typeof FEATURE_FLAGS)[keyof typeof FEATURE_FLAGS];

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

		const now = Date.now();

		// Check if flag already exists
		const existing = await ctx.db
			.query("featureFlags")
			.withIndex("by_key", (q) => q.eq("key", args.key))
			.first();

		if (existing) {
			// Update existing flag
			await ctx.db.patch(existing._id, {
				enabled: args.enabled,
				description: args.description ?? existing.description,
				updatedAt: now,
			});
			return existing._id;
		}

		// Create new flag
		return await ctx.db.insert("featureFlags", {
			key: args.key,
			enabled: args.enabled,
			description: args.description,
			createdAt: now,
			updatedAt: now,
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
