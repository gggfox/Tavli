import TeamInviteEmailComponent, {
	type TeamInviteEmailProps,
} from "../convex/emails/teamInviteEmail";

export default function TeamInviteEmailEs(props: Readonly<TeamInviteEmailProps>) {
	return <TeamInviteEmailComponent {...props} />;
}

TeamInviteEmailEs.PreviewProps = {
	locale: "es",
	greeting: "Hola Alex,",
	bodyIntro: "Te invitaron a unirte a Acme Restaurants en Tavli.",
	bodyRole: "Rol: Gerente de restaurante",
	bodyRestaurants: "Restaurantes: Centro, Midtown",
	bodyInviter: "Invitado por jane@example.com",
	ctaLabel: "Aceptar invitación",
	acceptUrl: "http://localhost:3000/invites/sample-token",
	expiresLine: "Esta invitación vence el 6 de junio de 2026, 3:00 p.m.",
	footerIgnore: "Si no esperabas esta invitación, puedes ignorar este correo.",
	footerSentBy: "Enviado por Tavli",
	previewText: "Acepta tu invitación para unirte al equipo en Tavli",
} satisfies TeamInviteEmailProps;
