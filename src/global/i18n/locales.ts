/**
 * Language codes enum
 */
export const Languages = {
	EN: "en",
	ES: "es",
} as const;

export type Language = (typeof Languages)[keyof typeof Languages];

/**
 * Translation keys enum for sidebar
 */
export const SidebarKeys = {
	// Brand
	BRAND_NAME: "sidebar.brand.name",

	// Sidebar controls
	COLLAPSE_SIDEBAR: "sidebar.controls.collapse",
	EXPAND_SIDEBAR: "sidebar.controls.expand",

	// Navigation
	HOME: "sidebar.nav.home",
	RESTAURANTS: "sidebar.nav.restaurants",
	RESTAURANT: "sidebar.nav.restaurant",
	TABLES: "sidebar.nav.tables",
	MENUS: "sidebar.nav.menus",
	OPTIONS: "sidebar.nav.options",
	ORDERS: "sidebar.nav.orders",
	PAYMENTS: "sidebar.nav.payments",
	PRODUCTS: "sidebar.nav.products",
	STOREFRONT: "sidebar.nav.storefront",
	ADMIN: "sidebar.nav.admin",
	ADMIN_USERS: "sidebar.nav.adminUsers",
	ADMIN_ORGANIZATIONS: "sidebar.nav.adminOrganizations",

	// Theme
	DARK_MODE: "sidebar.theme.darkMode",
	LIGHT_MODE: "sidebar.theme.lightMode",
	SWITCH_TO: "sidebar.theme.switchTo",

	// Language
	SELECT_LANGUAGE: "sidebar.language.selectLanguage",
	ENGLISH: "sidebar.language.english",
	SPANISH: "sidebar.language.spanish",

	// Auth
	SIGN_IN: "sidebar.auth.signIn",
	SIGN_UP: "sidebar.auth.signUp",
	SIGN_OUT: "sidebar.auth.signOut",
	CLICK_TO_SIGN_OUT: "sidebar.auth.clickToSignOut",
	AUTH_NOT_CONFIGURED: "sidebar.auth.notConfigured",

	// Settings
	SETTINGS: "sidebar.settings.title",
	CLOSE: "sidebar.settings.close",
	THEME: "sidebar.settings.theme",
	ROLES: "sidebar.settings.roles",
	NO_ROLES: "sidebar.settings.noRoles",
	DEV_TOOLS: "sidebar.settings.devTools",
	SWITCH_ROLES: "sidebar.settings.switchRoles",
	SELF_ASSIGN_ADMIN: "sidebar.settings.selfAssignAdmin",
	ADMIN_ALREADY_ASSIGNED: "sidebar.settings.adminAlreadyAssigned",
	ASSIGNING_ADMIN: "sidebar.settings.assigningAdmin",
} as const;

export type SidebarKey = (typeof SidebarKeys)[keyof typeof SidebarKeys];

/**
 * Translation keys for role names
 */
export const RoleKeys = {
	ADMIN: "roles.admin",
	OWNER: "roles.owner",
	MANAGER: "roles.manager",
	CUSTOMER: "roles.customer",
	EMPLOYEE: "roles.employee",
} as const;

export type RoleKey = (typeof RoleKeys)[keyof typeof RoleKeys];
