/**
 * Translation keys for the configurable dashboard tab and its widgets.
 *
 * Convention:
 * - `WIDGET_*_LABEL` / `WIDGET_*_DESCRIPTION` = picker copy.
 * - `WIDGET_*` keys nested under each widget = runtime copy (axis labels,
 *   empty-state strings, role gate text, etc.).
 */
export const DashboardKeys = {
	PAGE_TITLE: "dashboard.page.title",
	PAGE_DESCRIPTION: "dashboard.page.description",
	PAGE_NO_RESTAURANT_TITLE: "dashboard.page.noRestaurantTitle",
	PAGE_NO_RESTAURANT_DESCRIPTION: "dashboard.page.noRestaurantDescription",
	PAGE_PORTFOLIO_LABEL: "dashboard.page.portfolioLabel",

	TABS_NEW: "dashboard.tabs.new",
	TABS_RENAME: "dashboard.tabs.rename",
	TABS_DUPLICATE: "dashboard.tabs.duplicate",
	TABS_DELETE: "dashboard.tabs.delete",
	TABS_OVERFLOW: "dashboard.tabs.overflow",
	TABS_DEFAULT_NAME: "dashboard.tabs.defaultName",
	TABS_DELETE_CONFIRM: "dashboard.tabs.deleteConfirm",
	TABS_EMPTY_TITLE: "dashboard.tabs.emptyTitle",
	TABS_EMPTY_DESCRIPTION: "dashboard.tabs.emptyDescription",
	TABS_EMPTY_ACTION: "dashboard.tabs.emptyAction",

	EDIT_ENTER: "dashboard.edit.enter",
	EDIT_SAVE: "dashboard.edit.save",
	EDIT_DISCARD: "dashboard.edit.discard",
	EDIT_ADD_WIDGET: "dashboard.edit.addWidget",
	EDIT_UNSAVED_CHANGES: "dashboard.edit.unsavedChanges",
	EDIT_SAVED: "dashboard.edit.saved",
	EDIT_SAVE_FAILED: "dashboard.edit.saveFailed",
	EDIT_REMOVE_WIDGET: "dashboard.edit.removeWidget",
	EDIT_DRAG_HANDLE: "dashboard.edit.dragHandle",

	GLOBAL_RANGE_LABEL: "dashboard.globalRange.label",
	GLOBAL_RANGE_TODAY: "dashboard.globalRange.today",
	GLOBAL_RANGE_WEEK: "dashboard.globalRange.week",
	GLOBAL_RANGE_MONTH: "dashboard.globalRange.month",
	GLOBAL_RANGE_QUARTER: "dashboard.globalRange.quarter",
	GLOBAL_RANGE_YEAR: "dashboard.globalRange.year",
	GLOBAL_RANGE_CUSTOM: "dashboard.globalRange.custom",
	GLOBAL_COMPARE_TO_PREV: "dashboard.globalRange.compareToPrev",
	GLOBAL_COMPARE_TO_PREV_LABEL: "dashboard.globalRange.compareToPrevLabel",

	OVERRIDE_BADGE: "dashboard.widget.overrideBadge",
	OVERRIDE_REMOVE: "dashboard.widget.overrideRemove",

	PICKER_TITLE: "dashboard.picker.title",
	PICKER_DESCRIPTION: "dashboard.picker.description",
	PICKER_LOCKED_BADGE: "dashboard.picker.lockedBadge",
	PICKER_LOCKED_TOOLTIP: "dashboard.picker.lockedTooltip",
	PICKER_PORTFOLIO_BADGE: "dashboard.picker.portfolioBadge",
	PICKER_NOT_PORTFOLIO_CAPABLE: "dashboard.picker.notPortfolioCapable",
	PICKER_CLOSE: "dashboard.picker.close",

	TEMPLATES_TITLE: "dashboard.templates.title",
	TEMPLATES_DESCRIPTION: "dashboard.templates.description",
	TEMPLATES_BROWSE: "dashboard.templates.browse",
	TEMPLATES_PUBLISH: "dashboard.templates.publish",
	TEMPLATES_PUBLISH_NAME_LABEL: "dashboard.templates.publishNameLabel",
	TEMPLATES_PUBLISH_DESCRIPTION_LABEL: "dashboard.templates.publishDescriptionLabel",
	TEMPLATES_PUBLISH_SAVE: "dashboard.templates.publishSave",
	TEMPLATES_USE_THIS: "dashboard.templates.useThis",
	TEMPLATES_DELETE: "dashboard.templates.delete",
	TEMPLATES_DELETE_CONFIRM: "dashboard.templates.deleteConfirm",
	TEMPLATES_EMPTY_TITLE: "dashboard.templates.emptyTitle",
	TEMPLATES_EMPTY_DESCRIPTION: "dashboard.templates.emptyDescription",
	TEMPLATES_PUBLISHED_BY: "dashboard.templates.publishedBy",

	WIDGET_LOADING: "dashboard.widget.loading",
	WIDGET_ERROR_TITLE: "dashboard.widget.errorTitle",
	WIDGET_ERROR_DESCRIPTION: "dashboard.widget.errorDescription",
	WIDGET_ERROR_RANGE_TOO_LARGE: "dashboard.widget.errorRangeTooLarge",
	WIDGET_ERROR_ACCESS_DENIED: "dashboard.widget.errorAccessDenied",
	WIDGET_UNAVAILABLE_TITLE: "dashboard.widget.unavailableTitle",
	WIDGET_UNAVAILABLE_DESCRIPTION: "dashboard.widget.unavailableDescription",
	WIDGET_EMPTY: "dashboard.widget.empty",
	WIDGET_DELTA_UP: "dashboard.widget.deltaUp",
	WIDGET_DELTA_DOWN: "dashboard.widget.deltaDown",
	WIDGET_DELTA_NEUTRAL: "dashboard.widget.deltaNeutral",
	WIDGET_DELTA_VS_PREV: "dashboard.widget.deltaVsPrev",

	WIDGET_NUMBER_WITH_DELTA_LABEL: "dashboard.widgets.numberWithDelta.label",
	WIDGET_NUMBER_WITH_DELTA_DESCRIPTION: "dashboard.widgets.numberWithDelta.description",
	WIDGET_NUMBER_WITH_DELTA_METRIC_LABEL: "dashboard.widgets.numberWithDelta.metricLabel",
	WIDGET_NUMBER_WITH_DELTA_METRIC_RESERVATIONS_COUNT:
		"dashboard.widgets.numberWithDelta.metric.reservationsCount",
	WIDGET_NUMBER_WITH_DELTA_METRIC_RESERVATIONS_CONFIRMED:
		"dashboard.widgets.numberWithDelta.metric.reservationsConfirmed",
	WIDGET_NUMBER_WITH_DELTA_METRIC_ORDERS_COUNT:
		"dashboard.widgets.numberWithDelta.metric.ordersCount",
	WIDGET_NUMBER_WITH_DELTA_METRIC_PAYMENTS_REVENUE_TOTAL:
		"dashboard.widgets.numberWithDelta.metric.paymentsRevenueTotal",
	WIDGET_NUMBER_WITH_DELTA_METRIC_COVERS:
		"dashboard.widgets.numberWithDelta.metric.covers",

	WIDGET_TOP_MENU_ITEMS_LABEL: "dashboard.widgets.topMenuItems.label",
	WIDGET_TOP_MENU_ITEMS_DESCRIPTION: "dashboard.widgets.topMenuItems.description",
	WIDGET_TOP_MENU_ITEMS_LIMIT_LABEL: "dashboard.widgets.topMenuItems.limitLabel",
	WIDGET_TOP_MENU_ITEMS_QUANTITY: "dashboard.widgets.topMenuItems.quantity",

	WIDGET_REVENUE_OVER_TIME_LABEL: "dashboard.widgets.revenueOverTime.label",
	WIDGET_REVENUE_OVER_TIME_DESCRIPTION: "dashboard.widgets.revenueOverTime.description",
	WIDGET_REVENUE_OVER_TIME_AXIS: "dashboard.widgets.revenueOverTime.axis",

	WIDGET_ORDERS_BY_HOUR_LABEL: "dashboard.widgets.ordersByHour.label",
	WIDGET_ORDERS_BY_HOUR_DESCRIPTION: "dashboard.widgets.ordersByHour.description",
	WIDGET_ORDERS_BY_HOUR_AXIS: "dashboard.widgets.ordersByHour.axis",

	WIDGET_RESERVATIONS_BY_STATUS_LABEL: "dashboard.widgets.reservationsByStatus.label",
	WIDGET_RESERVATIONS_BY_STATUS_DESCRIPTION:
		"dashboard.widgets.reservationsByStatus.description",

	WIDGET_TIPS_TOTAL_LABEL: "dashboard.widgets.tipsTotal.label",
	WIDGET_TIPS_TOTAL_DESCRIPTION: "dashboard.widgets.tipsTotal.description",

	WIDGET_TABLE_OCCUPANCY_LABEL: "dashboard.widgets.tableOccupancy.label",
	WIDGET_TABLE_OCCUPANCY_DESCRIPTION: "dashboard.widgets.tableOccupancy.description",

	WIDGET_BUSY_TIMES_HEATMAP_LABEL: "dashboard.widgets.busyTimesHeatmap.label",
	WIDGET_BUSY_TIMES_HEATMAP_DESCRIPTION:
		"dashboard.widgets.busyTimesHeatmap.description",

	DAY_SUN: "dashboard.day.sun",
	DAY_MON: "dashboard.day.mon",
	DAY_TUE: "dashboard.day.tue",
	DAY_WED: "dashboard.day.wed",
	DAY_THU: "dashboard.day.thu",
	DAY_FRI: "dashboard.day.fri",
	DAY_SAT: "dashboard.day.sat",
} as const;

export type DashboardKey = (typeof DashboardKeys)[keyof typeof DashboardKeys];
