/**
 * Translation keys for the WhatsApp assistant's distribution surfaces: the
 * `wa.me` deep link and the printable QR code, shown both to staff in restaurant
 * Settings and to diners on the public menu page (ADR 012).
 */
export const WhatsappKeys = {
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
} as const;

export type WhatsappKey = (typeof WhatsappKeys)[keyof typeof WhatsappKeys];
