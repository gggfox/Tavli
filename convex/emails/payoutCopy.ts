/**
 * Server-side copy for the payout emails (TAVLI-103).
 *
 * Convex code cannot import `src/global/i18n` (CLAUDE.md: `convex/` may only
 * import `convex/`), so the email carries its own `en`/`es` table — the same
 * shape the operator-alert and receipt emails use. What keeps the two halves
 * from drifting is that the failure table is keyed by the **same i18n key
 * strings** the payouts page renders (`PAYOUT_FAILURE_REASON_KEY` /
 * `PAYOUT_FAILURE_FIX_KEY` in `convex/constants.ts`), and
 * `renderPayoutEmail.test.ts` fails when a code is missing on either side.
 *
 * The copy order is fixed and is the point of the whole ticket: **reassurance
 * first, then the reason, then the fix.** A restaurant reading "payout failed"
 * assumes its money is gone. It is not — it is in the Stripe balance. Every
 * variant of this email therefore opens with that, before saying anything that
 * sounds like a problem.
 */
import {
	NOTIFICATION_KIND,
	PAYOUT_FAILURE_CODES,
	PAYOUT_FAILURE_FIX_KEY,
	PAYOUT_FAILURE_REASON_KEY,
	type NotificationKind,
	type PayoutFailureCode,
} from "../constants";
import { interpolate } from "./copy";
import type { InviteEmailLocale } from "./locale";

/** Which of the two payout emails this is. */
export type PayoutEmailKind =
	| typeof NOTIFICATION_KIND.PAYOUT_FAILED
	| typeof NOTIFICATION_KIND.PAYOUTS_RESUMED;

/** The reason/fix pair for one failure code. */
export type PayoutFailureCopy = {
	reason: string;
	fix: string;
};

/** Everything around the reason: subject, the reassurance, labels, footer. */
export type PayoutEmailChrome = {
	subject: string;
	preview: string;
	/** The reassurance line. Always first. */
	safeLine: string;
	heading: string;
	amountLabel: string;
	restaurantLabel: string;
	reasonLabel: string;
	fixLabel: string;
	cta: string;
	footerWhy: string;
	footerSentBy: string;
};

