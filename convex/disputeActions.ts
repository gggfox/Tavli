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
import {
	NOTIFICATION_KIND,
	OPERATOR_ALERT_KIND,
	OPERATOR_ALERT_SEVERITY,
	PAYMENTS_PAGE_PATH,
} from "./constants";
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
 * **Convex does not retry a scheduled function that throws.** So a failure here
 * is not self-correcting and cannot be treated like the emails: it leaves a
 * reinstated row that still owes the restaurant money, with its managers
 * already told the money is on its way back. Two things close that gap — a
 * **severe** operator alert raised from the catch (deduped per dispute), and
 * the daily `dispute recovery write-off sweep`, which re-schedules every
 * reinstated row whose `returnedAt` is still unset. The throw is kept so the
 * run also shows as failed in the Convex dashboard, not because it retries.
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
		// Re-read the row rather than trust the amount frozen at scheduling
		// (review round 3). Between the schedule and this run, a refund on one
		// of the payments that drew this row down can trim `recovered` — and it
		// trims precisely because no transfer had gone out yet. Transferring the
		// stale figure would send more than is owed, with nothing to alert on
		// and nothing to reverse it.
		const row: {
			recovered: number;
			currency: string;
			stripeDisputeId: string;
			returnedAt: number | undefined;
		} | null = await ctx.runQuery(internal.disputes.getRecoveryForReturnInternal, {
			recoveryId: args.recoveryId,
		});
		if (!row || row.returnedAt !== undefined) return;

		const amount = row.recovered;
		if (amount <= 0) {
			// Trimmed to nothing: the refund gave the diner back everything this
			// row had been paid down by, so there is no longer anything to return.
			console.log(
				"[disputeActions.returnRecoveredFunds] nothing left to return after a refund",
				JSON.stringify({ stripeDisputeId: redactExternalId(args.stripeDisputeId) })
			);
			return;
		}

		const stripeClient = getStripeClient();
		try {
			const transfer: Stripe.Transfer = await stripeClient.transfers.create(
				{
					amount,
					currency: row.currency,
					destination: args.stripeAccountId,
					description: `Dispute recovery returned (${args.stripeDisputeId})`,
					metadata: {
						stripeDisputeId: args.stripeDisputeId,
						recoveryId: args.recoveryId,
						reason: "dispute_recovery_return",
					},
				},
				// Unchanged by the re-read: the key identifies the return of THIS
				// dispute, so it still happens exactly once however many runs
				// reach here.
				{ idempotencyKey: `dispute-recovery-return:${args.stripeDisputeId}` }
			);

			await ctx.runMutation(internal.disputes.markRecoveryReturnedInternal, {
				recoveryId: args.recoveryId,
				stripeTransferId: transfer.id,
				amount: transfer.amount ?? amount,
			});
		} catch (error) {
			// Two calls sharing one idempotency key is a RACE, not a failure: the
			// winner is transferring the money right now and will stamp the row.
			// Alerting here would page an operator about a transfer that is in
			// fact happening, which is how a severe alert stops meaning anything.
			if (isIdempotencyKeyInUse(error)) {
				console.log(
					"[disputeActions.returnRecoveredFunds] another run holds the idempotency key; " +
						"leaving the return to it",
					JSON.stringify({ stripeDisputeId: redactExternalId(args.stripeDisputeId) })
				);
				return;
			}

			console.error("[disputeActions.returnRecoveredFunds] could not return recovered funds", {
				...buildIntegrationErrorLog(error, {
					integration: "stripe",
					operation: "transfers.create",
				}),
				stripeDisputeId: redactExternalId(args.stripeDisputeId),
			});
			// The only thing that makes this failure visible: nothing retries it
			// on its own, and the restaurant has already been told the money is
			// coming back. The daily sweep re-schedules it; this is how a human
			// finds out in the meantime.
			await ctx.runMutation(internal.operatorAlerts.raiseOperatorAlertInternal, {
				kind: OPERATOR_ALERT_KIND.DISPUTE_LOST,
				severity: OPERATOR_ALERT_SEVERITY.SEVERE,
				stripeObjectId: args.stripeDisputeId,
				dedupeKey: `dispute_recovery_return_failed:${args.stripeDisputeId}`,
			});
			throw error;
		}
	},
});

/**
 * Whether a Stripe error means "somebody else is doing this **right now**".
 *
 * Exactly one code qualifies: `idempotency_key_in_use` (HTTP 409), which Stripe
 * answers when a second request arrives while the first with the same key is
 * still in flight. That is a race between the event-driven schedule and the
 * daily sweep, the winner is moving the money, and the loser should stand down.
 *
 * Stripe's broader `type: "idempotency_error"` is deliberately **not** treated
 * as a race. It means the same key was reused with *different parameters* —
 * which is what a trimmed return looks like when the original amount already
 * reached Stripe. Swallowing it would make the daily sweep retry that same
 * mismatch every day, forever, in silence. It is a real failure and it alerts.
 */
function isIdempotencyKeyInUse(error: unknown): boolean {
	return (error as { code?: string } | null)?.code === "idempotency_key_in_use";
}

/**
 * Return what a settled payment withheld but could not apply (TAVLI-102,
 * review round 1).
 *
 * The deduction is priced when the PaymentIntent is created and the ledger is
 * drawn down when the charge settles, and the ledger can move in between: the
 * dispute is reinstated, or a second intent priced against the same remaining
 * balance settles first. Stripe has already shortened this transfer by the
 * full priced amount, so the difference is on the PLATFORM balance and belongs
 * to the restaurant — a silent platform gain if nothing sends it on.
 *
 * Same failure story as `returnRecoveredFunds`: the Stripe idempotency key
 * (`dispute-recovery-shortfall:<paymentId>`) makes a re-run safe, and a failure
 * raises a severe alert because nothing retries it.
 */
