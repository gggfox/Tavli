import type { InviteEmailLocale } from "./locale";

/**
 * Locale copy for TAVLI'S OWN receipt to a restaurant for the monthly platform
 * subscription (ADR 008 / TAVLI-71 Phase 4B).
 *
 * Note the difference from `receiptCopy.ts`: that one is branded as the
 * RESTAURANT and goes to a diner. This one is issued BY Tavli and goes TO the
 * restaurant, and the copy must never let the two fees blur — the 12% diners
 * pay per order is not this.
 */
export type PlatformFeeReceiptCopy = {
	/** {{restaurantName}} */
	subject: string;
	preview: string;
	issuer: string;
	title: string;
	intro: string;
	/** {{start}} – {{end}} */
	periodLabel: string;
	amountLabel: string;
	invoiceNumberLabel: string;
	planLabel: string;
	planValue: string;
	cta: string;
	/** The line that keeps the two fees apart. */
	notServiceFee: string;
	footerQuestions: string;
	footerSentBy: string;
};

const COPY: Record<InviteEmailLocale, PlatformFeeReceiptCopy> = {
	en: {
		subject: "Tavli receipt — monthly subscription for {{restaurantName}}",
		preview: "Your Tavli subscription payment for {{restaurantName}}",
		issuer: "Tavli",
		title: "Subscription receipt",
		intro: "Thanks — we received your monthly Tavli subscription payment for {{restaurantName}}.",
		periodLabel: "Billing period",
		amountLabel: "Amount paid",
		invoiceNumberLabel: "Invoice",
		planLabel: "Plan",
		planValue: "Tavli platform subscription (monthly)",
		cta: "View invoice",
		notServiceFee:
			"This is your restaurant's monthly subscription to Tavli. It is separate from the Tavli service fee your diners pay on their own orders.",
		footerQuestions: "Questions about this charge? Just reply to this email.",
		footerSentBy: "Sent by Tavli",
	},
	es: {
		subject: "Recibo Tavli — suscripción mensual de {{restaurantName}}",
		preview: "Tu pago de suscripción Tavli para {{restaurantName}}",
		issuer: "Tavli",
		title: "Recibo de suscripción",
		intro: "Gracias — recibimos el pago de tu suscripción mensual a Tavli para {{restaurantName}}.",
		periodLabel: "Periodo facturado",
		amountLabel: "Monto pagado",
		// "Comprobante", never "Factura": in Mexico a factura is a CFDI, and Tavli
		// does not issue one (the settings Tax section says so out loud). This is a
		// Stripe payment receipt.
		invoiceNumberLabel: "Comprobante",
		planLabel: "Plan",
		planValue: "Suscripción a la plataforma Tavli (mensual)",
		cta: "Ver comprobante",
		notServiceFee:
			"Esta es la suscripción mensual de tu restaurante a Tavli. Es distinta de la tarifa de servicio Tavli que pagan tus comensales en sus pedidos.",
		footerQuestions: "¿Dudas sobre este cargo? Responde a este correo.",
		footerSentBy: "Enviado por Tavli",
	},
};

export function getPlatformFeeReceiptCopy(locale: InviteEmailLocale): PlatformFeeReceiptCopy {
	return COPY[locale];
}
