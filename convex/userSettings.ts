import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { getCurrentUserId } from "./_util/auth";
import { TABLE } from "./constants";
import { stampUpdated } from "./_util/audit";

/**
 * Order statuses the dashboard is allowed to filter by.
 * `draft` is excluded because drafts are pre-submission and never belong
 * on the kitchen dashboard.
 */
const orderDashboardStatusValidator = v.union(
	v.literal("submitted"),
	v.literal("preparing"),
	v.literal("ready"),
	v.literal("served"),
	v.literal("cancelled")
);

/** Prep stations the dashboard can filter by — see ADR 005. */
const orderDashboardPrepStationValidator = v.union(
	v.literal("kitchen"),
	v.literal("bar")
);

type OrderDashboardStatus = "submitted" | "preparing" | "ready" | "served" | "cancelled";
type OrderDashboardPrepStation = "kitchen" | "bar";

type SettingsUpdates = {
	theme?: "light" | "dark";
	sidebarExpanded?: boolean;
	language?: "en" | "es";
	orderDashboardStatusFilters?: OrderDashboardStatus[];
	orderDashboardPrepStationFilters?: OrderDashboardPrepStation[];
	expandedSidebarGroups?: string[];
};

type SettingsDefaults = {
	theme: "light" | "dark";
	sidebarExpanded: boolean;
	language: "en" | "es";
};

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

interface UpsertUserSettingsArgs {
	ctx: MutationCtx;
	userId: string;
	updates: SettingsUpdates;
	defaults: SettingsDefaults;
}
async function upsertUserSettings({
	ctx,
	userId,
	updates,
	defaults,
}: UpsertUserSettingsArgs): Promise<Id<"userSettings">> {
	const existing = await ctx.db
		.query("userSettings")
		.withIndex("by_user", (q) => q.eq("userId", userId))
		.first();

	if (existing) {
		await ctx.db.patch(existing._id, updates);
		return existing._id;
	}

	const newId = await ctx.db.insert("userSettings", {
		userId,
		theme: updates.theme ?? defaults.theme,
		sidebarExpanded: updates.sidebarExpanded ?? defaults.sidebarExpanded,
		language: updates.language ?? defaults.language,
		...(updates.orderDashboardStatusFilters !== undefined && {
			orderDashboardStatusFilters: updates.orderDashboardStatusFilters,
		}),
		...(updates.orderDashboardPrepStationFilters !== undefined && {
			orderDashboardPrepStationFilters: updates.orderDashboardPrepStationFilters,
		}),
		...(updates.expandedSidebarGroups !== undefined && {
			expandedSidebarGroups: updates.expandedSidebarGroups,
		}),
	});

	// Race-condition guard: if a concurrent mutation also inserted a row, keep
	// the oldest and merge our updates into it.
	const allSettings = await ctx.db
		.query("userSettings")
		.withIndex("by_user", (q) => q.eq("userId", userId))
		.collect();

	if (allSettings.length > 1) {
		const sorted = [...allSettings].sort((a, b) => a._id.localeCompare(b._id));
		const recordToKeep = sorted[0];
		const recordsToDelete = sorted.slice(1);

		for (const record of recordsToDelete) {
			await ctx.db.delete(record._id);
		}

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
		return await upsertUserSettings({
			ctx,
			userId,
			updates: { theme: args.theme },
			defaults: { theme: args.theme, sidebarExpanded: true, language: "en" },
		});
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
		return await upsertUserSettings({
			ctx,
			userId,
			updates: { sidebarExpanded: args.sidebarExpanded },
			defaults: { theme: "light", sidebarExpanded: args.sidebarExpanded, language: "en" },
		});
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
		return await upsertUserSettings({
			ctx,
			userId,
			updates: { language: args.language },
			defaults: { theme: "light", sidebarExpanded: true, language: args.language },
		});
	},
});

