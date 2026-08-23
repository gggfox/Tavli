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
 * WhatsApp reports Mexican mobiles with a legacy `1` after the country code
 * (`+52 1 811 490 6208`), a carrier-era mobile marker Mexico dropped for
 * dialling in 2019. The dialable, canonical number is `+52 811 490 6208`.
 *
 * This matters beyond cosmetics: a phone number IS the assistant's identity
 * (ADR-011), and `findUpcomingByPhone` matches `contact.phone` through an exact
 * index lookup. Stored verbatim, the same human is two different customers —
 * one who booked over WhatsApp, one who booked on the web form — so the
 * assistant cannot find, list, or cancel a booking they made anywhere else. It
 * also leaves the restaurant a number that does not dial.
 *
 * Deliberately narrow. Argentina (+54) is the mirror case: WhatsApp reports
 * mobiles as `+54 9 ...` and there the `9` IS required internationally, so
 * stripping it would break the number. Only the known `+521` + 10-digit shape
 * is rewritten; everything else passes through untouched.
 *
 * Use for storage, matching and display. Never for addressing an outbound
 * message — send to the address Twilio used, via `toWhatsappAddress`.
 */
export function toCanonicalE164(raw: string): string {
	const bare = normalizePhone(raw);
	const mexicanMobile = /^\+521(\d{10})$/.exec(bare);
	return mexicanMobile ? `+52${mexicanMobile[1]}` : bare;
}
