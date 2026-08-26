import ReceiptEmailComponent, { type ReceiptEmailProps } from "../convex/emails/receiptEmail";

export default function ReceiptEmail(props: Readonly<ReceiptEmailProps>) {
	return <ReceiptEmailComponent {...props} />;
}

ReceiptEmail.PreviewProps = {
	locale: "en",
	previewText: "Your receipt from La Cocina de Tavli",
	restaurantName: "La Cocina de Tavli",
	brandColor: "#0f7b6c",
	title: "Receipt",
	orderLine: "Order #42 · June 6, 2026 at 3:00 PM",
	taxBlock: {
		heading: "Tax information",
		lines: [
			"La Cocina de Tavli S.A. de C.V.",
			"RFC: COC010101ABC",
			"Av. Siempre Viva 123, Col. Centro, Monterrey, N.L.",
		],
	},
	itemsHeading: "Items",
	items: [
		{ label: "2x Pozole", amount: "$100.00", refunded: false },
		{ label: "1x Agua de horchata", amount: "$25.00", refunded: true },
	],
	refundedNote: "Refunded",
	subtotalLabel: "Subtotal",
	subtotalValue: "$125.00",
	feeLine: {
		label: "Tavli service fee (12%)",
		attribution: "Charged by Tavli",
		value: "$15.00",
	},
	totalLabel: "Total",
	totalValue: "$140.00",
	tipLine: { label: "Tip (this visit)", value: "$20.00" },
	paymentHint: "Paid by card",
	footerNotCfdi:
		"This is not a CFDI (tax invoice). For a factura, contact the restaurant using the details below.",
	contactBlock: {
		heading: "Contact La Cocina de Tavli",
		rows: [
			{ label: "Email", value: "hola@lacocina.mx", href: "mailto:hola@lacocina.mx" },
			{ label: "Phone", value: "+528112345678", href: "tel:+528112345678" },
			{ label: "WhatsApp", value: "+528112345678", href: "https://wa.me/528112345678" },
		],
	},
	footerSentBy: "Sent by Tavli",
} satisfies ReceiptEmailProps;