/**
 * Update the OrderDashboard status filters for the authenticated user.
 * Creates settings if they don't exist.
 *
 * An empty array is a valid value (means "show no statuses"). The mutation
 * dedupes the input so the persisted value stays minimal.
 */
export const updateOrderDashboardStatusFilters = mutation({
	args: {
		statuses: v.array(orderDashboardStatusValidator),
	},
	handler: async (ctx, args) => {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) {
			throw error;
		}
		const deduped = Array.from(new Set(args.statuses)) as OrderDashboardStatus[];
		return await upsertUserSettings({
			ctx,
			userId,
			updates: { orderDashboardStatusFilters: deduped },
			defaults: { theme: "light", sidebarExpanded: true, language: "en" },
		});
	},
});

/**
 * Update the OrderDashboard prep-station filters for the authenticated user.
 * Creates settings if they don't exist.
 *
 * An empty array means "no station filter applied" (= show all stations) —
 * matches the existing pattern of `updateOrderDashboardStatusFilters`.
 * The mutation dedupes the input so the persisted value stays minimal.
 */
export const updateOrderDashboardPrepStationFilters = mutation({
	args: {
		prepStations: v.array(orderDashboardPrepStationValidator),
	},
	handler: async (ctx, args) => {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) {
			throw error;
		}
		const deduped = Array.from(new Set(args.prepStations)) as OrderDashboardPrepStation[];
		return await upsertUserSettings({
			ctx,
			userId,
			updates: { orderDashboardPrepStationFilters: deduped },
			defaults: { theme: "light", sidebarExpanded: true, language: "en" },
		});
	},
});

/**
 * Toggle membership of a sidebar group in the user's persisted
 * `expandedSidebarGroups` set.
 *
 * Per-key semantics (vs. overwriting the whole array) makes concurrent
 * toggles from multiple tabs race-safe: each call only adds or removes
 * the single key it was given.
 */
export const setSidebarGroupExpanded = mutation({
	args: {
		key: v.string(),
		expanded: v.boolean(),
	},
	handler: async (ctx, args) => {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) {
			throw error;
		}
		const existing = await ctx.db
			.query("userSettings")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.first();

		const current = existing?.expandedSidebarGroups ?? [];
		const next = new Set(current);
		if (args.expanded) {
			next.add(args.key);
		} else {
			next.delete(args.key);
		}

		return await upsertUserSettings({
			ctx,
			userId,
			updates: { expandedSidebarGroups: Array.from(next) },
			defaults: { theme: "light", sidebarExpanded: true, language: "en" },
		});
	},
});

// ============================================================================
// Avatar sync + upload (ADR 006 — Clerk avatar + custom photo)
// ============================================================================

export const syncClerkAvatar = mutation({
	args: { clerkImageUrl: v.string() },
	handler: async (ctx, args) => {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) throw error;

		const row = await ctx.db
			.query(TABLE.USER_ROLES)
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.first();
		if (!row) return;
		if (row.clerkImageUrl === args.clerkImageUrl) return;

		await ctx.db.patch(row._id, {
			clerkImageUrl: args.clerkImageUrl,
			...stampUpdated(userId),
		});
	},
});

export const generateUserPhotoUploadUrl = mutation({
	args: {},
	handler: async (ctx) => {
		const [, error] = await getCurrentUserId(ctx);
		if (error) throw error;
		return await ctx.storage.generateUploadUrl();
	},
});

export const setUserPhoto = mutation({
	args: {
		photoStorageId: v.id("_storage"),
		targetUserId: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const [actorId, error] = await getCurrentUserId(ctx);
		if (error) throw error;

		const targetId = args.targetUserId ?? actorId;

		const row = await ctx.db
			.query(TABLE.USER_ROLES)
			.withIndex("by_user", (q) => q.eq("userId", targetId))
			.first();
		if (!row) return;

		await ctx.db.patch(row._id, {
			photoStorageId: args.photoStorageId,
			...stampUpdated(actorId),
		});
	},
});
