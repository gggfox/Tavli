import PlatformFeeReceiptEmailComponent, {
	type PlatformFeeReceiptEmailProps,
} from "../convex/emails/platformFeeReceiptEmail";

export default function PlatformFeeReceiptEmailEs(props: Readonly<PlatformFeeReceiptEmailProps>) {
	return <PlatformFeeReceiptEmailComponent {...props} />;
}

PlatformFeeReceiptEmailEs.PreviewProps = {
	locale: "es",
	previewText: "Tu pago de suscripción Tavli para La Cocina de Tavli",
	issuer: "Tavli",
	title: "Recibo de suscripción",
	intro: "Gracias — recibimos el pago de tu suscripción mensual a Tavli para La Cocina de Tavli.",
	periodLabel: "Periodo facturado",
	periodValue: "1 de junio de 2026 – 1 de julio de 2026",
	amountLabel: "Monto pagado",
	amountValue: "$2,000.00 MXN",
	planLabel: "Plan",
	planValue: "Suscripción a la plataforma Tavli (mensual)",
	invoiceLine: { label: "Comprobante", value: "B1C2D3E4-0001" },
	invoiceUrl: "https://invoice.stripe.com/i/acct_123/test_invoice",
	ctaLabel: "Ver comprobante",
	notServiceFee:
		"Esta es la suscripción mensual de tu restaurante a Tavli. Es distinta de la tarifa de servicio Tavli que pagan tus comensales en sus pedidos.",
	footerQuestions: "¿Dudas sobre este cargo? Responde a este correo.",
	footerSentBy: "Enviado por Tavli",
} satisfies PlatformFeeReceiptEmailProps;
