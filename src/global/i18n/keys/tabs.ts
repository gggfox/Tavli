/**
 * Translation keys for the staff-facing open tabs view (`/admin/tabs`).
 * TAVLI-6: a tab is the shared Session balance a group settles at the end
 * of the visit — in-app via Stripe, or in person via staff.
 */
export const TabsKeys = {
	HEADER: "tabs.header",
	EMPTY: "tabs.empty",
	TABLE_LABEL: "tabs.tableLabel",
	NO_TABLE: "tabs.noTable",
	JOIN_CODE: "tabs.joinCode",
	MEMBERS: "tabs.members",
	ORDERS: "tabs.orders",
	UNPAID_TOTAL: "tabs.unpaidTotal",
	OPENED_AT: "tabs.openedAt",
	STALE_BADGE: "tabs.staleBadge",
	LOCKED_BADGE: "tabs.lockedBadge",
	CLOSE_TAB: "tabs.closeTab",
	CLOSE_TAB_CONFIRM: "tabs.closeTabConfirm",
	CLOSE_FAILED: "tabs.closeFailed",
} as const;

export type TabsKey = (typeof TabsKeys)[keyof typeof TabsKeys];
