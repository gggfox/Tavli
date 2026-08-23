/**
 * WhatsApp assistant — the distribution surfaces for the deep link and QR code
 * that route a diner to one restaurant's assistant (ADR 012).
 *
 * A slice of its own rather than components inside `restaurants` or `ordering`,
 * because both of those render it: staff print the QR from Settings and diners
 * follow the link from the public menu page.
 */
export { QrCode, qrSvgMarkup } from "./components/QrCode";
export { WhatsappAssistantLink } from "./components/WhatsappAssistantLink";
export { WhatsappAssistantPanel } from "./components/WhatsappAssistantPanel";
