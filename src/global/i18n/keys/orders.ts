/**
 * Translation keys for the staff-facing OrderDashboard (kitchen view).
 * Keys are split into status labels, action buttons, cancellation flow,
 * card metadata, empty states, and ARIA labels.
 *
 * Pluralized keys (e.g. `MORE_ITEMS`) resolve via i18next's `_one` /
 * `_other` suffixes; pass `{ count }` to `t()`.
 */
export const OrdersKeys = {
	PAGE_TITLE: "orders.page.title",
	PAGE_DESCRIPTION: "orders.page.description",

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
	CARD_DAY_NUMBER: "orders.card.dayNumber",
	CARD_PAID: "orders.card.paid",
	CARD_MORE_ITEMS: "orders.card.moreItems",

	EMPTY_NO_FILTERS: "orders.empty.noFilters",
	EMPTY_NO_ORDERS: "orders.empty.noOrders",

	ARIA_FILTER: "orders.aria.filter",
	ARIA_FULL_ORDER: "orders.aria.fullOrder",
	ARIA_LOADING: "orders.aria.loading",
} as const;

export type OrdersKey = (typeof OrdersKeys)[keyof typeof OrdersKeys];
