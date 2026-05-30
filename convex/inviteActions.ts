"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { renderTeamInviteEmail } from "./emails/renderTeamInviteEmail";
import { TABLE } from "./constants";

/**
 * Sends invitation email via Resend. Requires RESEND_API_KEY and RESEND_FROM in Convex env.
 */
export const sendInviteEmail = internalAction({
	args: { invitationId: v.id(TABLE.INVITATIONS) },
	handler: async (ctx, args) => {
		const context = await ctx.runQuery(internal.invites.getInviteEmailContext, {
			invitationId: args.invitationId,
		});
		if (!context) return;

		const apiKey = process.env.RESEND_API_KEY;
		const from = process.env.RESEND_FROM_ADDRESS ?? process.env.RESEND_FROM;
		const appUrl =
			process.env.PUBLIC_APP_URL ?? process.env.VITE_APP_URL ?? "http://localhost:3000";

		if (!apiKey || !from) {
			console.warn(
				"[inviteActions] RESEND_API_KEY or RESEND_FROM_ADDRESS missing; skipping email send."
			);
			return;
		}

		const acceptUrl = `${appUrl.replace(/\/$/, "")}/invites/${context.token}`;
		const { subject, html, text } = await renderTeamInviteEmail({
			locale: context.locale,
			inviteeEmail: context.email,
			inviteeFirstName: context.inviteeFirstName,
			organizationName: context.organizationName,
			role: context.role,
			restaurantNames: context.restaurantNames,
			inviterDisplayName: context.inviterDisplayName,
			acceptUrl,
			expiresAt: context.expiresAt,
		});

		const res = await fetch("https://api.resend.com/emails", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				from,
				to: [context.email],
				subject,
				html,
				text,
			}),
		});

		if (!res.ok) {
			const responseText = await res.text();
			console.error("[inviteActions] Resend error:", res.status, responseText);
		}
	},
});
