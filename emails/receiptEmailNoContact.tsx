import ReceiptEmailComponent, { type ReceiptEmailProps } from "../convex/emails/receiptEmail";

/**
 * The receipt for a restaurant that has published no Public profile.
 *
 * Worth its own preview: this is the branch where the not-a-CFDI footer must
 * fall back to wording that doesn't promise contact details it can't show.
 */
export default function ReceiptEmailNoContact(props: Readonly<ReceiptEmailProps>) {
	return <ReceiptEmailComponent {...props} />;
}

ReceiptEmailNoContact.PreviewProps = {
	locale: "en",
	previewText: "Your receipt from La Cocina de Tavli",
	restaurantName: "La Cocina de Tavli",
	brandColor: "#0f7b6c",
	title: "Receipt",
	orderLine: "Order #42 · June 6, 2026 at 3:00 PM",
	taxBlock: null,
	itemsHeading: "Items",
	items: [{ label: "2x Pozole", amount: "$100.00", refunded: false }],
	refundedNote: "Refunded",
	subtotalLabel: "Subtotal",
	subtotalValue: "$100.00",
	feeLine: {
		label: "Tavli service fee (12%)",
		attribution: "Charged by Tavli",
		value: "$12.00",
	},
	totalLabel: "Total",
	totalValue: "$112.00",
	tipLine: null,
	paymentHint: "Paid by card",
	footerNotCfdi: "This is not a CFDI (tax invoice). For a factura, contact the restaurant.",
	contactBlock: null,
	footerSentBy: "Sent by Tavli",
} satisfies ReceiptEmailProps;
