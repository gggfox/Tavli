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
	/**
	 * Pluralized "N items" / "1 item". Resolves via i18next's `_one` /
	 * `_other` plural suffixes -- pass `{ count }` as the interpolation arg.
	 */
	ITEMS_COUNT: "common.itemsCount",
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

/**
 * Translation keys for relative-time display ("just now", "5 min ago", ...).
 * Consumed by `getRelativeTime` in `src/global/utils/relativeTime.ts`, which
 * returns a key + interpolation values; the calling component resolves them
 * with `t(key, vars)`.
 */
export const TimeKeys = {
	JUST_NOW: "time.relative.justNow",
	MIN_AGO: "time.relative.minAgo",
	HOUR_AGO: "time.relative.hourAgo",
	DAY_AGO: "time.relative.dayAgo",
} as const;

export type TimeKey = (typeof TimeKeys)[keyof typeof TimeKeys];

/**
 * Translation keys for the staff-facing OrderDashboard (kitchen view).
 * Keys are split into status labels, action buttons, cancellation flow,
 * card metadata, empty states, and ARIA labels.
 *
 * Pluralized keys (e.g. `MORE_ITEMS`) resolve via i18next's `_one` /
 * `_other` suffixes; pass `{ count }` to `t()`.
 */
export const OrdersKeys = {
	STATUS_SUBMITTED: "orders.status.submitted",
	STATUS_PREPARING: "orders.status.preparing",
	STATUS_READY: "orders.status.ready",
	STATUS_SERVED: "orders.status.served",
	STATUS_CANCELLED: "orders.status.cancelled",

	ACTION_ACCEPT: "orders.actions.accept",
	ACTION_MARK_READY: "orders.actions.markReady",
	ACTION_MARK_SERVED: "orders.actions.markServed",
	ACTION_CANCEL: "orders.actions.cancel",
	ACTION_CANCEL_AND_REFUND: "orders.actions.cancelAndRefund",
	ACTION_CONFIRM_CANCEL: "orders.actions.confirmCancel",
	ACTION_KEEP_ORDER: "orders.actions.keepOrder",
	ACTION_VIEW_FULL_ORDER: "orders.actions.viewFullOrder",

	CANCEL_PROMPT: "orders.cancel.prompt",
	CANCEL_PAID_PROMPT: "orders.cancel.paidPrompt",

	CARD_TABLE: "orders.card.table",
	CARD_PAID: "orders.card.paid",
	CARD_MORE_ITEMS: "orders.card.moreItems",

	EMPTY_NO_FILTERS: "orders.empty.noFilters",
	EMPTY_NO_ORDERS: "orders.empty.noOrders",

	ARIA_FILTER: "orders.aria.filter",
	ARIA_FULL_ORDER: "orders.aria.fullOrder",
	ARIA_LOADING: "orders.aria.loading",
} as const;

export type OrdersKey = (typeof OrdersKeys)[keyof typeof OrdersKeys];

/**
 * Translation keys for everything under `src/features/reservations/`:
 * the dashboard, the detail drawer, the customer-facing reservation form,
 * the table picker, and the table-locks manager.
 *
 * `ReservationSettingsKeys` (the staff settings panel) lives separately
 * because it predates this file's per-feature pattern.
 */
