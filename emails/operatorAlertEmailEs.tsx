import OperatorAlertEmailComponent, {
	type OperatorAlertEmailProps,
} from "../convex/emails/operatorAlertEmail";

export default function OperatorAlertEmailEs(props: Readonly<OperatorAlertEmailProps>) {
	return <OperatorAlertEmailComponent {...props} />;
}

OperatorAlertEmailEs.PreviewProps = {
	locale: "es",
	heading: "Alerta de operación",
	alertTitle: "Cargo sin orden asociada",
	explanation:
		"Stripe cobró dinero que Tavli no puede ligar a ningún registro de pago. Nadie ha recibido ese crédito: busca el cargo en Stripe y define de quién es.",
	severityLine: "Gravedad: Grave",
	restaurantLine: "Restaurante: La Cocina",
	referenceLine: "Referencia de Stripe: ch_3QsampleCharge",
	ctaLabel: "Abrir alertas de operación",
	alertsUrl: "http://localhost:3000/admin/alerts",
	footerWhy: "Recibes esto porque tienes un rol de propietario o administrador en Tavli.",
	footerSentBy: "Enviado por Tavli",
	previewText: "Una alerta grave de operación necesita revisión",
} satisfies OperatorAlertEmailProps;
