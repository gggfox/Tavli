/**
 * Server-side copy for the severe-alert email (TAVLI-109).
 *
 * Convex code cannot import `src/global/i18n` (CLAUDE.md: `convex/` may only
 * import `convex/`), so the email carries its own `en`/`es` table — the same
 * shape the team-invite and receipt emails use. What keeps the two halves from
 * drifting is that this table is keyed by the **same i18n key strings** the
 * alerts page renders (`OPERATOR_ALERT_TITLE_KEY` /
 * `OPERATOR_ALERT_EXPLANATION_KEY` in `convex/constants.ts`), and
 * `operatorAlertCopy.test.ts` fails when a kind is missing on either side.
 */
import {
	OPERATOR_ALERT_EXPLANATION_KEY,
	OPERATOR_ALERT_KINDS,
	OPERATOR_ALERT_SEVERITY,
	OPERATOR_ALERT_TITLE_KEY,
	type OperatorAlertKind,
	type OperatorAlertSeverity,
} from "../constants";
import { interpolate } from "./copy";
import type { InviteEmailLocale } from "./locale";

/** The two lines that describe one kind of problem. */
export type OperatorAlertKindCopy = {
	title: string;
	explanation: string;
};

/** Everything around the alert itself: subject, labels, footer. */
export type OperatorAlertEmailChrome = {
	subject: string;
	preview: string;
	heading: string;
	severityLabel: string;
	severities: Record<OperatorAlertSeverity, string>;
	restaurantLabel: string;
	referenceLabel: string;
	cta: string;
	footerWhy: string;
	footerSentBy: string;
};

const KIND_COPY: Record<InviteEmailLocale, Record<OperatorAlertKind, OperatorAlertKindCopy>> = {
	en: {
		payment_stuck: {
			title: "Payment stuck",
			explanation:
				"A payment has sat in a non-final state for too long. Check it in Stripe and settle or cancel it before the diner disputes the charge.",
		},
		charge_unmatched: {
			title: "Charge matches no order",
			explanation:
				"Stripe took money that Tavli cannot tie to any payment record. Nobody has been credited for it — find the charge in Stripe and decide whose it is.",
		},
		charge_mismatched_refunded: {
			title: "Charge refunded: amount did not match",
			explanation:
				"A charge arrived for a different amount than the order it names, so Tavli refunded it rather than keep money it could not account for. The order is still unpaid.",
		},
		dispute_lost: {
			title: "Dispute lost",
			explanation:
				"A card network decided a dispute against the restaurant. The money and the dispute fee are gone; the restaurant needs telling.",
		},
		dashboard_refund: {
			title: "Refund issued outside Tavli",
			explanation:
				"A refund was made from the Stripe Dashboard rather than through Tavli, so the order and the payout it feeds no longer agree with Stripe.",
		},
		payout_failed: {
			title: "Payout failed",
			explanation:
				"Stripe could not pay the restaurant. Their bank details or account status need fixing before the money can move.",
		},
		account_closed: {
			title: "Connected account closed",
			explanation:
				"The restaurant's Stripe account was closed or rejected, so it cannot take payments. Diners will fail at checkout until it is restored.",
		},
		restaurant_missing_contact_email: {
			title: "Restaurant has no contact email",
			explanation:
				"This restaurant has no contact email, so Tavli cannot reach its operator about anything — receipts, disputes, or this alert.",
		},
	},
	es: {
		payment_stuck: {
			title: "Pago atorado",
			explanation:
				"Un pago lleva demasiado tiempo sin llegar a un estado final. Revísalo en Stripe y complétalo o cancélalo antes de que el comensal lo dispute.",
		},
		charge_unmatched: {
			title: "Cargo sin orden asociada",
			explanation:
				"Stripe cobró dinero que Tavli no puede ligar a ningún registro de pago. Nadie ha recibido ese crédito: busca el cargo en Stripe y define de quién es.",
		},
		charge_mismatched_refunded: {
			title: "Cargo reembolsado: el monto no coincidía",
			explanation:
				"Llegó un cargo por un monto distinto al de la orden que menciona, así que Tavli lo reembolsó en lugar de quedarse con dinero que no podía justificar. La orden sigue sin pagarse.",
		},
		dispute_lost: {
			title: "Disputa perdida",
			explanation:
				"Una red de tarjetas resolvió una disputa en contra del restaurante. El dinero y la comisión de la disputa se perdieron; hay que avisarle al restaurante.",
		},
		dashboard_refund: {
			title: "Reembolso hecho fuera de Tavli",
			explanation:
				"Se hizo un reembolso desde el panel de Stripe y no a través de Tavli, así que la orden y el depósito que alimenta ya no coinciden con Stripe.",
		},
		payout_failed: {
			title: "Depósito fallido",
			explanation:
				"Stripe no pudo depositarle al restaurante. Hay que corregir sus datos bancarios o el estado de su cuenta para que el dinero pueda moverse.",
		},
		account_closed: {
			title: "Cuenta conectada cerrada",
			explanation:
				"La cuenta de Stripe del restaurante fue cerrada o rechazada, así que no puede recibir pagos. Los comensales fallarán al pagar hasta que se restablezca.",
		},
		restaurant_missing_contact_email: {
			title: "El restaurante no tiene correo de contacto",
			explanation:
				"Este restaurante no tiene correo de contacto, así que Tavli no puede avisarle a su operador de nada: recibos, disputas ni esta alerta.",
		},
	},
};

