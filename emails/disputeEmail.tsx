import DisputeEmailComponent, { type DisputeEmailProps } from "../convex/emails/disputeEmail";

export default function DisputeEmail(props: Readonly<DisputeEmailProps>) {
	return <DisputeEmailComponent {...props} />;
}

DisputeEmail.PreviewProps = {
	locale: "en",
	leadLine: "The diner's bank decided in their favour.",
	isFavourable: false,
	heading: "A disputed payment was reversed",
	amountLine: "Amount reversed: 640.00 MXN",
	restaurantLine: "Restaurant: La Cocina",
	orderLine: "Order: #42",
	whatHappenedLabel: "What happened",
	whatHappened:
		"The bank returned this payment to the diner. Banks decide these cases and the decision is final; it is not a judgement on your restaurant.",
	whatNextLabel: "What happens next",
	whatNext:
		"To cover the reversal, 20% of the food subtotal on your next orders is held back until the amount above is repaid — never more than that, never from tips, and the amount your diners pay does not change. Your sales figures are unchanged; the recovery is its own line in your payments.",
	ctaLabel: "See your payments",
	paymentsUrl: "http://localhost:3000/admin/payments",
	footerWhy: "You get this because you manage this restaurant on Tavli.",
	footerSentBy: "Sent by Tavli",
	previewText: "The bank sided with the diner on one of your orders.",
} satisfies DisputeEmailProps;
