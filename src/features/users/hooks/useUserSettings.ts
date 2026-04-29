/**
 * useUserSettings - Hook for user settings with Convex real-time sync
 *
 * This hook combines:
 * - Convex's real-time sync engine (via convexQuery) for queries
 * - Direct Convex mutations
 * - TanStack Query's caching and suspense
 *
 * Mutation wrappers (`updateTheme`, `updateLanguage`, etc.) throw on
 * failure. Callers wrap with try/catch or pass them to React Query's
 * mutation surface — the wrapper layer no longer dresses up errors as
 * `{success, error}` results.
 */
import { OrderDashboardStatusFilter, Theme, UserSettings } from "@/features";
import {
	transformUserSettings,
	updateLanguage as updateLanguageService,
	updateOrderDashboardStatusFilters as updateOrderDashboardStatusFiltersService,
	updateSidebarExpanded as updateSidebarExpandedService,
	updateTheme as updateThemeService,
} from "@/features/users/components/UserSettingsService";
import { i18n } from "@/global";
import type { Language } from "@/global/i18n";
import { Languages } from "@/global/i18n";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { UserSettingsId } from "convex/constants";
import { useConvex, useConvexAuth } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ============================================================================
// Types
// ============================================================================

export type UseUserSettingsReturn = {
	settings: UserSettings | null;
	theme: Theme;
	sidebarExpanded: boolean;
	language: Language;
	/**
	 * Persisted OrderDashboard filter selection. `null` means the user has
	 * never set it -- callers should fall back to a sensible default (typically
	 * the active-status set).
	 */
	orderDashboardStatusFilters: OrderDashboardStatusFilter[] | null;
	updateTheme: (theme: Theme) => Promise<UserSettingsId>;
	updateSidebarExpanded: (expanded: boolean) => Promise<UserSettingsId>;
	updateLanguage: (language: Language) => Promise<UserSettingsId>;
	updateOrderDashboardStatusFilters: (
		statuses: OrderDashboardStatusFilter[]
	) => Promise<UserSettingsId>;
};

// Re-export UserSettingsError for consumers
export { UserSettingsError } from "../components/UserSettingsService";

// ============================================================================
// useUserSettings Hook
// ============================================================================

/**
 * Main hook for accessing user settings
 *
 * Features:
 * - Real-time updates via Convex sync engine
 * - Type-safe mutations (throw on failure; wrap with try/catch)
 * - Default values when settings don't exist
 *
 * @example
 * ```tsx
 * function ThemeToggle() {
 *   const { theme, updateTheme } = useUserSettings()
 *
 *   const handleToggle = async () => {
 *     const newTheme = theme === "light" ? "dark" : "light"
 *     try {
 *       const id = await updateTheme(newTheme)
 *       console.log('Theme updated:', id)
 *     } catch (error) {
 *       console.error('Failed to update theme', error)
 *     }
 *   }
 *
 *   return (...)
 * }
 * ```
 */
