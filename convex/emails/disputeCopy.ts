/**
 * Server-side copy for the dispute emails (TAVLI-102).
 *
 * Convex code cannot import `src/global/i18n` (CLAUDE.md: `convex/` may only
 * import `convex/`), so the email carries its own `en`/`es` table — the same
 * shape the payout and operator-alert emails use.
 *
 * **The tone is the ticket.** A chargeback email is the one piece of mail most
 * likely to be read as an accusation, and the reader is usually a manager who
 * has done nothing wrong: a diner's bank has pulled a payment back, often for
 * a card the restaurant never physically saw. So every variant leads with what
 * happened in plain terms, names the order, and then says what happens next —
 * including, on a loss, whether anything will actually be withheld. It never
 * asks them to do something they cannot do: evidence submission is out of scope
 * for this ticket and the copy does not pretend otherwise.
 *
 * The `{{percent}}` variant of the "lost" copy is not decoration. Telling a
 * restaurant with recovery switched off that we will take a cut of future
 * orders would be false; telling one with 25% configured nothing at all would
 * make the first short payout a nasty surprise.
 */
import { NOTIFICATION_KIND, type NotificationKind } from "../constants";
import { interpolate } from "./copy";
import type { InviteEmailLocale } from "./locale";

/** Which of the three dispute emails this is. */
export type DisputeEmailKind =
	| typeof NOTIFICATION_KIND.DISPUTE_OPENED
	| typeof NOTIFICATION_KIND.DISPUTE_WON
	| typeof NOTIFICATION_KIND.DISPUTE_LOST;

/** Everything around the detail: subject, opening line, labels, footer. */
export type DisputeEmailChrome = {
	subject: string;
	preview: string;
	/** The opening line. Calm, factual, never an accusation. */
	leadLine: string;
	heading: string;
	amountLabel: string;
	restaurantLabel: string;
	orderLabel: string;
	whatHappenedLabel: string;
	whatHappened: string;
	whatNextLabel: string;
	/** What happens next when no money will be withheld. */
	whatNext: string;
	/**
	 * What happens next when recovery is configured. `{{percent}}` is the
	 * restaurant's own percentage. Only the "lost" variant uses it.
	 */
	whatNextWithRecovery: string;
	cta: string;
	footerWhy: string;
	footerSentBy: string;
};

