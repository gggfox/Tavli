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
	LIVE_AUCTIONS: "sidebar.nav.liveAuctions",
	E_SHOP: "sidebar.nav.eShop",
	LIVE_RFQS: "sidebar.nav.liveRfqs",
	CREATE_RFQ: "sidebar.nav.createRfq",
	MY_ACTIVE_BIDS: "sidebar.nav.myActiveBids",
	ANALYTICS: "sidebar.nav.analytics",
	PURCHASE_HISTORY: "sidebar.nav.purchaseHistory",
	ALERTS: "sidebar.nav.alerts",
	CREATE_MATERIAL_ALERT: "sidebar.nav.createMaterialAlert",
	CREATE_PRICE_ALERT: "sidebar.nav.createPriceAlert",
	SALES_HISTORY: "sidebar.nav.salesHistory",
	LIVE_SALES: "sidebar.nav.liveSales",
	PENDING_MATERIALS: "sidebar.nav.pendingMaterials",
	ADMIN: "sidebar.nav.admin",
	ADMIN_USERS: "sidebar.nav.adminUsers",
	ADMIN_MATERIALS: "sidebar.nav.adminMaterials",
	SERVER_FUNCTIONS: "sidebar.nav.serverFunctions",
	DEMOS: "sidebar.nav.demos",
	API_REQUEST: "sidebar.nav.apiRequest",
	SSR_DEMOS: "sidebar.nav.ssrDemos",
	SPA_MODE: "sidebar.nav.spaMode",
	FULL_SSR: "sidebar.nav.fullSSR",
	DATA_ONLY: "sidebar.nav.dataOnly",

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
} as const;

export type SidebarKey = (typeof SidebarKeys)[keyof typeof SidebarKeys];
