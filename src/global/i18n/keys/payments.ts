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
