import type { InviteEmailLocale } from "./locale";

/**
 * Locale copy for the restaurant-branded order receipt email (ADR 008 /
 * TAVLI-71 Phase 3C). The receipt is informational — explicitly NOT a CFDI —
 * and itemizes the customer-borne Tavli service fee as Tavli's own line.
 */
export type ReceiptEmailCopy = {
	subject: string;
	preview: string;
	title: string;
	orderLine: string;
	orderLineNoNumber: string;
	itemsHeading: string;
	refundedNote: string;
	subtotalLabel: string;
	/** Fee line label — {{rate}} interpolates the display percentage (e.g. 12). */
	feeLabel: string;
	/** Short attribution under the fee line: the fee is Tavli's, not the restaurant's. */
	feeAttribution: string;
	totalLabel: string;
	tipLabel: string;
	paymentHintCard: string;
	paymentHintInPerson: string;
	taxBlockHeading: string;
	rfcLabel: string;
	/** Mandatory footer: this receipt is not a CFDI (Mexican tax invoice). */
	footerNotCfdi: string;
	footerSentBy: string;
};

const COPY: Record<InviteEmailLocale, ReceiptEmailCopy> = {
	en: {
		subject: "Your receipt from {{restaurantName}}",
		preview: "Your receipt from {{restaurantName}}",
		title: "Receipt",
		orderLine: "Order #{{n}} · {{date}}",
		orderLineNoNumber: "{{date}}",
		itemsHeading: "Items",
		refundedNote: "Refunded",
		subtotalLabel: "Subtotal",
		feeLabel: "Tavli service fee ({{rate}}%)",
		feeAttribution: "Charged by Tavli",
		totalLabel: "Total",
		tipLabel: "Tip (this visit)",
		paymentHintCard: "Paid by card",
		paymentHintInPerson: "Paid in person",
		taxBlockHeading: "Tax information",
		rfcLabel: "RFC: {{rfc}}",
		footerNotCfdi: "This is not a CFDI (tax invoice). For a factura, contact the restaurant.",
		footerSentBy: "Sent by Tavli",
	},
	es: {
		subject: "Tu recibo de {{restaurantName}}",
		preview: "Tu recibo de {{restaurantName}}",
		title: "Recibo",
		orderLine: "Pedido #{{n}} · {{date}}",
		orderLineNoNumber: "{{date}}",
		itemsHeading: "Artículos",
		refundedNote: "Reembolsado",
		subtotalLabel: "Subtotal",
		feeLabel: "Tarifa de servicio Tavli ({{rate}}%)",
		feeAttribution: "Cobrada por Tavli",
		totalLabel: "Total",
		tipLabel: "Propina (esta visita)",
		paymentHintCard: "Pagado con tarjeta",
		paymentHintInPerson: "Pagado en persona",
		taxBlockHeading: "Información fiscal",
		rfcLabel: "RFC: {{rfc}}",
		footerNotCfdi: "Este documento no es un CFDI. Para facturar, contacta al restaurante.",
		footerSentBy: "Enviado por Tavli",
	},
};

export function getReceiptCopy(locale: InviteEmailLocale): ReceiptEmailCopy {
	return COPY[locale];
}
