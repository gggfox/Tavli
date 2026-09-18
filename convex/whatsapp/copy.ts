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

export type BotCopy = {
	genericError: string;
	/**
	 * The sentence the `wa.me` deep link prefills into the diner's message box.
	 * They see it and can edit it before sending, so it has to read like
	 * something a person would write — the code rides along as a decoration.
	 */
	deepLinkPrefill: (restaurantName: string, formattedCode: string) => string;
	/**
	 * Sent when a message carried nothing but the routing code — the diner opened
	 * the deep link and deleted the sentence. There is no customer question to
	 * answer, so this is fixed copy rather than a model call.
	 */
	deepLinkWelcome: (restaurantName: string) => string;
	/**
	 * Sent when an inbound message cannot be routed to a restaurant at all.
	 * See `getUnroutableGuidance` — this is never sent alone.
	 */
	unroutableGuidance: string;
	/** Fallback `contact.name` when the customer gave none and Twilio sent none. */
	guestFallbackName: string;
	/**
	 * Appended when the assistant hands over the menu page. `url` is composed by
	 * the server from the restaurant's slug and the reply locale — the model is
	 * never shown it, so it cannot mangle or invent one.
	 */
	menuLink: (url: string) => string;
	/** Appended after a booking is created. `when` is a localized date+time. */
	bookingRequested: (when: string, partySize: number) => string;
	/**
	 * Appended when a booking is declined — one fixed line per reason, so the
	 * fact reaches the diner from code and the model's prose sits above it.
	 * Before this, failure was model prose over a bare reason code, which is
	 * how a restaurant with no tables was reported as "no tables at that time,
	 * try another?" for every time that will ever exist.
	 */
	bookingDeclinedNotAccepting: string;
	bookingDeclinedNoTables: (hasAlternatives: boolean) => string;
	bookingDeclinedOutsideHours: (openTime?: string, closeTime?: string) => string;
	bookingDeclinedBlackout: string;
	bookingDeclinedHorizon: (minAdvanceMinutes?: number, maxAdvanceDays?: number) => string;
	bookingDeclinedInvalidDateTime: string;
	bookingDeclinedInvalidPartySize: (maxPartySize?: number) => string;
	bookingDeclinedNotFound: string;
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
	/**
	 * The restaurant this thread belongs to is soft-deleted or deactivated.
	 * Honest and final — never a model call, because there is no business left
	 * to speak for.
	 */
	restaurantUnavailable: string;
	/**
	 * The restaurant is paused (`isActive: false`), not deleted — a state its
	 * owner controls and can reverse, so the diner is told it is temporary and
	 * nothing more (TAVLI-107).
	 */
	restaurantInactive: string;
	/**
	 * The restaurant's platform subscription has lapsed. Deliberately does NOT
	 * say why — the diner is not party to the restaurant's bill — just that the
	 * assistant is off and the restaurant itself is the way in. Never silence,
	 * never a model call: every model turn here is Tavli's own money.
	 */
	subscriptionLapsed: string;
	/**
	 * The ONE confirmation an opt-out transition earns (policy expects it), and
	 * the last thing the phone hears until it opts back in. Must say how to
	 * return. Sent bilingually via `getOptOutConfirmation` — the opt-out gate
	 * runs before routing, so there is no restaurant and no locale to resolve.
	 */
	optOutConfirmed: string;
	/** The one confirmation an opt-in (START/ALTA) transition earns. */
	optInConfirmed: string;
};

