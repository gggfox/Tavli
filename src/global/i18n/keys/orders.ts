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

	STATUS_AWAITING_PAYMENT: "orders.status.awaitingPayment",
	STATUS_SUBMITTED: "orders.status.submitted",
	STATUS_PREPARING: "orders.status.preparing",
	STATUS_READY: "orders.status.ready",
	STATUS_SERVED: "orders.status.served",
	STATUS_CANCELLED: "orders.status.cancelled",

	STATION_KITCHEN: "orders.station.kitchen",
	STATION_BAR: "orders.station.bar",
	STATION_READY_BADGE: "orders.station.readyBadge",
	STATION_PENDING_BADGE: "orders.station.pendingBadge",

	ACTION_ACCEPT: "orders.actions.accept",
	ACTION_MARK_READY: "orders.actions.markReady",
	ACTION_MARK_KITCHEN_READY: "orders.actions.markKitchenReady",
	ACTION_MARK_BAR_READY: "orders.actions.markBarReady",
	ACTION_MARK_SERVED: "orders.actions.markServed",
	ACTION_CANCEL: "orders.actions.cancel",
	ACTION_CANCEL_AND_REFUND: "orders.actions.cancelAndRefund",
	ACTION_CONFIRM_CANCEL: "orders.actions.confirmCancel",
	ACTION_KEEP_ORDER: "orders.actions.keepOrder",
	ACTION_VIEW_FULL_ORDER: "orders.actions.viewFullOrder",

	ACTION_MARK_PAID_IN_PERSON: "orders.markPaid.action",
	MARK_PAID_PROMPT_TITLE: "orders.markPaid.promptTitle",
	MARK_PAID_PROMPT_BODY: "orders.markPaid.promptBody",
	MARK_PAID_CONFIRM: "orders.markPaid.confirm",
	MARK_PAID_DISMISS: "orders.markPaid.dismiss",
	MARK_PAID_PENDING: "orders.markPaid.pending",
	MARK_PAID_AMOUNT_DUE: "orders.markPaid.amountDue",

	CANCEL_PROMPT: "orders.cancel.prompt",
	CANCEL_PAID_PROMPT: "orders.cancel.paidPrompt",
	CANCEL_REFUND_PENDING: "orders.cancel.refundPending",
	CANCEL_REFUND_FAILED_BANNER: "orders.cancel.refundFailedBanner",

	PAYMENT_REFUND_REQUESTED: "orders.payment.refundRequested",
	PAYMENT_REFUNDED: "orders.payment.refunded",
	PAYMENT_REFUND_FAILED: "orders.payment.refundFailed",

	CARD_TABLE: "orders.card.table",
	CARD_DAY_NUMBER: "orders.card.dayNumber",
	CARD_PAID: "orders.card.paid",
	CARD_MORE_ITEMS: "orders.card.moreItems",

	TICKET_ORDER_NOTE: "orders.ticket.orderNote",
	TICKET_ITEM_CANCELLED_BADGE: "orders.ticket.itemCancelledBadge",
	ACTION_CANCEL_ITEM: "orders.ticket.cancelItem",
	CANCEL_ITEM_PROMPT: "orders.ticket.cancelItemPrompt",
	/** Paid-line variant: 86'ing refunds the line + fee share automatically (ADR 008). */
	CANCEL_ITEM_PAID_PROMPT: "orders.ticket.cancelItemPaidPrompt",
	ACTION_CONFIRM_CANCEL_ITEM: "orders.ticket.confirmCancelItem",
	ACTION_KEEP_ITEM: "orders.ticket.keepItem",

	// Substitutions on paid lines (ADR 008, TAVLI-71 Phase 3A)
	SUB_ACTION_PROPOSE: "orders.substitution.propose",
	SUB_PENDING_BADGE: "orders.substitution.pendingBadge",
	SUB_ACTION_CANCEL_PROPOSAL: "orders.substitution.cancelProposal",
	SUB_DIALOG_TITLE: "orders.substitution.dialogTitle",
	SUB_DIALOG_SUBTITLE: "orders.substitution.dialogSubtitle",
	SUB_DIALOG_EMPTY: "orders.substitution.dialogEmpty",
	SUB_DELTA_FREE: "orders.substitution.deltaFree",
	SUB_DELTA_PREVIEW: "orders.substitution.deltaPreview",
	SUB_DIALOG_CONFIRM: "orders.substitution.confirm",
	SUB_DIALOG_DISMISS: "orders.substitution.dismiss",
	TICKET_UNDO_READY: "orders.ticket.undoReady",
	TICKET_MARKED_READY: "orders.ticket.markedReady",
	TICKET_EMPTY_ALL_DONE: "orders.ticket.emptyAllDone",

	EMPTY_NO_FILTERS: "orders.empty.noFilters",
	EMPTY_NO_ORDERS: "orders.empty.noOrders",

	ARIA_FILTER: "orders.aria.filter",
	ARIA_STATUS_SEGMENTS: "orders.aria.statusSegments",
	ARIA_STATION_FILTER: "orders.aria.stationFilter",
	ARIA_CANCEL_ITEM: "orders.aria.cancelItem",
	ARIA_PROPOSE_SUBSTITUTION: "orders.aria.proposeSubstitution",
	ARIA_FULL_ORDER: "orders.aria.fullOrder",
	ARIA_LOADING: "orders.aria.loading",
} as const;

export type OrdersKey = (typeof OrdersKeys)[keyof typeof OrdersKeys];
