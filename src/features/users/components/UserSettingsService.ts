/**
 * UserSettingsService - Simple service for User Settings
 *
 * This service provides mutation operations for user settings.
 * Query/subscription logic is handled by useUserSettings hook with convexQuery
 * for real-time sync via TanStack Query.
 */
import type { Language } from "@/global/i18n";
import { api } from "convex/_generated/api";
import type { UserSettingsDoc, UserSettingsId } from "convex/constants";
import type { ConvexReactClient } from "convex/react";

// ============================================================================
// Domain Types - Derived from Convex schema (single source of truth)
// ============================================================================

/**
 * UserSettings type derived from Convex schema.
 * The Convex schema in convex/schema.ts is the single source of truth.
 */
export type UserSettings = UserSettingsDoc;

/**
 * Theme type
 */
export type Theme = "light" | "dark";

/**
 * Language type - re-exported from i18n
 */
export type { Language } from "@/global/i18n";

/**
 * Statuses the OrderDashboard is allowed to filter by. Mirrors the validator
 * in convex/userSettings.ts -- `draft` is excluded because drafts never appear
 * on the dashboard.
 */
export type OrderDashboardStatusFilter =
	| "submitted"
	| "preparing"
	| "ready"
	| "served"
	| "cancelled";

/**
 * Prep stations the OrderDashboard is allowed to filter by. Mirrors the
 * validator in convex/userSettings.ts and the PREP_STATION constant in
 * convex/constants.ts.
 */
export type OrderDashboardPrepStationFilter = "kitchen" | "bar";

/**
 * Transform raw Convex user settings to domain UserSettings.
 * Currently an identity function, but provides a hook for
 * future domain transformations if needed.
 */
export const transformUserSettings = (raw: UserSettingsDoc): UserSettings => raw;

// ============================================================================
// Error Types
// ============================================================================

export class UserSettingsError {
	readonly _tag = "UserSettingsError";
	constructor(
		readonly operation:
			| "updateTheme"
			| "updateSidebarExpanded"
			| "updateLanguage"
			| "updateOrderDashboardStatusFilters"
			| "updateOrderDashboardPrepStationFilters"
			| "setSidebarGroupExpanded",
		readonly cause: unknown
	) {}
}

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Update the user's theme preference
 * @returns The ID of the updated settings document
 */
export async function updateTheme(
	client: ConvexReactClient,
	theme: Theme
): Promise<UserSettingsId> {
	try {
		return await client.mutation(api.userSettings.updateTheme, { theme });
	} catch (error) {
		throw new UserSettingsError("updateTheme", error);
	}
}

/**
 * Update the user's sidebar expanded state
 * @returns The ID of the updated settings document
 */
export async function updateSidebarExpanded(
	client: ConvexReactClient,
	expanded: boolean
): Promise<UserSettingsId> {
	try {
		return await client.mutation(api.userSettings.updateSidebarExpanded, {
			sidebarExpanded: expanded,
		});
	} catch (error) {
		throw new UserSettingsError("updateSidebarExpanded", error);
	}
}

/**
 * Update the user's language preference
 * @returns The ID of the updated settings document
 */
export async function updateLanguage(
	client: ConvexReactClient,
	language: Language
): Promise<UserSettingsId> {
	try {
		return await client.mutation(api.userSettings.updateLanguage, { language });
	} catch (error) {
		throw new UserSettingsError("updateLanguage", error);
	}
}

/**
 * Update the OrderDashboard status filters for the authenticated user.
 * Persisting these means the user's filter choices follow them across
 * devices.
 * @returns The ID of the updated settings document
 */
export async function updateOrderDashboardStatusFilters(
	client: ConvexReactClient,
	statuses: OrderDashboardStatusFilter[]
): Promise<UserSettingsId> {
	try {
		return await client.mutation(api.userSettings.updateOrderDashboardStatusFilters, {
			statuses,
		});
	} catch (error) {
		throw new UserSettingsError("updateOrderDashboardStatusFilters", error);
	}
}

/**
 * Update the OrderDashboard prep-station filters for the authenticated user.
 * Empty array = no station filter (= show all stations). See ADR 005.
 * @returns The ID of the updated settings document
 */
export async function updateOrderDashboardPrepStationFilters(
	client: ConvexReactClient,
	prepStations: OrderDashboardPrepStationFilter[]
): Promise<UserSettingsId> {
	try {
		return await client.mutation(api.userSettings.updateOrderDashboardPrepStationFilters, {
			prepStations,
		});
	} catch (error) {
		throw new UserSettingsError("updateOrderDashboardPrepStationFilters", error);
	}
}

/**
 * Toggle membership of a sidebar accordion group in the user's persisted
 * `expandedSidebarGroups` set. Per-key semantics make concurrent toggles
 * across tabs race-safe.
 * @returns The ID of the updated settings document
 */
export async function setSidebarGroupExpanded(
	client: ConvexReactClient,
	key: string,
	expanded: boolean
): Promise<UserSettingsId> {
	try {
		return await client.mutation(api.userSettings.setSidebarGroupExpanded, {
			key,
			expanded,
		});
	} catch (error) {
		throw new UserSettingsError("setSidebarGroupExpanded", error);
	}
}
