/** Persisted staff UI: which restaurant admin routes target (menus, orders, etc.). */
export const LOCAL_STORAGE_KEY_ADMIN_SELECTED_RESTAURANT_ID = "tavli-admin-selected-restaurant-id";

/**
 * Persisted staff UI: which organization narrows the admin restaurant scope.
 * An absent key means **All organizations** — the default, and the behavior
 * that predates the organization switcher.
 */
export const LOCAL_STORAGE_KEY_ADMIN_SELECTED_ORGANIZATION_ID =
	"tavli-admin-selected-organization-id";

/**
 * Sections of the full-canvas restaurant settings view. Each section saves
 * independently, so this doubles as the key that tells the shared save hook
 * which section is pending / which one failed.
 */
export const RESTAURANT_SETTINGS_SECTION = {
	GENERAL: "general",
	PUBLIC_PROFILE: "publicProfile",
	HOURS: "hours",
	LOCATION: "location",
	TAX: "tax",
	ORGANIZATION: "organization",
} as const;

export type RestaurantSettingsSection =
	(typeof RESTAURANT_SETTINGS_SECTION)[keyof typeof RESTAURANT_SETTINGS_SECTION];
