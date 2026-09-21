import DisputeEmailComponent, { type DisputeEmailProps } from "../convex/emails/disputeEmail";

export default function DisputeEmailEs(props: Readonly<DisputeEmailProps>) {
	return <DisputeEmailComponent {...props} />;
}

DisputeEmailEs.PreviewProps = {
	locale: "es",
	leadLine: "El banco del comensal resolvió a su favor.",
	isFavourable: false,
	heading: "Un pago en disputa fue revertido",
	amountLine: "Monto revertido: 640.00 MXN",
	restaurantLine: "Restaurante: La Cocina",
	orderLine: "Pedido: #42",
	whatHappenedLabel: "Qué pasó",
	whatHappened:
		"El banco devolvió este pago al comensal. Estos casos los decide el banco y la decisión es definitiva; no es un juicio sobre tu restaurante.",
	whatNextLabel: "Qué sigue",
	whatNext:
		"Para cubrir la reversión, se retiene el 20% del subtotal de alimentos de tus siguientes pedidos hasta cubrir el monto de arriba — nunca más que eso, nunca de las propinas, y lo que pagan tus comensales no cambia. Tus cifras de ventas no cambian; la recuperación aparece como su propia línea en tus pagos.",
	ctaLabel: "Ver tus pagos",
	paymentsUrl: "http://localhost:3000/admin/payments",
	footerWhy: "Recibes esto porque administras este restaurante en Tavli.",
	footerSentBy: "Enviado por Tavli",
	previewText: "El banco le dio la razón al comensal en uno de tus pedidos.",
} satisfies DisputeEmailProps;
