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
	/** Appended when a move has been offered but nothing has moved yet. */
	rescheduleRequested: (from: string, to: string, code: string) => string;
	/** Sent when the customer redeems a reschedule code. */
	rescheduleConfirmed: (when: string) => string;
	/** The new time went while the code was live. */
	rescheduleNoLongerAvailable: string;
	/** Sent when a code is wrong, already used, or expired. */
	cancelCodeInvalid: string;
	/** The customer asked to cancel but has nothing cancellable. */
	nothingToCancel: string;
	/** Per-turn or hourly write budget exhausted. */
	tooManyRequests: string;
	/**
	 * The phone's daily message cap is spent. Sent ONCE per window and then not
	 * again — every further message goes unanswered, because replying to a flood
	 * is paying for it.
	 */
	dailyLimitReached: string;
	/** The platform-wide daily ceiling is spent. Served without calling the model. */
	platformBusy: string;
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
		rescheduleRequested: (from, to, code) =>
			`To move your booking from ${from} to ${to}, reply with this code: ${code}\n\nNothing changes until you send it — your existing booking on ${from} is still there. The code expires in 10 minutes.`,
		rescheduleConfirmed: (when) =>
			`✅ Moved: your booking is now ${when}. The restaurant still has to confirm it and will be in touch.`,
		rescheduleNoLongerAvailable:
			"That time was taken while the code was waiting. Your original booking has not changed — tell me another time and I'll check it.",
		cancelCodeInvalid:
			"That code isn't valid any more — it may have expired or already been used. Ask me to cancel again and I'll send a new one.",
		nothingToCancel:
			"I can't find an upcoming booking under this number. If you booked another way, please contact the restaurant directly.",
		tooManyRequests:
			"That's a lot of booking changes in a short time. Please contact the restaurant directly so they can help.",
		dailyLimitReached:
			"You've reached the number of messages I can answer today. I'll be able to reply again tomorrow — for anything urgent, please contact the restaurant directly.",
		platformBusy:
			"I'm handling an unusually high number of messages right now and can't answer this one. Please try again later, or contact the restaurant directly.",
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
		rescheduleRequested: (from, to, code) =>
			`Para cambiar tu reservación del ${from} al ${to}, responde con este código: ${code}\n\nNada cambia hasta que lo envíes — tu reservación del ${from} sigue en pie. El código expira en 10 minutos.`,
		rescheduleConfirmed: (when) =>
			`✅ Cambiada: tu reservación ahora es el ${when}. El restaurante aún debe confirmarla y se pondrán en contacto.`,
		rescheduleNoLongerAvailable:
			"Ese horario se ocupó mientras esperaba el código. Tu reservación original no cambió — dime otro horario y lo reviso.",
		cancelCodeInvalid:
			"Ese código ya no es válido — pudo expirar o ya se usó. Pídeme cancelar de nuevo y te envío uno nuevo.",
		nothingToCancel:
			"No encuentro una reservación próxima con este número. Si reservaste por otro medio, contacta directamente al restaurante.",
		tooManyRequests:
			"Son muchos cambios de reservación en poco tiempo. Contacta directamente al restaurante para que puedan ayudarte.",
		dailyLimitReached:
			"Llegaste al número de mensajes que puedo responder hoy. Mañana podré contestarte de nuevo — si es algo urgente, contacta directamente al restaurante.",
		platformBusy:
			"Estoy atendiendo muchísimos mensajes en este momento y no puedo responder este. Inténtalo más tarde o contacta directamente al restaurante.",
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
