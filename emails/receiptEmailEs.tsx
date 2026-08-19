import ReceiptEmailComponent, { type ReceiptEmailProps } from "../convex/emails/receiptEmail";

export default function ReceiptEmailEs(props: Readonly<ReceiptEmailProps>) {
	return <ReceiptEmailComponent {...props} />;
}

ReceiptEmailEs.PreviewProps = {
	locale: "es",
	previewText: "Tu recibo de La Cocina de Tavli",
	restaurantName: "La Cocina de Tavli",
	title: "Recibo",
	orderLine: "Pedido #42 · 6 de junio de 2026, 3:00 p.m.",
	taxBlock: {
		heading: "Información fiscal",
		lines: [
			"La Cocina de Tavli S.A. de C.V.",
			"RFC: COC010101ABC",
			"Av. Siempre Viva 123, Col. Centro, Monterrey, N.L.",
		],
	},
	itemsHeading: "Artículos",
	items: [
		{ label: "2x Pozole", amount: "$100.00", refunded: false },
		{ label: "1x Agua de horchata", amount: "$25.00", refunded: true },
	],
	refundedNote: "Reembolsado",
	subtotalLabel: "Subtotal",
	subtotalValue: "$125.00",
	feeLine: {
		label: "Tarifa de servicio Tavli (12%)",
		attribution: "Cobrada por Tavli",
		value: "$15.00",
	},
	totalLabel: "Total",
	totalValue: "$140.00",
	tipLine: { label: "Propina (esta visita)", value: "$20.00" },
	paymentHint: "Pagado con tarjeta",
	footerNotCfdi:
		"Este documento no es un CFDI. Para solicitar tu factura, contacta al restaurante con los datos de abajo.",
	contactBlock: {
		heading: "Contacta a La Cocina de Tavli",
		rows: [
			{ label: "Correo", value: "hola@lacocina.mx", href: "mailto:hola@lacocina.mx" },
			{ label: "Teléfono", value: "+528112345678", href: "tel:+528112345678" },
			{ label: "WhatsApp", value: "+528112345678", href: "https://wa.me/528112345678" },
		],
	},
	footerSentBy: "Enviado por Tavli",
} satisfies ReceiptEmailProps;