export function useUserSettings(): UseUserSettingsReturn {
	const client = useConvex();
	const { isAuthenticated } = useConvexAuth();

	// Use convexQuery for real-time subscriptions
	// This maintains Convex's sync engine for live updates
	// Only query when authenticated to avoid errors
	const { data: rawSettings } = useQuery({
		...convexQuery(api.userSettings.get, {}),
		enabled: isAuthenticated,
	});

	// Transform raw data to domain model
	// Only transform if it's a full Convex document (has _id)
	// Otherwise it's a default object and we return null to use defaults
	const settings = useMemo<UserSettings | null>(() => {
		if (!rawSettings) return null;
		// Check if it's a full Convex document (has _id and _creationTime)
		if ("_id" in rawSettings && "_creationTime" in rawSettings) {
			return transformUserSettings(rawSettings);
		}
		// It's a default object, return null to use hook defaults
		return null;
	}, [rawSettings]);

	// Extract theme with default
	const theme = useMemo<Theme>(() => settings?.theme ?? "light", [settings]);

	// Extract sidebar expanded state with default
	const sidebarExpanded = useMemo(() => settings?.sidebarExpanded ?? true, [settings]);

	// Persisted OrderDashboard filters (null when never set, so callers can
	// distinguish "not set" from "explicitly empty").
	const orderDashboardStatusFilters = useMemo<OrderDashboardStatusFilter[] | null>(
		() => settings?.orderDashboardStatusFilters ?? null,
		[settings]
	);

	// Extract language with default
	// Use i18n's current language as fallback to ensure UI reflects actual language
	// Normalize i18n language to supported codes (e.g., "en-US" -> "en", "es-ES" -> "es")
	const getNormalizedLanguage = useCallback((lang: string): Language => {
		return lang.startsWith("es") ? Languages.ES : Languages.EN;
	}, []);

	const languageFromSettings = useMemo<Language | null>(
		() => settings?.language ?? null,
		[settings]
	);

	// Track current i18n language to keep UI in sync
	const [currentI18nLanguage, setCurrentI18nLanguage] = useState<Language>(() =>
		getNormalizedLanguage(i18n.language || "en")
	);

	// Update current language when i18n changes
	useEffect(() => {
		const handleLanguageChange = (lng: string) => {
			setCurrentI18nLanguage(getNormalizedLanguage(lng));
		};

		// Set initial value
		setCurrentI18nLanguage(getNormalizedLanguage(i18n.language || "en"));

		// Listen for i18n language changes
		i18n.on("languageChanged", handleLanguageChange);

		return () => {
			i18n.off("languageChanged", handleLanguageChange);
		};
	}, [getNormalizedLanguage]);

	// Use settings language if available, otherwise use current i18n language
	const language = useMemo<Language>(
		() => languageFromSettings ?? currentI18nLanguage,
		[languageFromSettings, currentI18nLanguage]
	);

	const updateTheme = useCallback(
		(newTheme: Theme) => updateThemeService(client, newTheme),
		[client]
	);

	const updateSidebarExpanded = useCallback(
		(expanded: boolean) => updateSidebarExpandedService(client, expanded),
		[client]
	);

	const updateLanguage = useCallback(
		async (newLanguage: Language) => {
			const result = await updateLanguageService(client, newLanguage);
			i18n.changeLanguage(newLanguage);
			return result;
		},
		[client]
	);

	const updateOrderDashboardStatusFilters = useCallback(
		(statuses: OrderDashboardStatusFilter[]) =>
			updateOrderDashboardStatusFiltersService(client, statuses),
		[client]
	);

	// Sync i18n language when settings change (for initial load and real-time updates)
	useEffect(() => {
		if (settings?.language && i18n.language !== settings.language) {
			i18n.changeLanguage(settings.language);
		}
	}, [settings?.language]);

	// Detect and save browser language on first login
	// This runs when user is authenticated but has no settings yet
	const hasInitializedLanguage = useRef(false);
	useEffect(() => {
		// Only run if:
		// 1. User is authenticated
		// 2. Settings don't exist (first login)
		// 3. We haven't already attempted initialization
		// 4. i18n has detected a language
		if (isAuthenticated && settings === null && !hasInitializedLanguage.current && i18n.language) {
			// Get the detected language from i18n (already detected from browser)
			const detectedLanguage = i18n.language;

			// Normalize to supported language codes (handle cases like "en-US" -> "en", "es-ES" -> "es")
			const normalizedLanguage = detectedLanguage.startsWith("es") ? Languages.ES : Languages.EN;

			// Only save if it's Spanish (different from the default "en")
			// This avoids unnecessary writes when browser language is already "en"
			if (normalizedLanguage === Languages.ES) {
				hasInitializedLanguage.current = true;
				updateLanguage(normalizedLanguage).catch((error) => {
					console.error("Failed to initialize language from browser:", error);
					hasInitializedLanguage.current = false;
				});
			} else {
				hasInitializedLanguage.current = true;
			}
		}

		// Reset initialization flag when user logs out or settings are created
		if (!isAuthenticated || settings !== null) {
			hasInitializedLanguage.current = false;
		}
	}, [isAuthenticated, settings, updateLanguage]);

	return {
		settings,
		theme,
		sidebarExpanded,
		language,
		orderDashboardStatusFilters,
		updateTheme,
		updateSidebarExpanded,
		updateLanguage,
		updateOrderDashboardStatusFilters,
	};
}