const FAILURE_COPY: Record<InviteEmailLocale, Record<PayoutFailureCode, PayoutFailureCopy>> = {
	en: {
		account_closed: {
			reason: "The bank account on file has been closed.",
			fix: "Add a current bank account in your Stripe details, and the money goes out on the next payout.",
		},
		account_frozen: {
			reason: "The bank has frozen the account, so it cannot receive transfers.",
			fix: "Ask your bank to release the account, or add a different one in your Stripe details.",
		},
		bank_account_restricted: {
			reason: "The bank account does not allow this kind of transfer.",
			fix: "Use a standard business or checking account — some savings and payroll accounts cannot receive payouts. Update it in your Stripe details.",
		},
		bank_ownership_changed: {
			reason: "The bank account has changed hands, so the details no longer match.",
			fix: "Re-enter the account in your Stripe details with the current holder's information.",
		},
		could_not_process: {
			reason: "The bank could not process the transfer this time. No reason was given.",
			fix: "Confirm the account details are right. Nothing else to do: the money goes out with the next scheduled payout, and most of these clear on their own.",
		},
		debit_not_authorized: {
			reason: "The account holder has not authorized transfers from this account.",
			fix: "Authorize the account with your bank, or add one that is already authorized in your Stripe details.",
		},
		declined: {
			reason: "The bank declined the transfer without saying why.",
			fix: "Ask your bank whether anything is blocking incoming transfers, then check the account details in Stripe.",
		},
		insufficient_funds: {
			reason: "Stripe reported not enough available balance to complete the payout.",
			fix: "Nothing to do on your side right now — the balance settles and the payout goes out again. Contact us if it repeats.",
		},
		invalid_account_number: {
			reason: "The account number (CLABE) is not valid.",
			fix: "Re-enter the account number in your Stripe details, digit for digit as it appears on your bank statement.",
		},
		incorrect_account_holder_name: {
			reason: "The account holder's name does not match the bank's records.",
			fix: "Update the holder's name in your Stripe details so it matches the bank exactly.",
		},
		incorrect_account_holder_address: {
			reason: "The account holder's address does not match the bank's records.",
			fix: "Update the holder's address in your Stripe details so it matches the bank.",
		},
		incorrect_account_holder_tax_id: {
			reason: "The account holder's tax ID (RFC) does not match the bank's records.",
			fix: "Update the tax ID in your Stripe details so it matches the bank.",
		},
		invalid_currency: {
			reason: "The bank account cannot receive money in this currency.",
			fix: "Add an account that accepts this currency in your Stripe details.",
		},
		no_account: {
			reason: "The bank could not find the account.",
			fix: "Check the account number and the bank in your Stripe details, and re-enter them.",
		},
		unsupported_card: {
			reason: "The debit card on file cannot receive payouts.",
			fix: "Add a bank account instead of a card in your Stripe details.",
		},
		unknown: {
			reason: "The bank refused the transfer and did not say why.",
			fix: "Check your bank details in Stripe. If they look right, contact us and we will look at it with you.",
		},
	},
	es: {
		account_closed: {
			reason: "La cuenta bancaria registrada está cerrada.",
			fix: "Registra una cuenta vigente en tus datos de Stripe y el dinero saldrá en el siguiente depósito.",
		},
		account_frozen: {
			reason: "El banco tiene la cuenta congelada, así que no puede recibir transferencias.",
			fix: "Pide a tu banco que la libere, o registra otra cuenta en tus datos de Stripe.",
		},
		bank_account_restricted: {
			reason: "La cuenta bancaria no admite este tipo de transferencia.",
			fix: "Usa una cuenta empresarial o de cheques — algunas cuentas de ahorro o de nómina no pueden recibir depósitos. Actualízala en tus datos de Stripe.",
		},
		bank_ownership_changed: {
			reason: "La cuenta bancaria cambió de titular, así que los datos ya no coinciden.",
			fix: "Vuelve a capturar la cuenta en tus datos de Stripe con la información del titular actual.",
		},
		could_not_process: {
			reason: "El banco no pudo procesar la transferencia esta vez. No dio un motivo.",
			fix: "Confirma que los datos de la cuenta estén correctos. No hay nada más que hacer: el dinero sale con el siguiente depósito programado, y casi siempre se resuelve solo.",
		},
		debit_not_authorized: {
			reason: "El titular no ha autorizado transferencias desde esta cuenta.",
			fix: "Autoriza la cuenta con tu banco, o registra una que ya esté autorizada en tus datos de Stripe.",
		},
		declined: {
			reason: "El banco rechazó la transferencia sin indicar el motivo.",
			fix: "Pregunta a tu banco si algo bloquea las transferencias entrantes y revisa los datos de la cuenta en Stripe.",
		},
		insufficient_funds: {
			reason: "Stripe reportó saldo disponible insuficiente para completar el depósito.",
			fix: "Por ahora no hay nada que hacer de tu lado: el saldo se liquida y el depósito vuelve a salir. Escríbenos si se repite.",
		},
		invalid_account_number: {
			reason: "El número de cuenta (CLABE) no es válido.",
			fix: "Vuelve a capturar el número de cuenta en tus datos de Stripe, dígito por dígito como aparece en tu estado de cuenta.",
		},
		incorrect_account_holder_name: {
			reason: "El nombre del titular no coincide con el registro del banco.",
			fix: "Actualiza el nombre del titular en tus datos de Stripe para que coincida exactamente con el banco.",
		},
		incorrect_account_holder_address: {
			reason: "La dirección del titular no coincide con el registro del banco.",
			fix: "Actualiza la dirección del titular en tus datos de Stripe para que coincida con el banco.",
		},
		incorrect_account_holder_tax_id: {
			reason: "El RFC del titular no coincide con el registro del banco.",
			fix: "Actualiza el RFC en tus datos de Stripe para que coincida con el banco.",
		},
		invalid_currency: {
			reason: "La cuenta bancaria no puede recibir dinero en esta moneda.",
			fix: "Registra en tus datos de Stripe una cuenta que acepte esta moneda.",
		},
		no_account: {
			reason: "El banco no encontró la cuenta.",
			fix: "Revisa el número de cuenta y el banco en tus datos de Stripe, y vuelve a capturarlos.",
		},
		unsupported_card: {
			reason: "La tarjeta de débito registrada no puede recibir depósitos.",
			fix: "Registra una cuenta bancaria en lugar de una tarjeta en tus datos de Stripe.",
		},
		unknown: {
			reason: "El banco rechazó la transferencia y no dijo por qué.",
			fix: "Revisa tus datos bancarios en Stripe. Si se ven correctos, escríbenos y lo revisamos contigo.",
		},
	},
};

