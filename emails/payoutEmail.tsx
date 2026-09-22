import PayoutEmailComponent, { type PayoutEmailProps } from "../convex/emails/payoutEmail";

export default function PayoutEmail(props: Readonly<PayoutEmailProps>) {
	return <PayoutEmailComponent {...props} />;
}

PayoutEmail.PreviewProps = {
	locale: "en",
	safeLine: "This money is yours and it is safe.",
	heading: "A payout did not reach your bank",
	amountLine: "Amount held: 12,450.00 MXN",
	restaurantLine: "Restaurant: La Cocina",
	reasonLabel: "Why it did not go through",
	reason: "The account number (CLABE) is not valid.",
	fixLabel: "How to fix it",
	fix: "Re-enter the account number in your Stripe details, digit for digit as it appears on your bank statement.",
	ctaLabel: "Review your payouts",
	payoutsUrl: "http://localhost:3000/admin/payouts",
	footerWhy: "You get this because you manage this restaurant on Tavli.",
	footerSentBy: "Sent by Tavli",
	previewText: "Your money is safe in Tavli. Your bank did not accept the transfer.",
} satisfies PayoutEmailProps;
