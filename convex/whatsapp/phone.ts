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