const CHROME: Record<InviteEmailLocale, Record<DisputeEmailKind, DisputeEmailChrome>> = {
	en: {
		dispute_opened: {
			subject: "A diner's bank has questioned a payment",
			preview: "A payment on one of your orders is being reviewed by the diner's bank.",
			leadLine: "A diner's bank is questioning one of your payments.",
			heading: "A payment is under review",
			amountLabel: "Amount in question",
			restaurantLabel: "Restaurant",
			orderLabel: "Order",
			whatHappenedLabel: "What happened",
			whatHappened:
				"The diner's bank has opened a dispute over this charge. That is normal and it does not mean anything is wrong with your restaurant — most disputes are raised over a card the holder did not recognise.",
			whatNextLabel: "What happens next",
			whatNext:
				"Tavli handles the dispute with Stripe. Nothing is being withheld from you while it is open, and we will write to you again when it is resolved.",
			whatNextWithRecovery:
				"Tavli handles the dispute with Stripe. Nothing is being withheld from you while it is open, and we will write to you again when it is resolved.",
			cta: "See your payments",
			footerWhy: "You get this because you manage this restaurant on Tavli.",
			footerSentBy: "Sent by Tavli",
		},
		dispute_won: {
			subject: "The disputed payment was resolved in your favour",
			preview: "The bank sided with you. Nothing is owed.",
			leadLine: "The dispute was resolved in your favour.",
			heading: "The payment stands",
			amountLabel: "Amount",
			restaurantLabel: "Restaurant",
			orderLabel: "Order",
			whatHappenedLabel: "What happened",
			whatHappened:
				"The diner's bank closed the dispute and the payment stands. The money is yours.",
			whatNextLabel: "What happens next",
			whatNext:
				"Nothing — you are all set. If anything had already been withheld for this dispute, it is on its way back to your account.",
			whatNextWithRecovery:
				"Nothing — you are all set. If anything had already been withheld for this dispute, it is on its way back to your account.",
			cta: "See your payments",
			footerWhy: "You get this because you manage this restaurant on Tavli.",
			footerSentBy: "Sent by Tavli",
		},
		dispute_lost: {
			subject: "The disputed payment went back to the diner",
			preview: "The bank sided with the diner on one of your orders.",
			leadLine: "The diner's bank decided in their favour.",
			heading: "A disputed payment was reversed",
			amountLabel: "Amount reversed",
			restaurantLabel: "Restaurant",
			orderLabel: "Order",
			whatHappenedLabel: "What happened",
			whatHappened:
				"The bank returned this payment to the diner. Banks decide these cases and the decision is final; it is not a judgement on your restaurant.",
			whatNextLabel: "What happens next",
			whatNext:
				"Nothing is being withheld from your future payouts. Tavli covers this one. Your sales figures are unchanged — the reversal is its own line in your payments.",
			whatNextWithRecovery:
				"To cover the reversal, {{percent}}% of the food subtotal on your next orders is held back until the amount above is repaid — never more than that, never from tips, and the amount your diners pay does not change. Your sales figures are unchanged; the recovery is its own line in your payments.",
			cta: "See your payments",
			footerWhy: "You get this because you manage this restaurant on Tavli.",
			footerSentBy: "Sent by Tavli",
		},
	},
	es: {
		dispute_opened: {
			subject: "El banco de un comensal está revisando un pago",
			preview: "El banco de un comensal está revisando un pago de uno de tus pedidos.",
			leadLine: "El banco de un comensal está cuestionando uno de tus pagos.",
			heading: "Un pago está en revisión",
			amountLabel: "Monto en revisión",
			restaurantLabel: "Restaurante",
			orderLabel: "Pedido",
			whatHappenedLabel: "Qué pasó",
			whatHappened:
				"El banco del comensal abrió una disputa por este cargo. Es algo normal y no significa que haya un problema con tu restaurante — casi siempre se abren porque el titular no reconoció el cargo.",
			whatNextLabel: "Qué sigue",
			whatNext:
				"Tavli se encarga de la disputa con Stripe. No se te está reteniendo nada mientras está abierta, y te escribiremos de nuevo cuando se resuelva.",
			whatNextWithRecovery:
				"Tavli se encarga de la disputa con Stripe. No se te está reteniendo nada mientras está abierta, y te escribiremos de nuevo cuando se resuelva.",
			cta: "Ver tus pagos",
			footerWhy: "Recibes esto porque administras este restaurante en Tavli.",
			footerSentBy: "Enviado por Tavli",
		},
		dispute_won: {
			subject: "La disputa se resolvió a tu favor",
			preview: "El banco te dio la razón. No debes nada.",
			leadLine: "La disputa se resolvió a tu favor.",
			heading: "El pago se mantiene",
			amountLabel: "Monto",
			restaurantLabel: "Restaurante",
			orderLabel: "Pedido",
			whatHappenedLabel: "Qué pasó",
			whatHappened:
				"El banco del comensal cerró la disputa y el pago se mantiene. El dinero es tuyo.",
			whatNextLabel: "Qué sigue",
			whatNext:
				"Nada — todo está listo. Si ya se había retenido algo por esta disputa, va de regreso a tu cuenta.",
			whatNextWithRecovery:
				"Nada — todo está listo. Si ya se había retenido algo por esta disputa, va de regreso a tu cuenta.",
			cta: "Ver tus pagos",
			footerWhy: "Recibes esto porque administras este restaurante en Tavli.",
			footerSentBy: "Enviado por Tavli",
		},
		dispute_lost: {
			subject: "El pago en disputa regresó al comensal",
			preview: "El banco le dio la razón al comensal en uno de tus pedidos.",
			leadLine: "El banco del comensal resolvió a su favor.",
			heading: "Un pago en disputa fue revertido",
			amountLabel: "Monto revertido",
			restaurantLabel: "Restaurante",
			orderLabel: "Pedido",
			whatHappenedLabel: "Qué pasó",
			whatHappened:
				"El banco devolvió este pago al comensal. Estos casos los decide el banco y la decisión es definitiva; no es un juicio sobre tu restaurante.",
			whatNextLabel: "Qué sigue",
			whatNext:
				"No se retendrá nada de tus depósitos futuros. Tavli absorbe este caso. Tus cifras de ventas no cambian — la reversión aparece como su propia línea en tus pagos.",
			whatNextWithRecovery:
				"Para cubrir la reversión, se retiene el {{percent}}% del subtotal de alimentos de tus siguientes pedidos hasta cubrir el monto de arriba — nunca más que eso, nunca de las propinas, y lo que pagan tus comensales no cambia. Tus cifras de ventas no cambian; la recuperación aparece como su propia línea en tus pagos.",
			cta: "Ver tus pagos",
			footerWhy: "Recibes esto porque administras este restaurante en Tavli.",
			footerSentBy: "Enviado por Tavli",
		},
	},
};

export function getDisputeEmailChrome(
	locale: InviteEmailLocale,
	kind: DisputeEmailKind
): DisputeEmailChrome {
	return CHROME[locale][kind];
}

/**
 * The "what happens next" paragraph for one email, with the recovery
 * percentage already interpolated when there is one.
 */
export function getDisputeWhatNext(
	locale: InviteEmailLocale,
	kind: DisputeEmailKind,
	recoveryPercent: number
): string {
	const chrome = CHROME[locale][kind];
	if (recoveryPercent <= 0) return chrome.whatNext;
	return interpolate(chrome.whatNextWithRecovery, { percent: String(recoveryPercent) });
}

/** Exported for the parity test: the kinds this module has chrome for. */
export const DISPUTE_EMAIL_KINDS: DisputeEmailKind[] = [
	NOTIFICATION_KIND.DISPUTE_OPENED,
	NOTIFICATION_KIND.DISPUTE_WON,
	NOTIFICATION_KIND.DISPUTE_LOST,
];

/** Narrowing guard so an action's `kind` argument cannot be anything else. */
export function isDisputeEmailKind(kind: NotificationKind): kind is DisputeEmailKind {
	return (DISPUTE_EMAIL_KINDS as NotificationKind[]).includes(kind);
}
