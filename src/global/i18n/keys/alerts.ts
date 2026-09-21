/**
 * Translation keys for operator alerts — Tavli's own inbox (TAVLI-109).
 *
 * The `KIND_*` values are deliberately not the source of truth: the backend
 * stores an i18n key on every alert row (`OPERATOR_ALERT_TITLE_KEY` and
 * `OPERATOR_ALERT_EXPLANATION_KEY` in `convex/constants.ts`), and this enum
 * restates those same strings so `locales.test.ts` can prove that every kind
 * resolves in `en.json` and `es.json`. A kind added to the backend without
 * copy here is a red test, not a blank row on the page.
 */
export const AlertsKeys = {
	// Page chrome
	PAGE_TITLE: "alerts.page.title",
	PAGE_DESCRIPTION: "alerts.page.description",
	PAGE_ENTITY: "alerts.page.entity",
	PAGE_SEARCH_PLACEHOLDER: "alerts.page.searchPlaceholder",
	PAGE_EMPTY_TITLE: "alerts.page.emptyTitle",
	PAGE_EMPTY_DESCRIPTION: "alerts.page.emptyDescription",
	PAGE_FILTERED_EMPTY_TITLE: "alerts.page.filteredEmptyTitle",
	PAGE_NOT_AUTHENTICATED: "alerts.page.notAuthenticated",
	PAGE_RESULT_COUNT: "alerts.page.resultCount",

	// Filters
	FILTER_SEVERITY: "alerts.filter.severity",
	FILTER_RESTAURANT: "alerts.filter.restaurant",
	FILTER_ALL_SEVERITIES: "alerts.filter.allSeverities",
	FILTER_ALL_RESTAURANTS: "alerts.filter.allRestaurants",
	FILTER_NO_RESTAURANT: "alerts.filter.noRestaurant",

	// Columns
	COLUMN_ALERT: "alerts.column.alert",
	COLUMN_SEVERITY: "alerts.column.severity",
	COLUMN_RESTAURANT: "alerts.column.restaurant",
	COLUMN_RAISED: "alerts.column.raised",
	COLUMN_STATUS: "alerts.column.status",

	// Row actions and links
	ACTION_ACKNOWLEDGE: "alerts.action.acknowledge",
	ACTION_ACKNOWLEDGED_BY: "alerts.action.acknowledgedBy",
	LINK_RESTAURANT: "alerts.link.restaurant",
	LINK_ORDER: "alerts.link.order",
	LINK_PAYMENT: "alerts.link.payment",

	// Severities
	SEVERITY_INFO: "alerts.severity.info",
	SEVERITY_WARNING: "alerts.severity.warning",
	SEVERITY_SEVERE: "alerts.severity.severe",

	// Statuses
	STATUS_OPEN: "alerts.status.open",
	STATUS_ACKNOWLEDGED: "alerts.status.acknowledged",

	// Kinds — title + one-line explanation, mirroring convex/constants.ts
	KIND_PAYMENT_STUCK_TITLE: "alerts.kind.paymentStuck.title",
	KIND_PAYMENT_STUCK_EXPLANATION: "alerts.kind.paymentStuck.explanation",
	KIND_CHARGE_UNMATCHED_TITLE: "alerts.kind.chargeUnmatched.title",
	KIND_CHARGE_UNMATCHED_EXPLANATION: "alerts.kind.chargeUnmatched.explanation",
	KIND_CHARGE_MISMATCHED_REFUNDED_TITLE: "alerts.kind.chargeMismatchedRefunded.title",
	KIND_CHARGE_MISMATCHED_REFUNDED_EXPLANATION: "alerts.kind.chargeMismatchedRefunded.explanation",
	KIND_PAYMENT_AMOUNT_MISMATCH_TITLE: "alerts.kind.paymentAmountMismatch.title",
	KIND_PAYMENT_AMOUNT_MISMATCH_EXPLANATION: "alerts.kind.paymentAmountMismatch.explanation",
	KIND_DISPUTE_LOST_TITLE: "alerts.kind.disputeLost.title",
	KIND_DISPUTE_LOST_EXPLANATION: "alerts.kind.disputeLost.explanation",
	KIND_DASHBOARD_REFUND_TITLE: "alerts.kind.dashboardRefund.title",
	KIND_DASHBOARD_REFUND_EXPLANATION: "alerts.kind.dashboardRefund.explanation",
	KIND_PAYOUT_FAILED_TITLE: "alerts.kind.payoutFailed.title",
	KIND_PAYOUT_FAILED_EXPLANATION: "alerts.kind.payoutFailed.explanation",
	KIND_ACCOUNT_CLOSED_TITLE: "alerts.kind.accountClosed.title",
	KIND_ACCOUNT_CLOSED_EXPLANATION: "alerts.kind.accountClosed.explanation",
	KIND_RESTAURANT_MISSING_CONTACT_EMAIL_TITLE: "alerts.kind.restaurantMissingContactEmail.title",
	KIND_RESTAURANT_MISSING_CONTACT_EMAIL_EXPLANATION:
		"alerts.kind.restaurantMissingContactEmail.explanation",
} as const;

export type AlertsKey = (typeof AlertsKeys)[keyof typeof AlertsKeys];
