"use node";

import { v } from "convex/values";
import Stripe from "stripe";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import {
	buildIntegrationErrorLog,
	parseResendErrorSummary,
	redactExternalId,
} from "./_shared/integrationLogging";
import { getAppUrl } from "./_util/env";
import { getStripeClient } from "./_util/stripe";
import { NOTIFICATION_KIND, PAYMENTS_PAGE_PATH } from "./constants";
import { renderDisputeEmail } from "./emails/renderDisputeEmail";

/**
 * Deliver one dispute email to one restaurant manager (TAVLI-102).
 *
 * Scheduled per recipient by `disputes.recordDisputeEventInternal`, never
 * called directly, and never on the transaction that recorded the dispute: the
 * disputes card on `/admin/payments` and the bell notification are the record,
 * and this email is the nudge that reaches somebody who is not looking at the
 * app.
 *
 * Failures are logged and swallowed, like the payout and operator-alert emails:
 * throwing here would retry the job and — because the raise came from a webhook
 * handler — could make Stripe redeliver the event, without making the email any
 * more deliverable.
 *
 * Everything the email needs is passed in rather than re-read. The amount, the
 * order and the recovery percentage are facts about the moment the dispute
 * changed state; a re-read could find the percentage already edited by an
 * admin and mail a manager terms that do not match the ones they were told.
 */
export const sendDisputeEmail = internalAction({
	args: {
		email: v.string(),
		locale: v.union(v.literal("en"), v.literal("es")),
		kind: v.union(
			v.literal(NOTIFICATION_KIND.DISPUTE_OPENED),
			v.literal(NOTIFICATION_KIND.DISPUTE_WON),
			v.literal(NOTIFICATION_KIND.DISPUTE_LOST)
		),
		restaurantName: v.union(v.string(), v.null()),
		/** Already grouped and two-decimalled by `formatDisputeAmount`. */
		amountFormatted: v.string(),
		currency: v.string(),
		orderNumber: v.union(v.number(), v.null()),
		recoveryPercent: v.number(),
	},
	handler: async (_ctx, args): Promise<void> => {
		const apiKey = process.env.RESEND_API_KEY;
		const from = process.env.RESEND_FROM_ADDRESS ?? process.env.RESEND_FROM;
		if (!apiKey || !from) {
			console.warn(
				"[disputeActions] RESEND_API_KEY or RESEND_FROM_ADDRESS missing; skipping dispute email."
			);
			return;
		}

		const { subject, html, text } = await renderDisputeEmail({
			locale: args.locale,
			kind: args.kind,
			amountFormatted: args.amountFormatted,
			currency: args.currency,
			restaurantName: args.restaurantName,
			orderNumber: args.orderNumber,
			recoveryPercent: args.recoveryPercent,
			// Throws APP_URL_NOT_CONFIGURED in staging/production when unset,
			// rather than mailing a localhost link to a real manager.
			paymentsUrl: `${getAppUrl()}${PAYMENTS_PAGE_PATH}`,
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
			console.error("[disputeActions] Resend error:", {
				integration: "resend",
				operation: "sendDisputeEmail",
				kind: args.kind,
				...parseResendErrorSummary(res.status, responseText),
			});
		}
	},
});

/**
 * Give back what a reinstated dispute had already taken (TAVLI-102).
 *
 * Scheduled by `disputes.recordDisputeEventInternal` when a dispute we lost is
 * won, or its funds reinstated, and money had already been drawn off the
 * ledger by later orders. Stripe took the disputed amount from the PLATFORM
 * balance and has now given it back; the restaurant's share of the recovery
 * has to follow, and a transfer to the connected account is the only way to
 * move it — the original charges are long settled.
 *
 * **Idempotent twice.** `dispute-recovery-return:${disputeId}` as the Stripe
 * idempotency key means a second call returns Stripe's record of the first
 * transfer rather than creating a second one, and `markRecoveryReturnedInternal`
 * refuses to stamp a row that already carries a `returnedAt`. Both matter:
 * the key covers a retry of this action, the row covers a replayed webhook that
 * scheduled it twice with the money already home.
 *
 * A failure is logged and rethrown so the Convex scheduler retries it. Unlike
 * the emails, this one moves money the restaurant is owed — swallowing it would
 * leave a silent debt that only an audit could find.
 */
export const returnRecoveredFunds = internalAction({
	args: {
		recoveryId: v.id("disputeRecoveries"),
		stripeAccountId: v.string(),
		stripeDisputeId: v.string(),
		/** Smallest currency unit — what was drawn off the ledger. */
		amount: v.number(),
		currency: v.string(),
	},
	handler: async (ctx, args): Promise<void> => {
		if (args.amount <= 0) return;

		const stripeClient = getStripeClient();
		try {
			const transfer: Stripe.Transfer = await stripeClient.transfers.create(
				{
					amount: args.amount,
					currency: args.currency,
					destination: args.stripeAccountId,
					description: `Dispute recovery returned (${args.stripeDisputeId})`,
					metadata: {
						stripeDisputeId: args.stripeDisputeId,
						recoveryId: args.recoveryId,
						reason: "dispute_recovery_return",
					},
				},
				{ idempotencyKey: `dispute-recovery-return:${args.stripeDisputeId}` }
			);

			await ctx.runMutation(internal.disputes.markRecoveryReturnedInternal, {
				recoveryId: args.recoveryId,
				stripeTransferId: transfer.id,
				amount: args.amount,
			});
		} catch (error) {
			console.error("[disputeActions.returnRecoveredFunds] could not return recovered funds", {
				...buildIntegrationErrorLog(error, {
					integration: "stripe",
					operation: "transfers.create",
				}),
				stripeDisputeId: redactExternalId(args.stripeDisputeId),
			});
			throw error;
		}
	},
});