const CHROME: Record<InviteEmailLocale, OperatorAlertEmailChrome> = {
	en: {
		subject: "Tavli operator alert: {{title}}",
		preview: "A severe operator alert needs a look",
		heading: "Operator alert",
		severityLabel: "Severity",
		severities: {
			[OPERATOR_ALERT_SEVERITY.INFO]: "Info",
			[OPERATOR_ALERT_SEVERITY.WARNING]: "Warning",
			[OPERATOR_ALERT_SEVERITY.SEVERE]: "Severe",
		},
		restaurantLabel: "Restaurant",
		referenceLabel: "Stripe reference",
		cta: "Open operator alerts",
		footerWhy: "You get this because you hold an owner or admin role on Tavli.",
		footerSentBy: "Sent by Tavli",
	},
	es: {
		subject: "Alerta de operación Tavli: {{title}}",
		preview: "Una alerta grave de operación necesita revisión",
		heading: "Alerta de operación",
		severityLabel: "Gravedad",
		severities: {
			[OPERATOR_ALERT_SEVERITY.INFO]: "Informativa",
			[OPERATOR_ALERT_SEVERITY.WARNING]: "Advertencia",
			[OPERATOR_ALERT_SEVERITY.SEVERE]: "Grave",
		},
		restaurantLabel: "Restaurante",
		referenceLabel: "Referencia de Stripe",
		cta: "Abrir alertas de operación",
		footerWhy: "Recibes esto porque tienes un rol de propietario o administrador en Tavli.",
		footerSentBy: "Enviado por Tavli",
	},
};

export function getOperatorAlertChrome(locale: InviteEmailLocale): OperatorAlertEmailChrome {
	return CHROME[locale];
}

export function getOperatorAlertKindCopy(
	locale: InviteEmailLocale,
	kind: OperatorAlertKind
): OperatorAlertKindCopy {
	return KIND_COPY[locale][kind];
}

/**
 * Every i18n key this module can render, per locale. Built from the same
 * constants the frontend imports, so a kind added to `OPERATOR_ALERT_KIND`
 * without copy here is a `undefined` the test catches, not a silent blank.
 */
function copyByKey(locale: InviteEmailLocale): Record<string, string> {
	const entries: Record<string, string> = {};
	for (const kind of OPERATOR_ALERT_KINDS) {
		const copy = KIND_COPY[locale][kind];
		entries[OPERATOR_ALERT_TITLE_KEY[kind]] = copy.title;
		entries[OPERATOR_ALERT_EXPLANATION_KEY[kind]] = copy.explanation;
	}
	return entries;
}

const COPY_BY_KEY: Record<InviteEmailLocale, Record<string, string>> = {
	en: copyByKey("en"),
	es: copyByKey("es"),
};

/**
 * Render a stored `messageKey` in one locale.
 *
 * Falls back to the key itself for anything this table does not know. That is
 * deliberate: an email reading `alerts.kind.somethingNew.explanation` is ugly
 * but still tells the operator which alert fired, whereas an empty body tells
 * them nothing and a thrown error would lose the email entirely.
 */
export function translateOperatorAlertKey(
	locale: InviteEmailLocale,
	key: string,
	params?: Record<string, string | number>
): string {
	const template = COPY_BY_KEY[locale][key] ?? key;
	if (!params) return template;
	const stringParams: Record<string, string> = {};
	for (const [name, value] of Object.entries(params)) stringParams[name] = String(value);
	return interpolate(template, stringParams);
}
