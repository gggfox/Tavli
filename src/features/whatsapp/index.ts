/**
 * WhatsApp assistant — the staff and diner surfaces around Tavli's assistant.
 *
 * A slice of its own rather than components inside `restaurants` or `ordering`,
 * because several features render it: staff print the deep-link QR from
 * Settings, diners follow the link from the public menu page (ADR 012), and
 * admins manage the spend allowlist.
 */
export * from "./components";
export { QrCode, qrSvgMarkup } from "./components/QrCode";
export { WhatsappAssistantLink } from "./components/WhatsappAssistantLink";
export { WhatsappAssistantPanel } from "./components/WhatsappAssistantPanel";