const CHROME: Record<InviteEmailLocale, Record<PayoutEmailKind, PayoutEmailChrome>> = {
	en: {
		payout_failed: {
			subject: "Your payout did not reach your bank — the money is safe",
			preview: "Your money is safe in Tavli. Your bank did not accept the transfer.",
			safeLine: "This money is yours and it is safe.",
			heading: "A payout did not reach your bank",
			amountLabel: "Amount held",
			restaurantLabel: "Restaurant",
			reasonLabel: "Why it did not go through",
			fixLabel: "How to fix it",
			cta: "Review your payouts",
			footerWhy: "You get this because you manage this restaurant on Tavli.",
			footerSentBy: "Sent by Tavli",
		},
		payouts_resumed: {
			subject: "Your payouts are flowing again",
			preview: "Your bank accepted a payout. Nothing further is needed.",
			safeLine: "Your money reached your bank.",
			heading: "Payouts are flowing again",
			amountLabel: "Amount paid out",
			restaurantLabel: "Restaurant",
			reasonLabel: "What happened",
			fixLabel: "What to do now",
			cta: "Review your payouts",
			footerWhy: "You get this because you manage this restaurant on Tavli.",
			footerSentBy: "Sent by Tavli",
		},
	},
	es: {
		payout_failed: {
			subject: "Tu depósito no llegó al banco — tu dinero está seguro",
			preview: "Tu dinero está seguro en Tavli. Tu banco no aceptó la transferencia.",
			safeLine: "Este dinero es tuyo y está seguro.",
			heading: "Un depósito no llegó a tu banco",
			amountLabel: "Monto retenido",
			restaurantLabel: "Restaurante",
			reasonLabel: "Por qué no se completó",
			fixLabel: "Cómo resolverlo",
			cta: "Revisar tus depósitos",
			footerWhy: "Recibes esto porque administras este restaurante en Tavli.",
			footerSentBy: "Enviado por Tavli",
		},
		payouts_resumed: {
			subject: "Tus depósitos vuelven a salir",
			preview: "Tu banco aceptó un depósito. No necesitas hacer nada más.",
			safeLine: "Tu dinero llegó a tu banco.",
			heading: "Los depósitos vuelven a salir",
			amountLabel: "Monto depositado",
			restaurantLabel: "Restaurante",
			reasonLabel: "Qué pasó",
			fixLabel: "Qué hacer ahora",
			cta: "Revisar tus depósitos",
			footerWhy: "Recibes esto porque administras este restaurante en Tavli.",
			footerSentBy: "Enviado por Tavli",
		},
	},
};

/** What "payouts resumed" says in place of a failure reason. */
const RESUMED_COPY: Record<InviteEmailLocale, PayoutFailureCopy> = {
	en: {
		reason: "Your bank accepted a payout, so the amount that was held has now moved.",
		fix: "Nothing — you are all set. Payouts continue on their normal schedule.",
	},
	es: {
		reason: "Tu banco aceptó un depósito, así que el monto retenido ya se movió.",
		fix: "Nada — todo está listo. Los depósitos continúan en su horario normal.",
	},
};

export function getPayoutEmailChrome(
	locale: InviteEmailLocale,
	kind: PayoutEmailKind
): PayoutEmailChrome {
	return CHROME[locale][kind];
}

export function getPayoutFailureCopy(
	locale: InviteEmailLocale,
	code: PayoutFailureCode
): PayoutFailureCopy {
	return FAILURE_COPY[locale][code];
}

export function getPayoutsResumedCopy(locale: InviteEmailLocale): PayoutFailureCopy {
	return RESUMED_COPY[locale];
}

/**
 * Every i18n key this module can render, per locale — keyed by the same strings
 * `convex/constants.ts` gives the page, so the email and the page can only drift
 * if `renderPayoutEmail.test.ts` goes red.
 */
function copyByKey(locale: InviteEmailLocale): Record<string, string> {
	const entries: Record<string, string> = {};
	for (const code of PAYOUT_FAILURE_CODES) {
		const copy = FAILURE_COPY[locale][code];
		entries[PAYOUT_FAILURE_REASON_KEY[code]] = copy.reason;
		entries[PAYOUT_FAILURE_FIX_KEY[code]] = copy.fix;
	}
	return entries;
}

export const PAYOUT_COPY_BY_KEY: Record<InviteEmailLocale, Record<string, string>> = {
	en: copyByKey("en"),
	es: copyByKey("es"),
};

/**
 * Render one of this module's keys in one locale, falling back to the key
 * itself — ugly but still identifying, exactly as `translateOperatorAlertKey`
 * does, because an empty line tells the reader nothing and a throw would lose
 * the email.
 */
export function translatePayoutKey(
	locale: InviteEmailLocale,
	key: string,
	params?: Record<string, string | number>
): string {
	const template = PAYOUT_COPY_BY_KEY[locale][key] ?? key;
	if (!params) return template;
	const stringParams: Record<string, string> = {};
	for (const [name, value] of Object.entries(params)) stringParams[name] = String(value);
	return interpolate(template, stringParams);
}

/** Exported for the parity test: the kinds this module has chrome for. */
export const PAYOUT_EMAIL_KINDS: PayoutEmailKind[] = [
	NOTIFICATION_KIND.PAYOUT_FAILED,
	NOTIFICATION_KIND.PAYOUTS_RESUMED,
];

/** Narrowing guard so an action's `kind` argument cannot be anything else. */
export function isPayoutEmailKind(kind: NotificationKind): kind is PayoutEmailKind {
	return (PAYOUT_EMAIL_KINDS as NotificationKind[]).includes(kind);
}