export const ReservationsKeys = {
	STATUS_PENDING: "reservations.status.pending",
	STATUS_CONFIRMED: "reservations.status.confirmed",
	STATUS_SEATED: "reservations.status.seated",
	STATUS_COMPLETED: "reservations.status.completed",
	STATUS_CANCELLED: "reservations.status.cancelled",
	STATUS_NO_SHOW: "reservations.status.noShow",

	RANGE_TODAY: "reservations.range.today",
	RANGE_WEEK: "reservations.range.week",
	RANGE_MONTH: "reservations.range.month",
	RANGE_QUARTER: "reservations.range.quarter",
	RANGE_YEAR: "reservations.range.year",
	RANGE_ALL: "reservations.range.all",

	ARIA_FILTER_RANGE: "reservations.aria.filterRange",
	ARIA_FILTER_STATUS: "reservations.aria.filterStatus",
	ARIA_DETAIL_DRAWER: "reservations.aria.detailDrawer",
	ARIA_DETAIL_DRAWER_CLOSE: "reservations.aria.detailDrawerClose",
	ARIA_REMOVE: "reservations.aria.remove",
	ARIA_REMOVE_LOCK: "reservations.aria.removeLock",

	EMPTY_TITLE: "reservations.empty.title",
	EMPTY_DESCRIPTION: "reservations.empty.description",

	DRAWER_PARTY_OF: "reservations.drawer.partyOf",
	DRAWER_VIA: "reservations.drawer.via",
	DRAWER_ASSIGNED_TABLES: "reservations.drawer.assignedTables",
	DRAWER_ASSIGN_TABLES_PROMPT: "reservations.drawer.assignTablesPrompt",
	DRAWER_CANCEL_REASON_LABEL: "reservations.drawer.cancelReasonLabel",

	ACTION_CONFIRM: "reservations.actions.confirm",
	ACTION_MARK_SEATED: "reservations.actions.markSeated",
	ACTION_MARK_COMPLETED: "reservations.actions.markCompleted",
	ACTION_CONFIRM_CANCEL: "reservations.actions.confirmCancel",
	ACTION_BACK: "reservations.actions.back",
	ACTION_CANCEL: "reservations.actions.cancel",

	ERROR_ACTION_FAILED: "reservations.errors.actionFailed",

	REASON_NOT_ACCEPTING: "reservations.reasons.notAccepting",
	REASON_OUTSIDE_BOOKING_HORIZON: "reservations.reasons.outsideBookingHorizon",
	REASON_BLACKOUT_WINDOW: "reservations.reasons.blackoutWindow",
	REASON_NO_TABLES: "reservations.reasons.noTables",

	FORM_TITLE: "reservations.customerForm.title",
	FORM_PARTY_SIZE: "reservations.customerForm.partySize",
	FORM_DATE_TIME: "reservations.customerForm.dateTime",
	FORM_NAME: "reservations.customerForm.name",
	FORM_PHONE: "reservations.customerForm.phone",
	FORM_EMAIL: "reservations.customerForm.email",
	FORM_NOTES: "reservations.customerForm.notes",
	FORM_SUBMIT: "reservations.customerForm.submit",
	FORM_SUBMITTING: "reservations.customerForm.submitting",
	FORM_REQUIRED_ERROR: "reservations.customerForm.requiredError",
	FORM_GENERIC_ERROR: "reservations.customerForm.genericError",
	FORM_SUCCESS_TITLE: "reservations.customerForm.successTitle",
	FORM_SUCCESS_MESSAGE: "reservations.customerForm.successMessage",
	FORM_AVAILABLE: "reservations.customerForm.available",

	PICKER_SELECTED_CAPACITY: "reservations.picker.selectedCapacity",
	PICKER_NEED_MORE_SEATS: "reservations.picker.needMoreSeats",
	PICKER_SEATS: "reservations.picker.seats",
	PICKER_RESERVED_SUFFIX: "reservations.picker.reservedSuffix",
	PICKER_LOCKED_SUFFIX: "reservations.picker.lockedSuffix",
	PICKER_NO_TABLES: "reservations.picker.noTables",

	LOCKS_NEW_LOCK: "reservations.locks.newLock",
	LOCKS_TABLE_LABEL: "reservations.locks.tableLabel",
	LOCKS_TABLE_PLACEHOLDER: "reservations.locks.tablePlaceholder",
	LOCKS_STARTS_AT: "reservations.locks.startsAt",
	LOCKS_ENDS_AT: "reservations.locks.endsAt",
	LOCKS_REASON: "reservations.locks.reason",
	LOCKS_REASON_PLACEHOLDER: "reservations.locks.reasonPlaceholder",
	LOCKS_ADD_LOCK: "reservations.locks.addLock",
	LOCKS_PICK_TABLE_ERROR: "reservations.locks.pickTableError",
	LOCKS_CREATE_ERROR: "reservations.locks.createError",
	LOCKS_REMOVE_ERROR: "reservations.locks.removeError",
	LOCKS_TABLE_FORMAT: "reservations.locks.tableFormat",
	LOCKS_EMPTY: "reservations.locks.empty",

	TABLE_LABEL_PREFIX: "reservations.tableLabelPrefix",
} as const;

export type ReservationsKey = (typeof ReservationsKeys)[keyof typeof ReservationsKeys];

/**
 * Translation keys for the staff-facing PaymentsDashboard.
 */
