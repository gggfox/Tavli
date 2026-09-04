/**
 * Translation keys for the WhatsApp assistant's staff- and diner-facing surfaces.
 *
 * Two groups, added by different tickets and deliberately kept in one namespace:
 * the distribution surfaces (the `wa.me` deep link and printable QR shown in
 * restaurant Settings and on the public menu page, ADR 012), and the staff-facing
 * conversation view (the list, the read-only thread panel, and the link that gets
 * staff there from the reservation the assistant booked, TAVLI-93).
 */
export const WhatsappKeys = {
	// Distribution surfaces — deep link and QR (ADR 012)
	ASSISTANT_TITLE: "whatsapp.assistant.title",
	ASSISTANT_HINT: "whatsapp.assistant.hint",
	ASSISTANT_NOT_ENABLED: "whatsapp.assistant.notEnabled",
	ASSISTANT_PAUSED: "whatsapp.assistant.paused",
	ASSISTANT_CODE_LABEL: "whatsapp.assistant.codeLabel",
	ASSISTANT_PREFILL_LABEL: "whatsapp.assistant.prefillLabel",
	ASSISTANT_OPEN_LINK: "whatsapp.assistant.openLink",
	ASSISTANT_COPY_LINK: "whatsapp.assistant.copyLink",
	ASSISTANT_COPIED: "whatsapp.assistant.copied",
	ASSISTANT_PRINT_QR: "whatsapp.assistant.printQr",
	ASSISTANT_QR_ALT: "whatsapp.assistant.qrAlt",
	ASSISTANT_SCAN_INSTRUCTION: "whatsapp.assistant.scanInstruction",
	ASSISTANT_NUMBER_MISSING: "whatsapp.assistant.numberMissing",
	ASSISTANT_ADMIN_ONLY: "whatsapp.assistant.adminOnly",
	ASSISTANT_REGENERATE: "whatsapp.assistant.regenerate",
	ASSISTANT_REGENERATE_HINT: "whatsapp.assistant.regenerateHint",
	ASSISTANT_ACTION_FAILED: "whatsapp.assistant.actionFailed",
	ASSISTANT_ENABLE: "whatsapp.assistant.enable",
	ASSISTANT_PAUSE: "whatsapp.assistant.pause",
	ASSISTANT_PUBLIC_CTA: "whatsapp.assistant.publicCta",
	/** Consent line (WhatsApp Business Messaging Policy): messaging is the opt-in. */
	ASSISTANT_CONSENT_NOTE: "whatsapp.assistant.consentNote",

	// Staff conversation view (TAVLI-93)
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
