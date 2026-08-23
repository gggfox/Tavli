import { normalizeContactPhone } from "../_util/phone";

/**
 * Twilio addresses WhatsApp numbers as `whatsapp:+14155238886`. We store and
 * index the bare E.164 form (`+14155238886`) so routing and dedupe lookups are
 * consistent regardless of the channel prefix. Normalization must be applied
 * on every inbound `From`/`To` before it is stored or used in an index lookup.
 */
export function normalizePhone(raw: string): string {
	return raw
		.trim()
		.replace(/^whatsapp:/i, "")
		.trim();
}

/** Re-attach the `whatsapp:` channel prefix for an outbound Twilio address. */
export function toWhatsappAddress(e164: string): string {
	const bare = normalizePhone(e164);
	return `whatsapp:${bare}`;
}

/**
 * Canonical E.164 identity for a customer, distinct from their WhatsApp
 * transport address.
 *
 * Thin wrapper over the shared `normalizeContactPhone`, which every reservation
 * write path also runs — that shared form is the whole point, since a booking
 * made here has to be findable next to one staff typed by hand. Twilio always
 * delivers a `+`-prefixed number, so no country context is needed.
 *
 * Use for storage, matching and display. Never for addressing an outbound
 * message — send to the address Twilio used, via `toWhatsappAddress`.
 */
export function toCanonicalE164(raw: string): string {
	return normalizeContactPhone(normalizePhone(raw), undefined);
}
