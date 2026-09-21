"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { parseResendErrorSummary } from "./_shared/integrationLogging";
import { getAppUrl } from "./_util/env";
import {
	NOTIFICATION_KIND,
	PAYOUT_FAILURE_CODES,
	PAYOUTS_PAGE_PATH,
	type PayoutFailureCode,
} from "./constants";
import { renderPayoutEmail } from "./emails/renderPayoutEmail";

/**
 * Deliver one payout email to one restaurant manager (TAVLI-103).
 *
 * Scheduled per recipient by `payouts.recordPayoutEventInternal`, never called
 * directly, and never on the transaction that recorded the payout: the row on
 * `/admin/payouts` and the bell notification are the record, and this email is
 * the nudge that reaches somebody who is not looking at the app. If Resend is
 * down, the restaurant still learns about the money.
 *
 * Failures are logged and swallowed, like the operator-alert and invite emails:
 * throwing here would retry the job and — because the raise came from a webhook
 * handler — could make Stripe redeliver the event, without making the email any
 * more deliverable.
 *
 * Everything the email needs is passed in rather than re-read. That is
 * deliberate: the failure code, the amount and the restaurant's name are facts
 * about the moment the payout failed, and a re-read could find the payout row
 * already purged or, worse, already updated by a later event — which would mail
 * a manager a reason that no longer matches the alert they were told about.
 *
 * No new environment variable: `RESEND_API_KEY` / `RESEND_FROM_ADDRESS` and
 * `PUBLIC_APP_URL` are the same ones the invite email already needs.
 */
export const sendPayoutEmail = internalAction({
	args: {
		email: v.string(),
		locale: v.union(v.literal("en"), v.literal("es")),
		kind: v.union(
			v.literal(NOTIFICATION_KIND.PAYOUT_FAILED),
			v.literal(NOTIFICATION_KIND.PAYOUTS_RESUMED)
		),
		restaurantName: v.union(v.string(), v.null()),
		/** Already grouped and two-decimalled by `formatPayoutAmount`. */
		amountFormatted: v.string(),
		currency: v.string(),
		/**
		 * The **normalized** failure code. Validated against the closed set here
		 * too, so nothing but one of ours can reach the copy table even if a
		 * future caller forgets to normalize.
		 */
		failureCode: v.optional(v.union(...PAYOUT_FAILURE_CODES.map((code) => v.literal(code)))),
	},
	handler: async (_ctx, args): Promise<void> => {
		const apiKey = process.env.RESEND_API_KEY;
		const from = process.env.RESEND_FROM_ADDRESS ?? process.env.RESEND_FROM;
		if (!apiKey || !from) {
			console.warn(
				"[payoutActions] RESEND_API_KEY or RESEND_FROM_ADDRESS missing; skipping payout email."
			);
			return;
		}

		const { subject, html, text } = await renderPayoutEmail({
			locale: args.locale,
			kind: args.kind,
			amountFormatted: args.amountFormatted,
			currency: args.currency,
			restaurantName: args.restaurantName,
			failureCode: args.failureCode as PayoutFailureCode | undefined,
			// Throws APP_URL_NOT_CONFIGURED in staging/production when unset,
			// rather than mailing a localhost link to a real manager.
			payoutsUrl: `${getAppUrl()}${PAYOUTS_PAGE_PATH}`,
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
			console.error("[payoutActions] Resend error:", {
				integration: "resend",
				operation: "sendPayoutEmail",
				kind: args.kind,
				...parseResendErrorSummary(res.status, responseText),
			});
		}
	},
});
