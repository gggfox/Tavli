/** Persisted staff UI: which restaurant admin routes target (menus, orders, etc.). */
export const LOCAL_STORAGE_KEY_ADMIN_SELECTED_RESTAURANT_ID = "tavli-admin-selected-restaurant-id";

/**
 * Sections of the full-canvas restaurant settings view. Each section saves
 * independently, so this doubles as the key that tells the shared save hook
 * which section is pending / which one failed.
 */
export const RESTAURANT_SETTINGS_SECTION = {
	GENERAL: "general",
	HOURS: "hours",
	LOCATION: "location",
	TAX: "tax",
	ORGANIZATION: "organization",
} as const;

export type RestaurantSettingsSection =
	(typeof RESTAURANT_SETTINGS_SECTION)[keyof typeof RESTAURANT_SETTINGS_SECTION];
