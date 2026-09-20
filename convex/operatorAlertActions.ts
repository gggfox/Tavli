"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { parseResendErrorSummary, redactExternalId } from "./_shared/integrationLogging";
import { getAppUrl } from "./_util/env";
import { renderOperatorAlertEmail } from "./emails/renderOperatorAlertEmail";
import { TABLE } from "./constants";

/**
 * Deliver one severe operator alert to one platform admin (TAVLI-109).
 *
 * Scheduled per recipient by `_util/operatorAlerts.raiseOperatorAlert`, never
 * called directly, and never on the transaction that raised the alert: the row
 * on `/admin/alerts` is the record of the problem, and this email is only the
 * nudge that gets somebody to look at it. If Resend is down, the alert still
 * exists.
 *
 * Failures are logged and swallowed for the same reason the invite and receipt
 * emails swallow theirs — throwing here would retry the job (and, when the
 * raise came from a webhook handler, could make Stripe redeliver the event)
 * without making the email any more deliverable.
 *
 * No new environment variable: `RESEND_API_KEY` / `RESEND_FROM_ADDRESS` and
 * `PUBLIC_APP_URL` are the same ones the invite email already needs.
 */
export const sendOperatorAlertEmail = internalAction({
	args: {
		alertId: v.id(TABLE.OPERATOR_ALERTS),
		email: v.string(),
		locale: v.union(v.literal("en"), v.literal("es")),
	},
	handler: async (ctx, args): Promise<void> => {
		const context = await ctx.runQuery(internal.operatorAlerts.getOperatorAlertEmailContext, {
			alertId: args.alertId,
		});
		// The alert was deleted between scheduling and delivery (a restaurant
		// purge, most likely). Nothing left to tell anyone about.
		if (!context) return;

		const apiKey = process.env.RESEND_API_KEY;
		const from = process.env.RESEND_FROM_ADDRESS ?? process.env.RESEND_FROM;
		if (!apiKey || !from) {
			console.warn(
				"[operatorAlertActions] RESEND_API_KEY or RESEND_FROM_ADDRESS missing; skipping severe-alert email."
			);
			return;
		}

		const { subject, html, text } = await renderOperatorAlertEmail({
			locale: args.locale,
			kind: context.kind,
			severity: context.severity,
			messageKey: context.messageKey,
			messageParams: context.messageParams ?? undefined,
			restaurantName: context.restaurantName,
			stripeObjectId: context.stripeObjectId,
			// Throws APP_URL_NOT_CONFIGURED in staging/production when unset,
			// rather than mailing a localhost link to a real admin.
			alertsUrl: `${getAppUrl()}/admin/alerts`,
		});

		const res = await fetch("https://api.resend.com/emails", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ from, to: [args.email], subject, html, text }),
		});

		if (!res.ok) {
			const responseText = await res.text();
			console.error("[operatorAlertActions] Resend error:", {
				integration: "resend",
				operation: "sendOperatorAlertEmail",
				alertId: redactExternalId(args.alertId),
				...parseResendErrorSummary(res.status, responseText),
			});
		}
	},
});
