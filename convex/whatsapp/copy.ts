/**
 * Fixed, deterministic bot copy.
 *
 * Two kinds of string live here, and both exist because they must NOT come from
 * the model:
 *
 * 1. **Error fallbacks** — used when the LLM turn itself failed, so a live model
 *    call is not available.
 * 2. **Confirmation facts** — appended to a reply after a write. The model
 *    narrates freely and will happily report a cancellation that failed, or claim
 *    a table is held when the booking is only `pending`. So the *facts* are
 *    composed here in code; the model's prose sits above them.
 *
 * Mirrors the per-locale copy-map pattern in `convex/emails/copy.ts`.
 */
import { WHATSAPP_LOCALE, type WhatsappLocale } from "../constants";

type BotCopy = {
	genericError: string;
	/** Fallback `contact.name` when the customer gave none and Twilio sent none. */
	guestFallbackName: string;
	/** Appended after a booking is created. `when` is a localized date+time. */
	bookingRequested: (when: string, partySize: number) => string;
	/** Appended when a cancellation code has been issued but nothing cancelled yet. */
	cancelRequested: (when: string, code: string) => string;
	/** Sent when the customer replies with a valid code. */
	cancelConfirmed: (when: string) => string;
	/** Sent when a code is wrong, already used, or expired. */
	cancelCodeInvalid: string;
	/** The customer asked to cancel but has nothing cancellable. */
	nothingToCancel: string;
	/** Per-turn or hourly write budget exhausted. */
	tooManyRequests: string;
};

const COPY: Record<WhatsappLocale, BotCopy> = {
	[WHATSAPP_LOCALE.EN]: {
		genericError:
			"Sorry — I ran into a problem answering that. Please try again in a moment, or contact the restaurant directly.",
		guestFallbackName: "WhatsApp guest",
		bookingRequested: (when, partySize) =>
			`✅ Request sent: ${partySize} ${partySize === 1 ? "person" : "people"} on ${when}. The restaurant still has to confirm it — you are not seated yet, and they'll be in touch.`,
		cancelRequested: (when, code) =>
			`To cancel your booking on ${when}, reply with this code: ${code}\n\nIt stays active until you send the code. The code expires in 10 minutes.`,
		cancelConfirmed: (when) =>
			`✅ Cancelled: your booking on ${when}. The restaurant has been notified.`,
		cancelCodeInvalid:
			"That code isn't valid any more — it may have expired or already been used. Ask me to cancel again and I'll send a new one.",
		nothingToCancel:
			"I can't find an upcoming booking under this number. If you booked another way, please contact the restaurant directly.",
		tooManyRequests:
			"That's a lot of booking changes in a short time. Please contact the restaurant directly so they can help.",
	},
	[WHATSAPP_LOCALE.ES]: {
		genericError:
			"Lo siento, tuve un problema para responder. Inténtalo de nuevo en un momento o contacta directamente al restaurante.",
		guestFallbackName: "Cliente de WhatsApp",
		bookingRequested: (when, partySize) =>
			`✅ Solicitud enviada: ${partySize} ${partySize === 1 ? "persona" : "personas"} el ${when}. El restaurante aún debe confirmarla — todavía no hay mesa apartada y se pondrán en contacto.`,
		cancelRequested: (when, code) =>
			`Para cancelar tu reservación del ${when}, responde con este código: ${code}\n\nSigue activa hasta que envíes el código. El código expira en 10 minutos.`,
		cancelConfirmed: (when) =>
			`✅ Cancelada: tu reservación del ${when}. El restaurante ya fue notificado.`,
		cancelCodeInvalid:
			"Ese código ya no es válido — pudo expirar o ya se usó. Pídeme cancelar de nuevo y te envío uno nuevo.",
		nothingToCancel:
			"No encuentro una reservación próxima con este número. Si reservaste por otro medio, contacta directamente al restaurante.",
		tooManyRequests:
			"Son muchos cambios de reservación en poco tiempo. Contacta directamente al restaurante para que puedan ayudarte.",
	},
};

/**
 * Pick a reply locale from the first candidate that looks like Spanish/English
 * (e.g. conversation locale → channel default → restaurant defaultLanguage),
 * defaulting to English.
 */
export function resolveLocale(...candidates: (string | null | undefined)[]): WhatsappLocale {
	for (const candidate of candidates) {
		const c = candidate?.toLowerCase();
		if (c?.startsWith("es")) return WHATSAPP_LOCALE.ES;
		if (c?.startsWith("en")) return WHATSAPP_LOCALE.EN;
	}
	return WHATSAPP_LOCALE.EN;
}

export function getBotCopy(locale: WhatsappLocale): BotCopy {
	return COPY[locale];
}
