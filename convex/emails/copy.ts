import type { InviteEmailLocale } from "./locale";

export type InviteEmailRole = "owner" | "manager" | "employee";

export type TeamInviteCopy = {
	subject: string;
	preview: string;
	greeting: string;
	bodyIntro: string;
	bodyRole: string;
	bodyRestaurants: string;
	bodyInviter: string;
	cta: string;
	expires: string;
	footerIgnore: string;
	footerSentBy: string;
	roleLabels: Record<InviteEmailRole, string>;
};

const COPY: Record<InviteEmailLocale, TeamInviteCopy> = {
	en: {
		subject: "You're invited to join {{organizationName}} on Tavli",
		preview: "Accept your invitation to join the team on Tavli",
		greeting: "Hi {{name}},",
		bodyIntro: "You've been invited to join {{organizationName}} on Tavli.",
		bodyRole: "Role: {{role}}",
		bodyRestaurants: "Restaurants: {{restaurants}}",
		bodyInviter: "Invited by {{inviter}}",
		cta: "Accept invitation",
		expires: "This invitation expires on {{date}}.",
		footerIgnore: "If you didn't expect this invitation, you can safely ignore this email.",
		footerSentBy: "Sent by Tavli",
		roleLabels: {
			owner: "Organization owner",
			manager: "Restaurant manager",
			employee: "Employee",
		},
	},
	es: {
		subject: "Te invitaron a unirte a {{organizationName}} en Tavli",
		preview: "Acepta tu invitación para unirte al equipo en Tavli",
		greeting: "Hola {{name}},",
		bodyIntro: "Te invitaron a unirte a {{organizationName}} en Tavli.",
		bodyRole: "Rol: {{role}}",
		bodyRestaurants: "Restaurantes: {{restaurants}}",
		bodyInviter: "Invitado por {{inviter}}",
		cta: "Aceptar invitación",
		expires: "Esta invitación vence el {{date}}.",
		footerIgnore: "Si no esperabas esta invitación, puedes ignorar este correo.",
		footerSentBy: "Enviado por Tavli",
		roleLabels: {
			owner: "Propietario de la organización",
			manager: "Gerente de restaurante",
			employee: "Empleado",
		},
	},
};

export function getTeamInviteCopy(locale: InviteEmailLocale): TeamInviteCopy {
	return COPY[locale];
}

export function interpolate(template: string, vars: Record<string, string>): string {
	return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
}
