/**
 * Translation keys for the disputes surface (TAVLI-102).
 *
 * Its own file rather than an annexe of `PaymentsKeys`, for the same reason
 * `PayoutsKeys` is its own: a **payment** is a diner paying the restaurant, a
 * **dispute** is that diner's bank pulling the payment back, and mixing their
 * copy is how a manager ends up reading "payment failed" about a chargeback
 * their restaurant had nothing to do with.
 *
 * The tone the keys encode is the ticket's: name what happened, name the
 * order, say what happens next. Never an accusation — the reader is usually a
 * manager who did nothing wrong, and a chargeback is a bank's decision about a
 * card, not a judgement on their restaurant.
 *
 * The `NOTIFICATION_*` values are the bodies `convex/disputes.ts` stores on the
 * bell rows (`DISPUTE_NOTIFICATION_KEY`). They live here so the same strings
 * the backend writes are the ones the frontend resolves.
 */
export const DisputesKeys = {
	// The card on /admin/payments
	SECTION_TITLE: "disputes.section.title",
	SECTION_DESCRIPTION: "disputes.section.description",
	EMPTY_TITLE: "disputes.empty.title",
	EMPTY_DESCRIPTION: "disputes.empty.description",

	// The recovery summary, shown only while something is being repaid
	RECOVERY_TITLE: "disputes.recovery.title",
	RECOVERY_BODY: "disputes.recovery.body",
	RECOVERY_OUTSTANDING: "disputes.recovery.outstanding",
	RECOVERY_RECOVERED: "disputes.recovery.recovered",
	RECOVERY_OFF: "disputes.recovery.off",

	// One dispute in the list
	LIST_AMOUNT: "disputes.list.amount",
	LIST_ORDER: "disputes.list.order",
	LIST_ORDER_UNKNOWN: "disputes.list.orderUnknown",
	LIST_OPENED_ON: "disputes.list.openedOn",
	LIST_CLOSED_ON: "disputes.list.closedOn",
	LIST_REINSTATED_ON: "disputes.list.reinstatedOn",
	LIST_REASON_LABEL: "disputes.list.reasonLabel",
	LIST_NEXT_LABEL: "disputes.list.nextLabel",
	LIST_REFERENCE: "disputes.list.reference",
	LIST_LEDGER_LABEL: "disputes.list.ledgerLabel",
	LIST_LEDGER_LINE: "disputes.list.ledgerLine",

	// Statuses, in the restaurant's words rather than Stripe's
	STATUS_WARNING_NEEDS_RESPONSE: "disputes.status.warningNeedsResponse",
	STATUS_WARNING_UNDER_REVIEW: "disputes.status.warningUnderReview",
	STATUS_WARNING_CLOSED: "disputes.status.warningClosed",
	STATUS_NEEDS_RESPONSE: "disputes.status.needsResponse",
	STATUS_UNDER_REVIEW: "disputes.status.underReview",
	STATUS_WON: "disputes.status.won",
	STATUS_LOST: "disputes.status.lost",
	STATUS_UNKNOWN: "disputes.status.unknown",

	// "What happens next", per status
	NEXT_OPEN: "disputes.next.open",
	NEXT_WON: "disputes.next.won",
	NEXT_LOST_NO_RECOVERY: "disputes.next.lostNoRecovery",
	NEXT_LOST_WITH_RECOVERY: "disputes.next.lostWithRecovery",
	NEXT_LOST_SETTLED: "disputes.next.lostSettled",

	// The admin-only recovery control, in the Stripe section
	ADMIN_TITLE: "disputes.admin.title",
	ADMIN_DESCRIPTION: "disputes.admin.description",
	ADMIN_LABEL: "disputes.admin.label",
	ADMIN_HINT: "disputes.admin.hint",
	ADMIN_DISABLED_HINT: "disputes.admin.disabledHint",
	ADMIN_SAVE: "disputes.admin.save",
	ADMIN_SAVING: "disputes.admin.saving",
	ADMIN_SAVED: "disputes.admin.saved",
	ADMIN_INVALID: "disputes.admin.invalid",

	// Bodies the backend stores on notification rows
	NOTIFICATION_OPENED: "disputes.notification.opened",
	NOTIFICATION_WON: "disputes.notification.won",
	NOTIFICATION_LOST: "disputes.notification.lost",
	NOTIFICATION_LOST_WITH_RECOVERY: "disputes.notification.lostWithRecovery",
} as const;

export type DisputesKey = (typeof DisputesKeys)[keyof typeof DisputesKeys];
