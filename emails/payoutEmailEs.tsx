import PayoutEmailComponent, { type PayoutEmailProps } from "../convex/emails/payoutEmail";

export default function PayoutEmailEs(props: Readonly<PayoutEmailProps>) {
	return <PayoutEmailComponent {...props} />;
}

PayoutEmailEs.PreviewProps = {
	locale: "es",
	safeLine: "Este dinero es tuyo y está seguro.",
	heading: "Un depósito no llegó a tu banco",
	amountLine: "Monto retenido: 12,450.00 MXN",
	restaurantLine: "Restaurante: La Cocina",
	reasonLabel: "Por qué no se completó",
	reason: "El número de cuenta (CLABE) no es válido.",
	fixLabel: "Cómo resolverlo",
	fix: "Vuelve a capturar el número de cuenta en tus datos de Stripe, dígito por dígito como aparece en tu estado de cuenta.",
	ctaLabel: "Revisar tus depósitos",
	payoutsUrl: "http://localhost:3000/admin/payouts",
	footerWhy: "Recibes esto porque administras este restaurante en Tavli.",
	footerSentBy: "Enviado por Tavli",
	previewText: "Tu dinero está seguro en Tavli. Tu banco no aceptó la transferencia.",
} satisfies PayoutEmailProps;
