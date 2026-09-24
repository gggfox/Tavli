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
	BRANDING: "branding",
	HOURS: "hours",
	ORDERS: "orders",
	LOCATION: "location",
	TAX: "tax",
	ORGANIZATION: "organization",
} as const;

export type RestaurantSettingsSection =
	(typeof RESTAURANT_SETTINGS_SECTION)[keyof typeof RESTAURANT_SETTINGS_SECTION];

/**
 * Every entry in the settings navigation, in display order within its group.
 * A superset of `RESTAURANT_SETTINGS_SECTION`: WhatsApp, tables, payments and
 * managers act immediately (no section save), so they have no save key but
 * still need a place in the index and a `?section=` deep link.
 */
export const RESTAURANT_SETTINGS_NAV = {
	GENERAL: "general",
	LOCATION: "location",
	HOURS: "hours",
	PUBLIC_PROFILE: "publicProfile",
	BRANDING: "branding",
	ORDERS: "orders",
	WHATSAPP: "whatsapp",
	TABLES: "tables",
	TAX: "tax",
	PAYMENTS: "payments",
	MANAGERS: "managers",
	ORGANIZATION: "organization",
} as const;

export type RestaurantSettingsNavId =
	(typeof RESTAURANT_SETTINGS_NAV)[keyof typeof RESTAURANT_SETTINGS_NAV];

const SETTINGS_NAV_IDS: ReadonlySet<string> = new Set(Object.values(RESTAURANT_SETTINGS_NAV));

export function isRestaurantSettingsNavId(value: unknown): value is RestaurantSettingsNavId {
	return typeof value === "string" && SETTINGS_NAV_IDS.has(value);
}
