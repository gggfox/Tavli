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

	// Generic chrome shared by dialogs, drawers, toasts and form helpers
	CLOSE: "common.close",
	DISMISS: "common.dismiss",
	VIEW: "common.view",
	MORE_INFO: "common.moreInfo",
	LOADING: "common.loading",
	NOTIFICATIONS_REGION: "common.notificationsRegion",
	DRAWER_DRAG_TO_CLOSE: "common.drawer.dragToClose",

	// AppDatePicker
	DATE_PICKER_PREVIOUS_MONTH: "common.datePicker.previousMonth",
	DATE_PICKER_NEXT_MONTH: "common.datePicker.nextMonth",
	DATE_PICKER_PAGE_KEYS_HINT: "common.datePicker.pageKeysHint",
	DATE_PICKER_TODAY: "common.datePicker.today",

	// CopyableId — the aria labels take `{ id }`
	COPY_ID_COPIED: "common.copyId.copied",
	COPY_ID_COPY_ARIA: "common.copyId.copyAria",
	COPY_ID_COPIED_ARIA: "common.copyId.copiedAria",

	// MultiCardSelect
	SELECT_NO_OPTIONS: "common.select.noOptions",
	/** Pluralized "N items selected" -- pass `{ count }`. */
	SELECT_SELECTED_COUNT: "common.select.selectedCount",

	// LanguageTabBar
	LANGUAGE_DEFAULT_SUFFIX: "common.language.defaultSuffix",

	/**
	 * AdminTable / Pagination defaults. AdminTable never builds copy out of an
	 * entity noun — a caller that wants entity-specific wording passes its own
	 * translated strings, and anything it leaves out falls back to these
	 * entity-neutral ones.
	 */
	TABLE_ACTIONS: "common.table.actions",
	TABLE_SEARCH_PLACEHOLDER: "common.table.searchPlaceholder",
	/** Pluralized "N results" -- pass `{ count }`. */
	TABLE_RESULT_COUNT: "common.table.resultCount",
	TABLE_EMPTY_TITLE: "common.table.emptyTitle",
	TABLE_FILTERED_EMPTY_TITLE: "common.table.filteredEmptyTitle",
	TABLE_SIGN_IN_REQUIRED: "common.table.signInRequired",
	/** "Page {{page}} of {{total}}". */
	TABLE_PAGE_OF: "common.table.pageOf",
	TABLE_PREVIOUS_PAGE: "common.table.previousPage",
	TABLE_NEXT_PAGE: "common.table.nextPage",

	// Root not-found page
	NOT_FOUND_TITLE: "common.notFound.title",
	NOT_FOUND_DESCRIPTION: "common.notFound.description",
} as const;

export type CommonKey = (typeof CommonKeys)[keyof typeof CommonKeys];
