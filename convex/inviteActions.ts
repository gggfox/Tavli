import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { INVITATION_STATUS, TABLE } from "./constants";

/**
 * Sends invitation email via Resend. Requires RESEND_API_KEY and RESEND_FROM in Convex env.
 */
export const sendInviteEmail = internalAction({
	args: { invitationId: v.id(TABLE.INVITATIONS) },
	handler: async (ctx, args) => {
		const invitation = await ctx.runQuery(internal.invites.getByIdInternal, {
			invitationId: args.invitationId,
		});
		if (!invitation || invitation.status !== INVITATION_STATUS.PENDING) return;

		const apiKey = process.env.RESEND_API_KEY;
		const from = process.env.RESEND_FROM_ADDRESS ?? process.env.RESEND_FROM;
		const appUrl = process.env.PUBLIC_APP_URL ?? process.env.VITE_APP_URL ?? "http://localhost:3000";

		if (!apiKey || !from) {
			console.warn(
				"[inviteActions] RESEND_API_KEY or RESEND_FROM_ADDRESS missing; skipping email send."
			);
			return;
		}

		const acceptUrl = `${appUrl.replace(/\/$/, "")}/invites/${invitation.token}`;

		const res = await fetch("https://api.resend.com/emails", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				from,
				to: [invitation.email],
				subject: "You're invited to join a restaurant organization",
				html: `<p>You've been invited to Tavli (${invitation.role}).</p><p><a href="${acceptUrl}">Accept invitation</a></p>`,
			}),
		});

		if (!res.ok) {
			const text = await res.text();
			console.error("[inviteActions] Resend error:", res.status, text);
		}
	},
});