const COPY: Record<WhatsappLocale, BotCopy> = {
	[WHATSAPP_LOCALE.EN]: {
		genericError:
			"Sorry — I ran into a problem answering that. Please try again in a moment, or contact the restaurant directly.",
		deepLinkPrefill: (restaurantName, formattedCode) =>
			`Hi, I'd like information about ${restaurantName} · ${formattedCode}`,
		deepLinkWelcome: (restaurantName) =>
			`Hi! I'm the Tavli assistant for ${restaurantName}. Ask me about the menu, opening hours, or a table.`,
		unroutableGuidance:
			"I'm the Tavli assistant. To help you, open the restaurant's WhatsApp link or scan their QR code.",
		guestFallbackName: "WhatsApp guest",
		menuLink: (url) => `📋 The full menu, with photos and prices: ${url}`,
		bookingRequested: (when, partySize) =>
			`✅ Request sent: ${partySize} ${partySize === 1 ? "person" : "people"} on ${when}. The restaurant still has to confirm it — you are not seated yet, and they'll be in touch.`,
		bookingDeclinedNotAccepting:
			"This restaurant isn't taking reservations right now. I can still help with the menu, hours, and directions.",
		bookingDeclinedNoTables: (hasAlternatives) =>
			hasAlternatives
				? "That time is fully booked. The times above are the ones actually free."
				: "That time is fully booked, and nothing nearby is free either. Tell me another day or time and I'll check it.",
		bookingDeclinedOutsideHours: (openTime, closeTime) =>
			openTime && closeTime
				? `The restaurant is closed at that time — it's open ${openTime} to ${closeTime}. Pick a time inside those hours and I'll check it.`
				: "The restaurant is closed at that time. Pick a time inside its opening hours and I'll check it.",
		bookingDeclinedBlackout:
			"The restaurant isn't taking bookings for that date. Tell me another day and I'll check it.",
		bookingDeclinedHorizon: (minAdvanceMinutes, maxAdvanceDays) =>
			minAdvanceMinutes !== undefined && maxAdvanceDays !== undefined
				? `Bookings need at least ${minAdvanceMinutes} minutes' notice and can be made up to ${maxAdvanceDays} days ahead. Pick a time in that window and I'll check it.`
				: "That time is too soon or too far ahead to book. Pick another and I'll check it.",
		bookingDeclinedInvalidDateTime:
			"I couldn't read that date or time. Tell me the day and the time — like \"Saturday at 8pm\" — and I'll check it.",
		bookingDeclinedInvalidPartySize: (maxPartySize) =>
			maxPartySize !== undefined
				? `I can book parties of 1 to ${maxPartySize}. For a larger group, please contact the restaurant directly.`
				: "That party size doesn't work here. For a large group, please contact the restaurant directly.",
		bookingDeclinedNotFound:
			"This restaurant is no longer available for bookings here. Please contact them directly.",
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
		restaurantUnavailable:
			"This restaurant is no longer taking messages here. If you need to reach them, please contact the restaurant directly.",
		restaurantInactive:
			"This restaurant's assistant isn't available right now. Please contact the restaurant directly.",
		subscriptionLapsed:
			"The assistant isn't available for this restaurant right now. Please contact the restaurant directly.",
		optOutConfirmed:
			"Done — you won't receive any more WhatsApp messages from Tavli on this number. Send START to resume.",
		optInConfirmed:
			"You're back — Tavli will answer you on WhatsApp again. Send STOP whenever you want to leave.",
	},
	[WHATSAPP_LOCALE.ES]: {
		genericError:
			"Lo siento, tuve un problema para responder. Inténtalo de nuevo en un momento o contacta directamente al restaurante.",
		deepLinkPrefill: (restaurantName, formattedCode) =>
			`Hola, quiero información sobre ${restaurantName} · ${formattedCode}`,
		deepLinkWelcome: (restaurantName) =>
			`¡Hola! Soy el asistente de Tavli para ${restaurantName}. Pregúntame por el menú, los horarios o una mesa.`,
		unroutableGuidance:
			"Soy el asistente de Tavli. Para ayudarte, abre el enlace de WhatsApp del restaurante o escanea su código QR.",
		guestFallbackName: "Cliente de WhatsApp",
		menuLink: (url) => `📋 El menú completo, con fotos y precios: ${url}`,
		bookingRequested: (when, partySize) =>
			`✅ Solicitud enviada: ${partySize} ${partySize === 1 ? "persona" : "personas"} el ${when}. El restaurante aún debe confirmarla — todavía no hay mesa apartada y se pondrán en contacto.`,
		bookingDeclinedNotAccepting:
			"Este restaurante no está tomando reservaciones por ahora. Con gusto te ayudo con el menú, horarios y cómo llegar.",
		bookingDeclinedNoTables: (hasAlternatives) =>
			hasAlternatives
				? "Ese horario ya está lleno. Los horarios de arriba son los que sí están libres."
				: "Ese horario ya está lleno y no hay nada cerca disponible. Dime otro día u hora y lo reviso.",
		bookingDeclinedOutsideHours: (openTime, closeTime) =>
			openTime && closeTime
				? `A esa hora el restaurante está cerrado — abre de ${openTime} a ${closeTime}. Elige una hora dentro de ese horario y lo reviso.`
				: "A esa hora el restaurante está cerrado. Elige una hora dentro de su horario y lo reviso.",
		bookingDeclinedBlackout:
			"El restaurante no está tomando reservaciones para esa fecha. Dime otro día y lo reviso.",
		bookingDeclinedHorizon: (minAdvanceMinutes, maxAdvanceDays) =>
			minAdvanceMinutes !== undefined && maxAdvanceDays !== undefined
				? `Las reservaciones necesitan al menos ${minAdvanceMinutes} minutos de anticipación y se pueden hacer hasta con ${maxAdvanceDays} días de adelanto. Elige una hora dentro de ese rango y lo reviso.`
				: "Esa hora es demasiado pronto o demasiado lejana para reservar. Elige otra y lo reviso.",
		bookingDeclinedInvalidDateTime:
			'No entendí la fecha u hora. Dime el día y la hora — por ejemplo "el sábado a las 8" — y lo reviso.',
		bookingDeclinedInvalidPartySize: (maxPartySize) =>
			maxPartySize !== undefined
				? `Puedo reservar para grupos de 1 a ${maxPartySize} personas. Para un grupo más grande, contacta directamente al restaurante.`
				: "Ese número de personas no es posible aquí. Para un grupo grande, contacta directamente al restaurante.",
		bookingDeclinedNotFound:
			"Este restaurante ya no está disponible para reservar por aquí. Por favor contáctalos directamente.",
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
		restaurantUnavailable:
			"Este restaurante ya no recibe mensajes por aquí. Si necesitas comunicarte, contacta directamente al restaurante.",
		restaurantInactive:
			"El asistente de este restaurante no está disponible por ahora. Por favor contacta directamente al restaurante.",
		subscriptionLapsed:
			"El asistente no está disponible para este restaurante en este momento. Por favor contacta directamente al restaurante.",
		optOutConfirmed:
			"Listo — ya no recibirás más mensajes de WhatsApp de Tavli en este número. Envía ALTA para reactivar.",
		optInConfirmed:
			"De vuelta — Tavli volverá a responderte por WhatsApp. Envía BAJA cuando quieras dejar de recibir mensajes.",
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

/**
 * The reply for a message Tavli cannot route to any restaurant (ADR 012).
 *
 * Bilingual, and deliberately so: an unroutable message has no restaurant, so
 * there is no `defaultLocale` and no `defaultLanguage` to resolve against —
 * every input that would normally pick a language is exactly the input that is
 * missing. Two short lines beat guessing wrong on the first thing a stranger
 * ever sees from Tavli.
 *
 * It also names no restaurant and asks no questions. Trying to match a name the
 * diner typed against every restaurant Tavli knows would be an enumeration and
 * spoofing surface, so the assistant simply points back at the deep link.
 */
export function getUnroutableGuidance(): string {
	return [
		COPY[WHATSAPP_LOCALE.ES].unroutableGuidance,
		COPY[WHATSAPP_LOCALE.EN].unroutableGuidance,
	].join("\n\n");
}

/**
 * The single confirmation an opt-out transition earns, bilingual for the same
 * reason as `getUnroutableGuidance`: the consent gate runs before routing, so
 * every input that would pick a language is exactly the input that is missing.
 * It must tell the person how to come back — after this, the phone hears
 * nothing at all until it does.
 */
export function getOptOutConfirmation(): string {
	return [COPY[WHATSAPP_LOCALE.ES].optOutConfirmed, COPY[WHATSAPP_LOCALE.EN].optOutConfirmed].join(
		"\n\n"
	);
}

/** The single confirmation an opt-in (START/ALTA) transition earns. Bilingual, as above. */
export function getOptInConfirmation(): string {
	return [COPY[WHATSAPP_LOCALE.ES].optInConfirmed, COPY[WHATSAPP_LOCALE.EN].optInConfirmed].join(
		"\n\n"
	);
}

/** What the caller knows about the restaurant's rules, for lines that cite them. */
export type BookingDeclineContext = {
	hasAlternatives: boolean;
	openTime?: string;
	closeTime?: string;
	minAdvanceMinutes?: number;
	maxAdvanceDays?: number;
	maxPartySize?: number;
};

/**
 * The fixed line for a declined booking, by reason code — or `null` for a
 * reason this map does not know, so an unfamiliar code never gets a made-up
 * sentence. Every reason here is a fact the server established precisely;
 * the model only ever approximated them.
 */
export function bookingDeclinedNotice(
	copy: BotCopy,
	reason: string,
	ctx: BookingDeclineContext
): string | null {
	switch (reason) {
		case "ERROR_NOT_ACCEPTING_RESERVATIONS":
			return copy.bookingDeclinedNotAccepting;
		case "ERROR_NO_TABLES_AVAILABLE":
			return copy.bookingDeclinedNoTables(ctx.hasAlternatives);
		case "ERROR_OUTSIDE_OPERATING_HOURS":
			return copy.bookingDeclinedOutsideHours(ctx.openTime, ctx.closeTime);
		case "ERROR_BLACKOUT_WINDOW":
			return copy.bookingDeclinedBlackout;
		case "ERROR_OUTSIDE_BOOKING_HORIZON":
			return copy.bookingDeclinedHorizon(ctx.minAdvanceMinutes, ctx.maxAdvanceDays);
		case "ERROR_INVALID_DATE_OR_TIME":
			return copy.bookingDeclinedInvalidDateTime;
		case "ERROR_INVALID_PARTY_SIZE":
			return copy.bookingDeclinedInvalidPartySize(ctx.maxPartySize);
		case "ERROR_NOT_FOUND":
			return copy.bookingDeclinedNotFound;
		default:
			return null;
	}
}