export const PaymentsKeys = {
	ARIA_FILTER: "payments.aria.filter",
	ARIA_LOADING: "payments.aria.loading",

	TIME_FRAME_TODAY: "payments.timeFrame.today",
	TIME_FRAME_WEEK: "payments.timeFrame.week",
	TIME_FRAME_MONTH: "payments.timeFrame.month",
	TIME_FRAME_QUARTER: "payments.timeFrame.quarter",
	TIME_FRAME_YEAR: "payments.timeFrame.year",
	TIME_FRAME_ALL: "payments.timeFrame.all",

	SUMMARY_TOTAL_REVENUE: "payments.summary.totalRevenue",
	SUMMARY_ORDERS: "payments.summary.orders",
	SUMMARY_AVG_ORDER: "payments.summary.avgOrder",

	EMPTY_NO_PAYMENTS: "payments.empty.noPayments",

	TABLE_ORDER_ID: "payments.table.orderId",
	TABLE_DATE: "payments.table.date",
	TABLE_TABLE: "payments.table.table",
	TABLE_ITEMS: "payments.table.items",
	TABLE_TOTAL: "payments.table.total",

	TOOLTIP_TOTAL: "payments.tooltip.total",
} as const;

export type PaymentsKey = (typeof PaymentsKeys)[keyof typeof PaymentsKeys];

/**
 * Translation keys for the staff-facing menu admin UI: list, editor,
 * categories, items, image manager, translations, and language settings.
 */
export const MenusKeys = {
	LIST_NEW_PLACEHOLDER: "menus.list.newPlaceholder",
	LIST_ADD_BUTTON: "menus.list.addButton",
	LIST_TOGGLE_DEACTIVATE: "menus.list.toggleDeactivate",
	LIST_TOGGLE_ACTIVATE: "menus.list.toggleActivate",
	LIST_RENAME: "menus.list.rename",
	LIST_DELETE: "menus.list.delete",
	LIST_EMPTY: "menus.list.empty",
	LIST_LOADING_ARIA: "menus.list.loadingAria",

	EDITOR_LANGUAGES_LABEL: "menus.editor.languagesLabel",
	EDITOR_LANGUAGES_TITLE: "menus.editor.languagesTitle",
	EDITOR_OPTIONS_LABEL: "menus.editor.optionsLabel",
	EDITOR_OPTIONS_TITLE: "menus.editor.optionsTitle",
	EDITOR_OPTION_GROUPS_MODAL_ARIA: "menus.editor.optionGroupsModalAria",
	EDITOR_OPTION_GROUPS_HEADING: "menus.editor.optionGroupsHeading",
	EDITOR_OPTION_GROUPS_DESCRIPTION: "menus.editor.optionGroupsDescription",
	EDITOR_NEW_CATEGORY_PLACEHOLDER: "menus.editor.newCategoryPlaceholder",
	EDITOR_ADD_CATEGORY: "menus.editor.addCategory",
	EDITOR_TRANSLATING_HINT: "menus.editor.translatingHint",
	EDITOR_NO_CATEGORIES: "menus.editor.noCategories",
	EDITOR_LOADING_ARIA: "menus.editor.loadingAria",

	CATEGORY_ITEMS_COUNT: "menus.category.itemsCount",
	CATEGORY_TRANSLATION_PLACEHOLDER: "menus.category.translationPlaceholder",
	CATEGORY_DELETE_TITLE: "menus.category.deleteTitle",
	CATEGORY_ADD_ITEM: "menus.category.addItem",

	ITEM_EDIT_TITLE: "menus.item.editTitle",
	ITEM_IMAGE_TITLE: "menus.item.imageTitle",
	ITEM_OPTIONS_TITLE: "menus.item.optionsTitle",
	ITEM_MARK_UNAVAILABLE: "menus.item.markUnavailable",
	ITEM_MARK_AVAILABLE: "menus.item.markAvailable",
	ITEM_REMOVE_TITLE: "menus.item.removeTitle",

	TRANSLATION_NAME_PLACEHOLDER: "menus.translation.namePlaceholder",
	TRANSLATION_DESC_PLACEHOLDER: "menus.translation.descPlaceholder",
	TRANSLATION_DESC_LABEL: "menus.translation.descLabel",

	FORM_ITEM_NAME_PLACEHOLDER: "menus.form.itemNamePlaceholder",
	FORM_ITEM_PRICE_PLACEHOLDER: "menus.form.itemPricePlaceholder",
	FORM_ITEM_DESCRIPTION_PLACEHOLDER: "menus.form.itemDescriptionPlaceholder",
	FORM_CHANGE_IMAGE: "menus.form.changeImage",
	FORM_ADD_IMAGE: "menus.form.addImage",
	FORM_PASTE_HINT: "menus.form.pasteHint",
	FORM_UPLOADING: "menus.form.uploading",
	FORM_ADD: "menus.form.add",
	FORM_CANCEL: "menus.form.cancel",
	FORM_SAVING: "menus.form.saving",
	FORM_SAVE: "menus.form.save",
	FORM_EDIT_HEADER: "menus.form.editHeader",
	FORM_REPLACE_IMAGE: "menus.form.replaceImage",
	FORM_UPLOAD_IMAGE: "menus.form.uploadImage",
	FORM_REMOVE: "menus.form.remove",
	FORM_IMAGE_HEADER: "menus.form.imageHeader",

	PICKER_NO_GROUPS: "menus.picker.noGroups",
	PICKER_LINKED_GROUPS: "menus.picker.linkedGroups",
	PICKER_GROUP_SINGLE: "menus.picker.groupSingle",
	PICKER_GROUP_MULTI: "menus.picker.groupMulti",

	LANG_DEFAULT_LABEL: "menus.lang.defaultLabel",
	LANG_ADDITIONAL_LABEL: "menus.lang.additionalLabel",
} as const;

