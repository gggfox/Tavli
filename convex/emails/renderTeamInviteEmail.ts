import { render } from "@react-email/render";
import { createElement } from "react";
import { getTeamInviteCopy, interpolate, type InviteEmailRole } from "./copy";
import { formatExpiresAt, type InviteEmailLocale } from "./locale";
import TeamInviteEmail from "./teamInviteEmail";

export type TeamInviteEmailContext = {
	locale: InviteEmailLocale;
	inviteeEmail: string;
	inviteeFirstName?: string;
	organizationName: string;
	role: InviteEmailRole;
	restaurantNames: string[];
	inviterDisplayName: string | null;
	acceptUrl: string;
	expiresAt: number;
};

export async function renderTeamInviteEmail(context: TeamInviteEmailContext): Promise<{
	subject: string;
	html: string;
	text: string;
}> {
	const copy = getTeamInviteCopy(context.locale);
	const roleLabel = copy.roleLabels[context.role];
	const greetingName = context.inviteeFirstName?.trim() || context.inviteeEmail;
	const expiresAtFormatted = formatExpiresAt(context.expiresAt, context.locale);

	const vars = {
		name: greetingName,
		organizationName: context.organizationName,
		role: roleLabel,
		restaurants: context.restaurantNames.join(", "),
		inviter: context.inviterDisplayName ?? "",
		date: expiresAtFormatted,
	};

	const emailProps = {
		locale: context.locale,
		greeting: interpolate(copy.greeting, vars),
		bodyIntro: interpolate(copy.bodyIntro, vars),
		bodyRole: interpolate(copy.bodyRole, vars),
		bodyRestaurants:
			context.restaurantNames.length > 0 ? interpolate(copy.bodyRestaurants, vars) : null,
		bodyInviter: context.inviterDisplayName ? interpolate(copy.bodyInviter, vars) : null,
		ctaLabel: copy.cta,
		acceptUrl: context.acceptUrl,
		expiresLine: interpolate(copy.expires, vars),
		footerIgnore: copy.footerIgnore,
		footerSentBy: copy.footerSentBy,
		previewText: copy.preview,
	};

	const element = createElement(TeamInviteEmail, emailProps);
	const html = await render(element);
	const text = await render(element, { plainText: true });
	const subject = interpolate(copy.subject, vars);

	return { subject, html, text };
}
