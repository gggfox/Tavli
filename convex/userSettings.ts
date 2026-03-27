import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { getCurrentUserId } from "./_util/auth";

/**
 * Get user settings for the authenticated user.
 * Returns default settings if none exist.
 */
export const get = query({
	args: {},
	handler: async (ctx) => {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) {
			return null;
		}
		const settings = await ctx.db
			.query("userSettings")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.first();

		if (settings) {
			return settings;
		}

		// Return default settings if none exist
		return {
			userId: userId,
			theme: "light" as const,
			sidebarExpanded: true,
			language: "en" as const,
		};
	},
});

/**
 * Upsert helper that safely handles concurrent mutations.
 *
 * This function ensures only one settings record exists per user by:
 * 1. Checking for existing settings
 * 2. If found, patching the existing record
 * 3. If not found, inserting a new record
 * 4. After insert, checking for duplicates (race condition detection)
 * 5. If duplicate found, deleting our insert and using the existing record
 *
 * This pattern works with Convex's optimistic concurrency control to prevent
 * duplicate records even when mutations execute concurrently.
 */
async function upsertUserSettings(
	ctx: MutationCtx,
	userId: string,
	updates: {
		theme?: "light" | "dark";
		sidebarExpanded?: boolean;
		language?: "en" | "es";
	},
	defaults: {
		theme: "light" | "dark";
		sidebarExpanded: boolean;
		language: "en" | "es";
	}
): Promise<Id<"userSettings">> {
	// Step 1: Check for existing settings
	const existing = await ctx.db
		.query("userSettings")
		.withIndex("by_user", (q) => q.eq("userId", userId))
		.first();

	if (existing) {
		// Step 2: Patch existing record
		await ctx.db.patch(existing._id, updates);
		return existing._id;
	}

	// Step 3: Insert new record
	const newId = await ctx.db.insert("userSettings", {
		userId,
		theme: updates.theme ?? defaults.theme,
		sidebarExpanded: updates.sidebarExpanded ?? defaults.sidebarExpanded,
		language: updates.language ?? defaults.language,
	});

	// Step 4: Check for duplicates (race condition detection)
	// If another mutation inserted between our check and insert, we'll find multiple records
	const allSettings = await ctx.db
		.query("userSettings")
		.withIndex("by_user", (q) => q.eq("userId", userId))
		.collect();

	if (allSettings.length > 1) {
		// Step 5: Duplicate detected - keep the oldest record (lowest ID) and delete others
		// Sort by ID to get the oldest record (Convex IDs are ordered by creation time)
		const sorted = [...allSettings].sort((a, b) => a._id.localeCompare(b._id));
		const recordToKeep = sorted[0];
		const recordsToDelete = sorted.slice(1);

		// Delete all duplicate records (including ours if it's not the one we're keeping)
		for (const record of recordsToDelete) {
			await ctx.db.delete(record._id);
		}

		// Patch the record we kept with our updates
		await ctx.db.patch(recordToKeep._id, updates);
		return recordToKeep._id;
	}

	return newId;
}

/**
 * Update theme setting for the authenticated user.
 * Creates settings if they don't exist.
 *
 * Uses upsert pattern to prevent race conditions when multiple mutations
 * execute concurrently for the same user.
 */
export const updateTheme = mutation({
	args: {
		theme: v.union(v.literal("light"), v.literal("dark")),
	},
	handler: async (ctx, args) => {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) {
			throw error;
		}
		return await upsertUserSettings(
			ctx,
			userId,
			{ theme: args.theme },
			{ theme: args.theme, sidebarExpanded: true, language: "en" }
		);
	},
});

/**
 * Update sidebar expanded state for the authenticated user.
 * Creates settings if they don't exist.
 *
 * Uses upsert pattern to prevent race conditions when multiple mutations
 * execute concurrently for the same user.
 */
export const updateSidebarExpanded = mutation({
	args: {
		sidebarExpanded: v.boolean(),
	},
	handler: async (ctx, args) => {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) {
			throw error;
		}
		return await upsertUserSettings(
			ctx,
			userId,
			{ sidebarExpanded: args.sidebarExpanded },
			{ theme: "light", sidebarExpanded: args.sidebarExpanded, language: "en" }
		);
	},
});

/**
 * Update language setting for the authenticated user.
 * Creates settings if they don't exist.
 *
 * Uses upsert pattern to prevent race conditions when multiple mutations
 * execute concurrently for the same user.
 */
export const updateLanguage = mutation({
	args: {
		language: v.union(v.literal("en"), v.literal("es")),
	},
	handler: async (ctx, args) => {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) {
			throw error;
		}
		return await upsertUserSettings(
			ctx,
			userId,
			{ language: args.language },
			{ theme: "light", sidebarExpanded: true, language: args.language }
		);
	},
});