export type MenusKey = (typeof MenusKeys)[keyof typeof MenusKeys];

/**
 * Translation keys for the staff-facing option groups admin UI.
 */
export const OptionsKeys = {
	TRANSLATING_HINT: "options.translatingHint",
	NEW_GROUP_BUTTON: "options.newGroupButton",
	GROUP_NAME_PLACEHOLDER: "options.groupNamePlaceholder",
	SELECTION_SINGLE: "options.selectionSingle",
	SELECTION_MULTI: "options.selectionMulti",
	REQUIRED_LABEL: "options.requiredLabel",
	CREATE_BUTTON: "options.createButton",
	CANCEL_BUTTON: "options.cancelButton",
	GROUP_TRANSLATION_PLACEHOLDER: "options.groupTranslationPlaceholder",
	OPTION_TRANSLATION_PLACEHOLDER: "options.optionTranslationPlaceholder",
	GROUP_NAME_INLINE_PLACEHOLDER: "options.groupNameInlinePlaceholder",
	TYPE_SINGLE: "options.typeSingle",
	TYPE_MULTI: "options.typeMulti",
	TYPE_REQUIRED: "options.typeRequired",
	TYPE_OPTIONAL: "options.typeOptional",
	OPTION_NAME_PLACEHOLDER: "options.optionNamePlaceholder",
	OPTION_PRICE_PLACEHOLDER: "options.optionPricePlaceholder",
} as const;

export type OptionsKey = (typeof OptionsKeys)[keyof typeof OptionsKeys];

/**
 * Translation keys for the staff-facing restaurants admin UI: list,
 * settings form, tables manager, Stripe Connect onboarding, and skeletons.
 */