export const returnRecoveryShortfall = internalAction({
	args: {
		paymentId: v.id("payments"),
		stripeAccountId: v.string(),
		/** Smallest currency unit — withheld at Stripe but applied to no row. */
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
					description: `Dispute recovery shortfall returned (${args.paymentId})`,
					metadata: {
						paymentId: args.paymentId,
						reason: "dispute_recovery_shortfall",
					},
				},
				{ idempotencyKey: `dispute-recovery-shortfall:${args.paymentId}` }
			);

			await ctx.runMutation(internal.disputes.markRecoveryShortfallReturnedInternal, {
				paymentId: args.paymentId,
				stripeTransferId: transfer.id,
				amount: args.amount,
			});
		} catch (error) {
			if (isIdempotencyKeyInUse(error)) {
				console.log(
					"[disputeActions.returnRecoveryShortfall] another run holds the idempotency key",
					JSON.stringify({ paymentId: redactExternalId(args.paymentId) })
				);
				return;
			}

			console.error("[disputeActions.returnRecoveryShortfall] could not return the shortfall", {
				...buildIntegrationErrorLog(error, {
					integration: "stripe",
					operation: "transfers.create",
				}),
				paymentId: redactExternalId(args.paymentId),
			});
			await ctx.runMutation(internal.operatorAlerts.raiseOperatorAlertInternal, {
				kind: OPERATOR_ALERT_KIND.DISPUTE_LOST,
				severity: OPERATOR_ALERT_SEVERITY.SEVERE,
				paymentId: args.paymentId,
				dedupeKey: `dispute_recovery_shortfall_failed:${args.paymentId}`,
			});
			throw error;
		}
	},
});

/**
 * Take back part of a transfer Tavli made outside the charge (TAVLI-102,
 * review round 2).
 *
 * Scheduled by `disputes.restoreLedgerForRefund` when a refunded payment's
 * recovery had already been paid to the restaurant on a standalone transfer —
 * the return of a reinstated dispute, or a settled payment's shortfall. A
 * refund reverses the CHARGE's transfer and nothing else, so without this the
 * restaurant keeps money paid against a sale Tavli has since refunded in full.
 *
 * `amount` is the **new** part only; `cumulative` is the total that should have
 * come off this transfer, and it is in the idempotency key precisely so that a
 * second, larger reversal is a different request while a redelivery of the same
 * step is the same one.
 *
 * A failure raises a severe alert and is **not** silently swallowed: this is
 * money Tavli is owed back, and an insufficient connected-account balance (the
 * likely cause) needs a human, not a retry loop.
 */
export const reverseRecoveryTransfer = internalAction({
	args: {
		/** A refund claw-back, scoped to the payment whose sale was refunded. */
		paymentId: v.optional(v.id("payments")),
		/** An over-sized return, scoped to the ledger row that was trimmed. */
		recoveryId: v.optional(v.id("disputeRecoveries")),
		stripeTransferId: v.string(),
		/** Smallest currency unit — only the part not yet reversed. */
		amount: v.number(),
		/** Total that should be reversed out of this transfer, including `amount`. */
		cumulative: v.number(),
		label: v.string(),
	},
	handler: async (ctx, args): Promise<void> => {
		if (args.amount <= 0) return;

		// Whichever side owns this reversal is what scopes the idempotency key.
		const scope = args.paymentId ?? args.recoveryId;
		if (!scope) return;

		const stripeClient = getStripeClient();
		try {
			const reversal: Stripe.TransferReversal = await stripeClient.transfers.createReversal(
				args.stripeTransferId,
				{
					amount: args.amount,
					description: `Refund claw-back (${args.label})`,
					metadata: { scope, reason: "dispute_return_reversal" },
				},
				{
					idempotencyKey: `dispute-return-reversal:${scope}:${args.stripeTransferId}:${args.cumulative}`,
				}
			);

			await ctx.runMutation(internal.disputes.markReturnReversalInternal, {
				...(args.paymentId && { paymentId: args.paymentId }),
				...(args.recoveryId && { recoveryId: args.recoveryId }),
				stripeTransferId: args.stripeTransferId,
				cumulative: args.cumulative,
				stripeTransferReversalId: reversal.id,
			});
		} catch (error) {
			if (isIdempotencyKeyInUse(error)) return;

			// The pending entry was written before Stripe agreed to anything.
			// Left in place it would make the next, larger target compute its
			// delta from a slice that never happened — recording more reversed
			// than Stripe ever reversed. Rolled back, the next target recomputes
			// from what is confirmed and one reversal covers both slices.
			if (args.paymentId) {
				await ctx.runMutation(internal.disputes.rollBackPendingReversalInternal, {
					paymentId: args.paymentId,
					stripeTransferId: args.stripeTransferId,
				});
			}

			console.error("[disputeActions.reverseRecoveryTransfer] could not reverse the transfer", {
				...buildIntegrationErrorLog(error, {
					integration: "stripe",
					operation: "transfers.createReversal",
				}),
				scope: redactExternalId(scope),
				stripeTransferId: redactExternalId(args.stripeTransferId),
			});
			// Usually an insufficient connected-account balance: the restaurant
			// has already been paid out. That needs a human, not a retry.
			await ctx.runMutation(internal.operatorAlerts.raiseOperatorAlertInternal, {
				kind: OPERATOR_ALERT_KIND.DISPUTE_LOST,
				severity: OPERATOR_ALERT_SEVERITY.SEVERE,
				...(args.paymentId && { paymentId: args.paymentId }),
				stripeObjectId: args.stripeTransferId,
				dedupeKey: `dispute_return_reversal_failed:${scope}:${args.stripeTransferId}`,
			});
			throw error;
		}
	},
});
