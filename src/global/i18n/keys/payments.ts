/**
 * Translation keys for the staff-facing PaymentsDashboard.
 */
export const PaymentsKeys = {
	PAGE_TITLE: "payments.page.title",
	PAGE_DESCRIPTION: "payments.page.description",

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
	/** Customer-borne Tavli service fee collected over the period (ADR 008). */
	SUMMARY_SERVICE_FEES: "payments.summary.serviceFees",
	SUMMARY_TIPS: "payments.summary.tips",

	EMPTY_NO_PAYMENTS: "payments.empty.noPayments",

	/** Pass `{ count }` for i18next `_one` / `_other` plural forms. */
	RESULT_COUNT: "payments.resultCount",
	SEARCH_PLACEHOLDER: "payments.searchPlaceholder",

	TABLE_DAY_ORDER_NUMBER: "payments.table.dayOrderNumber",
	/** Order id on order rows, payment id on tip rows — hence not "order id". */
	TABLE_ROW_ID: "payments.table.rowId",
	TABLE_DATE: "payments.table.date",
	TABLE_TABLE: "payments.table.table",
	TABLE_ITEMS: "payments.table.items",
	TABLE_TYPE: "payments.table.type",
	/**
	 * Food sold, excluding the Tavli service fee. Replaces the old
	 * `payments.table.total`, which read as "what the diner paid".
	 */
	TABLE_SUBTOTAL: "payments.table.subtotal",
	TABLE_SERVICE_FEE: "payments.table.serviceFee",
	TABLE_TIP: "payments.table.tip",
	TABLE_NET_TO_RESTAURANT: "payments.table.netToRestaurant",

	ROW_KIND_ORDER: "payments.rowKind.order",
	ROW_KIND_TIP: "payments.rowKind.tip",

	TOOLTIP_SUBTOTAL: "payments.tooltip.subtotal",
} as const;

export type PaymentsKey = (typeof PaymentsKeys)[keyof typeof PaymentsKeys];