export const RestaurantsKeys = {
	LIST_NEW_RESTAURANT: "restaurants.list.newRestaurant",
	LIST_EDIT: "restaurants.list.edit",
	LIST_MANAGE_TABLES: "restaurants.list.manageTables",
	LIST_CUSTOMER_VIEW: "restaurants.list.customerView",
	LIST_DEACTIVATE: "restaurants.list.deactivate",
	LIST_ACTIVATE: "restaurants.list.activate",
	LIST_EMPTY: "restaurants.list.empty",
	LIST_LOADING_ARIA: "restaurants.list.loadingAria",
	LIST_LOAD_FAILED: "restaurants.list.loadFailed",
	LIST_TOGGLE_FAILED: "restaurants.list.toggleFailed",
	LIST_STATUS_ACTIVE: "restaurants.list.statusActive",
	LIST_STATUS_INACTIVE: "restaurants.list.statusInactive",

	MODAL_CREATE_ARIA: "restaurants.modal.createAria",
	MODAL_EDIT_ARIA: "restaurants.modal.editAria",
	MODAL_TABLES_ARIA: "restaurants.modal.tablesAria",
	MODAL_CREATE_HEADING: "restaurants.modal.createHeading",
	MODAL_EDIT_HEADING: "restaurants.modal.editHeading",
	MODAL_TABLES_HEADING: "restaurants.modal.tablesHeading",

	FORM_NAME_LABEL: "restaurants.form.nameLabel",
	FORM_SLUG_LABEL: "restaurants.form.slugLabel",
	FORM_SLUG_HINT: "restaurants.form.slugHint",
	FORM_OPEN_TEST_LINK: "restaurants.form.openTestLink",
	FORM_DESCRIPTION_LABEL: "restaurants.form.descriptionLabel",
	FORM_CURRENCY_LABEL: "restaurants.form.currencyLabel",
	FORM_TIMEZONE_LABEL: "restaurants.form.timezoneLabel",
	FORM_TIMEZONE_PLACEHOLDER: "restaurants.form.timezonePlaceholder",
	FORM_ORG_LABEL: "restaurants.form.orgLabel",
	FORM_ORG_PLACEHOLDER: "restaurants.form.orgPlaceholder",
	FORM_STATUS_LABEL: "restaurants.form.statusLabel",
	FORM_TOGGLE_DEACTIVATE_TITLE: "restaurants.form.toggleDeactivateTitle",
	FORM_TOGGLE_ACTIVATE_TITLE: "restaurants.form.toggleActivateTitle",
	FORM_SAVE_CHANGES: "restaurants.form.saveChanges",
	FORM_CREATE: "restaurants.form.create",
	FORM_CREATING: "restaurants.form.creating",
	FORM_UPDATE_FAILED: "restaurants.form.updateFailed",
	FORM_CREATE_FAILED: "restaurants.form.createFailed",

	TABLES_NUMBER_LABEL: "restaurants.tables.numberLabel",
	TABLES_LABEL_LABEL: "restaurants.tables.labelLabel",
	TABLES_LABEL_PLACEHOLDER: "restaurants.tables.labelPlaceholder",
	TABLES_SEATS_LABEL: "restaurants.tables.seatsLabel",
	TABLES_ADD: "restaurants.tables.add",
	TABLES_SAVE: "restaurants.tables.save",
	TABLES_CANCEL: "restaurants.tables.cancel",
	TABLES_EDIT_TITLE: "restaurants.tables.editTitle",
	TABLES_DEACTIVATE_TITLE: "restaurants.tables.deactivateTitle",
	TABLES_ACTIVATE_TITLE: "restaurants.tables.activateTitle",
	TABLES_REMOVE_TITLE: "restaurants.tables.removeTitle",
	TABLES_TABLE_LABEL: "restaurants.tables.tableLabel",
	TABLES_SEATS_FORMAT: "restaurants.tables.seatsFormat",
	TABLES_SEATS_NOT_SET: "restaurants.tables.seatsNotSet",
	TABLES_EMPTY: "restaurants.tables.empty",
	TABLES_CREATE_FAILED: "restaurants.tables.createFailed",
	TABLES_UPDATE_FAILED: "restaurants.tables.updateFailed",
	TABLES_TOGGLE_FAILED: "restaurants.tables.toggleFailed",
	TABLES_REMOVE_FAILED: "restaurants.tables.removeFailed",

	STRIPE_HEADING: "restaurants.stripe.heading",
	STRIPE_DESCRIPTION: "restaurants.stripe.description",
	STRIPE_PAYMENTS_ENABLED: "restaurants.stripe.paymentsEnabled",
	STRIPE_CHECKING: "restaurants.stripe.checking",
	STRIPE_FULLY_SETUP: "restaurants.stripe.fullySetup",
	STRIPE_DASHBOARD: "restaurants.stripe.dashboard",
	STRIPE_REFRESH_STATUS: "restaurants.stripe.refreshStatus",
	STRIPE_REFRESH: "restaurants.stripe.refresh",
	STRIPE_REQUIREMENTS_PREFIX: "restaurants.stripe.requirementsPrefix",
	STRIPE_REQ_CURRENTLY_DUE: "restaurants.stripe.requirementsCurrentlyDue",
	STRIPE_REQ_PAST_DUE: "restaurants.stripe.requirementsPastDue",
	STRIPE_TRANSFERS_INACTIVE: "restaurants.stripe.transfersInactive",
	STRIPE_PARTIAL_REQ: "restaurants.stripe.partialRequirements",
	STRIPE_REDIRECTING: "restaurants.stripe.redirecting",
	STRIPE_CONTINUE_SETUP: "restaurants.stripe.continueSetup",
	STRIPE_INTRO: "restaurants.stripe.intro",
	STRIPE_SETTING_UP: "restaurants.stripe.settingUp",
	STRIPE_ONBOARD: "restaurants.stripe.onboard",
	STRIPE_RESET_BUTTON: "restaurants.stripe.resetButton",
	STRIPE_RESET_CONFIRM: "restaurants.stripe.resetConfirm",
	STRIPE_RESET_RESETTING: "restaurants.stripe.resetResetting",
	STRIPE_RESET_CANCEL: "restaurants.stripe.resetCancel",
	STRIPE_RESET_WARNING: "restaurants.stripe.resetWarning",
	STRIPE_DISCONNECTED_CLOSED: "restaurants.stripe.disconnectedClosed",
	STRIPE_DISCONNECTED_LEFT_OPEN: "restaurants.stripe.disconnectedLeftOpen",
	STRIPE_STATUS_FAILED: "restaurants.stripe.statusFailed",
	STRIPE_SETUP_FAILED: "restaurants.stripe.setupFailed",
	STRIPE_RESET_FAILED: "restaurants.stripe.resetFailed",
} as const;

