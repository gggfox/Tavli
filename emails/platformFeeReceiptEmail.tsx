import PlatformFeeReceiptEmailComponent, {
	type PlatformFeeReceiptEmailProps,
} from "../convex/emails/platformFeeReceiptEmail";

export default function PlatformFeeReceiptEmail(props: Readonly<PlatformFeeReceiptEmailProps>) {
	return <PlatformFeeReceiptEmailComponent {...props} />;
}

PlatformFeeReceiptEmail.PreviewProps = {
	locale: "en",
	previewText: "Your Tavli subscription payment for La Cocina de Tavli",
	issuer: "Tavli",
	title: "Subscription receipt",
	intro: "Thanks — we received your monthly Tavli subscription payment for La Cocina de Tavli.",
	periodLabel: "Billing period",
	periodValue: "June 1, 2026 – July 1, 2026",
	amountLabel: "Amount paid",
	amountValue: "$2,000.00 MXN",
	planLabel: "Plan",
	planValue: "Tavli platform subscription (monthly)",
	invoiceLine: { label: "Invoice", value: "B1C2D3E4-0001" },
	invoiceUrl: "https://invoice.stripe.com/i/acct_123/test_invoice",
	ctaLabel: "View invoice",
	notServiceFee:
		"This is your restaurant's monthly subscription to Tavli. It is separate from the Tavli service fee your diners pay on their own orders.",
	footerQuestions: "Questions about this charge? Just reply to this email.",
	footerSentBy: "Sent by Tavli",
} satisfies PlatformFeeReceiptEmailProps;
