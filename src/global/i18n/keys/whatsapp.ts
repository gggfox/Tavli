/**
 * Translation keys for the staff-facing WhatsApp conversation view (TAVLI-93):
 * the conversation list, the read-only thread panel, and the link that gets
 * staff there from the reservation the assistant booked.
 */
export const WhatsappKeys = {
	PAGE_SETUP_RESTAURANT_FIRST: "whatsapp.page.setupRestaurantFirst",

	// Conversation list
	LIST_ENTITY: "whatsapp.list.entity",
	LIST_SEARCH_PLACEHOLDER: "whatsapp.list.searchPlaceholder",
	LIST_RESULT_COUNT: "whatsapp.list.resultCount",
	LIST_EMPTY_TITLE: "whatsapp.list.emptyTitle",
	LIST_EMPTY_DESCRIPTION: "whatsapp.list.emptyDescription",
	LIST_FILTERED_EMPTY_TITLE: "whatsapp.list.filteredEmptyTitle",
	LIST_NOT_AUTHENTICATED: "whatsapp.list.notAuthenticated",
	LIST_TRUNCATED: "whatsapp.list.truncated",

	COLUMN_CUSTOMER: "whatsapp.column.customer",
	COLUMN_PHONE: "whatsapp.column.phone",
	COLUMN_STATUS: "whatsapp.column.status",
	COLUMN_LAST_ACTIVITY: "whatsapp.column.lastActivity",
	COLUMN_STARTED: "whatsapp.column.started",

	CUSTOMER_UNKNOWN: "whatsapp.customer.unknown",

	STATUS_ACTIVE: "whatsapp.status.active",
	STATUS_HANDOFF: "whatsapp.status.handoff",
	STATUS_CLOSED: "whatsapp.status.closed",

	// Thread panel
	THREAD_ARIA: "whatsapp.thread.aria",
	THREAD_CLOSE_ARIA: "whatsapp.thread.closeAria",
	THREAD_READ_ONLY: "whatsapp.thread.readOnly",
	THREAD_LOAD_OLDER: "whatsapp.thread.loadOlder",
	THREAD_LOADING: "whatsapp.thread.loading",
	THREAD_EMPTY: "whatsapp.thread.empty",
	THREAD_ERROR: "whatsapp.thread.error",
	THREAD_WINDOW_FULL: "whatsapp.thread.windowFull",

	SENDER_CUSTOMER: "whatsapp.sender.customer",
	SENDER_ASSISTANT: "whatsapp.sender.assistant",
	SENDER_SYSTEM: "whatsapp.sender.system",
	SENDER_STAFF: "whatsapp.sender.staff",

	MESSAGE_UNDELIVERED: "whatsapp.message.undelivered",
	MESSAGE_ATTACHMENT: "whatsapp.message.attachment",

	// Entry point on a reservation
	RESERVATION_LINK: "whatsapp.reservationLink.label",
} as const;

export type WhatsappKey = (typeof WhatsappKeys)[keyof typeof WhatsappKeys];