export type RestaurantsKey = (typeof RestaurantsKeys)[keyof typeof RestaurantsKeys];

/**
 * Translation keys for the public homepage / welcome section shown to
 * unauthenticated visitors.
 */
export const WelcomeKeys = {
	BADGE: "welcome.badge",
	HEADING_PREFIX: "welcome.headingPrefix",
	SUBHEADING: "welcome.subheading",
	FEATURE_MENU_TITLE: "welcome.feature.menuTitle",
	FEATURE_MENU_DESC: "welcome.feature.menuDesc",
	FEATURE_TABLE_TITLE: "welcome.feature.tableTitle",
	FEATURE_TABLE_DESC: "welcome.feature.tableDesc",
	FEATURE_AUTH_TITLE: "welcome.feature.authTitle",
	FEATURE_AUTH_DESC: "welcome.feature.authDesc",
	GET_STARTED: "welcome.getStarted",
} as const;

export type WelcomeKey = (typeof WelcomeKeys)[keyof typeof WelcomeKeys];

/**
 * Translation keys for the customer-facing ordering flow under
 * `/r/$slug/$lang/*`: menu browsing, item detail sheet, cart, checkout,
 * order status, and the session orders list.
 */
export const OrderingKeys = {
	SESSION_ERROR_NOT_FOUND: "ordering.session.errorNotFound",
	SESSION_ERROR_GENERIC: "ordering.session.errorGeneric",
	SESSION_OOPS: "ordering.session.oops",
	SESSION_NO_SESSION: "ordering.session.noSession",
	SESSION_VIEW_ORDERS: "ordering.session.viewOrders",
	SESSION_MY_ORDERS: "ordering.session.myOrders",

	BACK_TO_MENU: "ordering.backToMenu",
	BACK_TO_MENU_ARIA: "ordering.backToMenuAria",

	MENU_PROCEED_TO_PAYMENT: "ordering.menu.proceedToPayment",
	MENU_PREPARING: "ordering.menu.preparing",
	MENU_REVIEW_ORDER: "ordering.menu.reviewOrder",
	MENU_TABLE_NUMBER: "ordering.menu.tableNumber",
	MENU_SELECT_TABLE: "ordering.menu.selectTable",
	MENU_TABLE_REQUIRED: "ordering.menu.tableRequired",
	MENU_TABLE_LABEL: "ordering.menu.tableLabel",
	MENU_NOTES_PLACEHOLDER: "ordering.menu.notesPlaceholder",
	MENU_TOTAL_LABEL: "ordering.menu.totalLabel",
	MENU_TOTAL_WITH_COUNT: "ordering.menu.totalWithCount",
	MENU_TAP_TO_START: "ordering.menu.tapToStart",
	MENU_NO_ONLINE_ORDERING: "ordering.menu.noOnlineOrdering",

	ITEM_REQUIRED: "ordering.item.required",
	ITEM_PICK_ONE: "ordering.item.pickOne",
	ITEM_PLEASE_SELECT: "ordering.item.pleaseSelect",
	ITEM_ADD_TO_CART: "ordering.item.addToCart",
	ITEM_UPDATE_CART: "ordering.item.updateCart",
	ITEM_REMOVE_FROM_ORDER: "ordering.item.removeFromOrder",
	ITEM_SPECIAL_INSTRUCTIONS_LABEL: "ordering.item.specialInstructionsLabel",
	ITEM_SPECIAL_INSTRUCTIONS_PLACEHOLDER: "ordering.item.specialInstructionsPlaceholder",

	CART_BACK: "ordering.cart.back",
	CART_HEADING: "ordering.cart.heading",
	CART_EMPTY: "ordering.cart.empty",
	CART_TOTAL: "ordering.cart.total",
	CART_PLACE_ORDER: "ordering.cart.placeOrder",
	CART_PLACING_ORDER: "ordering.cart.placingOrder",

	CHECKOUT_HEADING: "ordering.checkout.heading",
	CHECKOUT_ORDER_SUMMARY: "ordering.checkout.orderSummary",
	CHECKOUT_TOTAL: "ordering.checkout.total",
	CHECKOUT_INIT_FAILED: "ordering.checkout.initFailed",
	CHECKOUT_PAYMENT_FAILED: "ordering.checkout.paymentFailed",
	CHECKOUT_GENERIC_ERROR: "ordering.checkout.genericError",
	CHECKOUT_UNABLE_INIT: "ordering.checkout.unableInit",
	CHECKOUT_RETRY: "ordering.checkout.retry",
	CHECKOUT_PROCESSING: "ordering.checkout.processing",
	CHECKOUT_PAY_NOW: "ordering.checkout.payNow",
	CHECKOUT_SECURED_BY_STRIPE: "ordering.checkout.securedByStripe",

	ORDER_STATUS_LOADING: "ordering.orderStatus.loading",
	ORDER_STATUS_HEADING: "ordering.orderStatus.heading",
	ORDER_STATUS_CANCELLED: "ordering.orderStatus.cancelled",
	ORDER_STATUS_ITEMS: "ordering.orderStatus.items",
	ORDER_STATUS_SUMMARY: "ordering.orderStatus.summary",
	ORDER_STATUS_ORDER_MORE: "ordering.orderStatus.orderMore",
	ORDER_STATUS_STEP_PLACED: "ordering.orderStatus.stepPlaced",
	ORDER_STATUS_STEP_PREPARING: "ordering.orderStatus.stepPreparing",
	ORDER_STATUS_STEP_READY: "ordering.orderStatus.stepReady",
	ORDER_STATUS_STEP_SERVED: "ordering.orderStatus.stepServed",

	ORDERS_HEADER: "ordering.orders.header",
	ORDERS_EMPTY_TITLE: "ordering.orders.emptyTitle",
	ORDERS_EMPTY_DESC: "ordering.orders.emptyDesc",
	ORDERS_EMPTY_BROWSE: "ordering.orders.emptyBrowse",
	ORDERS_TIME_JUST_NOW: "ordering.orders.timeJustNow",
	ORDERS_TIME_MIN_AGO: "ordering.orders.timeMinAgo",
	ORDERS_TIME_HOUR_AGO: "ordering.orders.timeHourAgo",
	ORDERS_LIFECYCLE_PAYMENT_FAILED: "ordering.orders.lifecyclePaymentFailed",
	ORDERS_LIFECYCLE_TRY_AGAIN: "ordering.orders.lifecycleTryAgain",
	ORDERS_LIFECYCLE_PAYMENT_PROCESSING: "ordering.orders.lifecyclePaymentProcessing",
	ORDERS_LIFECYCLE_VIEW: "ordering.orders.lifecycleView",
	ORDERS_LIFECYCLE_UNPAID: "ordering.orders.lifecycleUnpaid",
	ORDERS_LIFECYCLE_FINISH_CHECKOUT: "ordering.orders.lifecycleFinishCheckout",
	ORDERS_LIFECYCLE_PLACED: "ordering.orders.lifecyclePlaced",
	ORDERS_LIFECYCLE_PREPARING: "ordering.orders.lifecyclePreparing",
	ORDERS_LIFECYCLE_READY: "ordering.orders.lifecycleReady",
	ORDERS_LIFECYCLE_SERVED: "ordering.orders.lifecycleServed",
	ORDERS_LIFECYCLE_CANCELLED: "ordering.orders.lifecycleCancelled",
} as const;

export type OrderingKey = (typeof OrderingKeys)[keyof typeof OrderingKeys];
