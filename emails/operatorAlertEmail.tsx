import OperatorAlertEmailComponent, {
	type OperatorAlertEmailProps,
} from "../convex/emails/operatorAlertEmail";

export default function OperatorAlertEmail(props: Readonly<OperatorAlertEmailProps>) {
	return <OperatorAlertEmailComponent {...props} />;
}

OperatorAlertEmail.PreviewProps = {
	locale: "en",
	heading: "Operator alert",
	alertTitle: "Charge matches no order",
	explanation:
		"Stripe took money that Tavli cannot tie to any payment record. Nobody has been credited for it — find the charge in Stripe and decide whose it is.",
	severityLine: "Severity: Severe",
	restaurantLine: "Restaurant: La Cocina",
	referenceLine: "Stripe reference: ch_3QsampleCharge",
	ctaLabel: "Open operator alerts",
	alertsUrl: "http://localhost:3000/admin/alerts",
	footerWhy: "You get this because you are a Tavli platform admin.",
	footerSentBy: "Sent by Tavli",
	previewText: "A severe operator alert needs a look",
} satisfies OperatorAlertEmailProps;
