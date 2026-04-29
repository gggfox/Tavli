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
	RESERVATIONS: "sidebar.nav.reservations",
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
 * Cross-feature translation keys for shared primitives like the Button
 * component. Add a new key here whenever a generic UI element ships a
 * default label that benefits from localization.
 */
export const CommonKeys = {
	BUTTON_SAVED: "common.button.saved",
	BUTTON_FAILED: "common.button.failed",
	BUTTON_SAVING: "common.button.saving",
} as const;

export type CommonKey = (typeof CommonKeys)[keyof typeof CommonKeys];

/**
 * Translation keys for the public-facing customer experience at /r/$slug.
 */
export const CustomerKeys = {
	MENU: "customer.nav.menu",
	RESERVE: "customer.nav.reserve",
	SIGN_UP: "customer.auth.signUp",
} as const;

export type CustomerKey = (typeof CustomerKeys)[keyof typeof CustomerKeys];

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

/**
 * Translation keys for the staff-facing reservation settings panel.
 */
export const ReservationSettingsKeys = {
	// Field descriptions (info tooltips)
	DESC_ACCEPTING: "reservationSettings.fieldDescriptions.accepting",
	DESC_DEFAULT_TURN: "reservationSettings.fieldDescriptions.defaultTurn",
	DESC_MIN_ADVANCE: "reservationSettings.fieldDescriptions.minAdvance",
	DESC_MAX_ADVANCE: "reservationSettings.fieldDescriptions.maxAdvance",
	DESC_NO_SHOW_GRACE: "reservationSettings.fieldDescriptions.noShowGrace",
	DESC_TURN_RANGES: "reservationSettings.fieldDescriptions.turnRanges",
	DESC_BLACKOUTS: "reservationSettings.fieldDescriptions.blackouts",

	// Field labels
	LABEL_ACCEPTING: "reservationSettings.labels.accepting",
	LABEL_DEFAULT_TURN: "reservationSettings.labels.defaultTurn",
	LABEL_MIN_ADVANCE: "reservationSettings.labels.minAdvance",
	LABEL_MAX_ADVANCE: "reservationSettings.labels.maxAdvance",
	LABEL_NO_SHOW_GRACE: "reservationSettings.labels.noShowGrace",
	LABEL_TURN_RANGES: "reservationSettings.labels.turnRanges",
	LABEL_BLACKOUTS: "reservationSettings.labels.blackouts",
	LABEL_MIN_PARTY: "reservationSettings.labels.minParty",
	LABEL_MAX_PARTY: "reservationSettings.labels.maxParty",
	LABEL_TURN_MINUTES: "reservationSettings.labels.turnMinutes",
	LABEL_STARTS_AT: "reservationSettings.labels.startsAt",
	LABEL_ENDS_AT: "reservationSettings.labels.endsAt",
	LABEL_REASON: "reservationSettings.labels.reason",

	// Actions
	ACTION_ADD_RANGE: "reservationSettings.actions.addRange",
	ACTION_ADD_WINDOW: "reservationSettings.actions.addWindow",
	ACTION_SAVE: "reservationSettings.actions.save",
	ACTION_REMOVE: "reservationSettings.actions.remove",
	ACTION_MORE_INFO: "reservationSettings.actions.moreInfo",

	// Status messages
	MSG_SAVED: "reservationSettings.messages.saved",
	MSG_SAVE_FAILED: "reservationSettings.messages.saveFailed",
	MSG_USING_DEFAULTS: "reservationSettings.messages.usingDefaults",
	MSG_RANGE_FALLBACK: "reservationSettings.messages.rangeFallback",
} as const;

export type ReservationSettingsKey =
	(typeof ReservationSettingsKeys)[keyof typeof ReservationSettingsKeys];
