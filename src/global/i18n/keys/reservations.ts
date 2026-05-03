/**
 * Translation keys for everything under `src/features/reservations/`:
 * the dashboard, the detail drawer, the customer-facing reservation form,
 * the table picker, and the table-locks manager.
 *
 * `ReservationSettingsKeys` (the staff settings panel) lives separately
 * because it predates this file's per-feature pattern.
 */
export const ReservationsKeys = {
	PAGE_TITLE: "reservations.page.title",
	PAGE_DESCRIPTION: "reservations.page.description",
	PAGE_LOCKS_BUTTON: "reservations.page.locksButton",
	PAGE_SETTINGS_BUTTON: "reservations.page.settingsButton",

	SETTINGS_DRAWER_TITLE: "reservations.settingsDrawer.title",
	SETTINGS_DRAWER_DESCRIPTION: "reservations.settingsDrawer.description",
	SETTINGS_DRAWER_ARIA: "reservations.settingsDrawer.ariaLabel",

	LOCKS_DRAWER_TITLE: "reservations.locksDrawer.title",
	LOCKS_DRAWER_DESCRIPTION: "reservations.locksDrawer.description",
	LOCKS_DRAWER_ARIA: "reservations.locksDrawer.ariaLabel",

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
	RANGE_CUSTOM: "reservations.range.custom",
	/** Compact label beside range pills for the calendar jump control. */
	DASHBOARD_DAY_PICKER_LABEL: "reservations.dashboard.dayPickerLabel",

	VIEW_MODE_CARDS: "reservations.viewMode.cards",
	VIEW_MODE_TABLE: "reservations.viewMode.table",

	SOURCE_UI: "reservations.sources.ui",
	SOURCE_WHATSAPP: "reservations.sources.whatsapp",
	SOURCE_STAFF: "reservations.sources.staff",

	TABLE_SEARCH_PLACEHOLDER: "reservations.table.searchPlaceholder",
	COLUMN_STATUS: "reservations.table.columns.status",
	COLUMN_GUEST: "reservations.table.columns.guest",
	COLUMN_PARTY: "reservations.table.columns.party",
	COLUMN_DATE: "reservations.table.columns.date",
	COLUMN_TIME: "reservations.table.columns.time",
	COLUMN_SOURCE: "reservations.table.columns.source",
	COLUMN_TABLES: "reservations.table.columns.tables",
	COLUMN_NOTES: "reservations.table.columns.notes",
	COLUMN_RESTAURANT: "reservations.table.columns.restaurant",

	ARIA_FILTER_RANGE: "reservations.aria.filterRange",
	ARIA_FILTER_STATUS: "reservations.aria.filterStatus",
	ARIA_FILTER_VIEW_MODE: "reservations.aria.filterViewMode",
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
	FORM_DATE: "reservations.customerForm.date",
	FORM_TIME: "reservations.customerForm.time",
	FORM_SLOTS_EMPTY: "reservations.customerForm.slotsEmpty",
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
