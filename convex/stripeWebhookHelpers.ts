/**
 * Pure event → state-change logic for the `charge.refunded` and
 * `charge.dispute.*` Stripe webhooks.
 *
 * These functions are deliberately free of Convex `ctx` and the Stripe SDK
 * client so they can be unit-tested with plain objects. The `"use node"`
 * handlers in `convex/_util/stripe.ts` call them, then persist the returned
 * facts through internal mutations.
 *
 * Routing note: our checkout uses **destination charges** (charge on the
 * platform account, transfer to the connected account) and the platform is the
 * `losses_collector`. Refunds and disputes therefore settle against the
 * platform balance and their events are delivered to the **standard** webhook
 * (`POST /stripe/webhook`), NOT the V2 connect thin-event endpoint.
 */
import { PAYMENT_REFUND_STATUS } from "./constants";
import { isDisputeLost } from "./disputeRecoveryHelpers";

// `DISPUTE_PHASE` used to live here, when "created" and "closed" were purely a
// webhook detail. TAVLI-102 made the phase a domain term — it names a bell
// notification's dedupe key and decides whether a recovery ledger row opens or
// is credited back — so it moved to `convex/constants.ts` with the rest of the
// vocabulary. Re-exported so the many `from "./stripeWebhookHelpers"` imports
// keep working and there is still one obvious place to find it from a webhook
// handler.
export { DISPUTE_PHASE, type DisputePhase } from "./constants";

/**
 * Marker embedded in the error a Stripe action throws when the deployment is
 * not configured for Stripe at all — a missing signing secret or a missing
 * `STRIPE_SECRET_KEY`.
 *
 * The HTTP routes in `convex/http.ts` catch everything `ctx.runAction` throws
 * and, before TAVLI-65, answered 400 for all of it. That conflated two
 * opposite diagnoses for whoever is reading the logs during a cutover: a 400 is
 * "Stripe sent something we rejected" (wrong secret, tampered payload), while a
 * missing secret is "Tavli is not configured" — nothing about the request is
 * wrong and no amount of re-sending it will help. Since
 * `STRIPE_CONNECT_WEBHOOK_SECRET` has never been set on any deployment, that
 * was the case an operator was most likely to hit first, wearing the one label
 * guaranteed to send them looking in the wrong place.
 *
 * A marker in the message rather than a custom error class because the throw
 * crosses a Convex action boundary, which preserves the message and not the
 * prototype.
 *
 * It covers the API key as well as the two signing secrets deliberately: a
 * deployment missing `STRIPE_SECRET_KEY` fails inside `getStripeClient()`, and
 * without the marker that too came back as a 400 the triage table would read as
 * "the signing secret is wrong".
 */
export const STRIPE_NOT_CONFIGURED = "STRIPE_NOT_CONFIGURED";

/**
 * Whether a caught Stripe error is "this deployment is not configured" rather
 * than "this delivery failed verification". Drives 500 vs 400 in
 * `convex/http.ts`.
 */
export function isStripeNotConfiguredError(error: unknown): boolean {
	const message =
		error instanceof Error ? error.message : typeof error === "string" ? error : String(error);
	return message.includes(STRIPE_NOT_CONFIGURED);
}

/** Narrow the `string | { id } | null | undefined` shape Stripe uses for expandable refs. */
export function extractStripeId(
	ref: string | { id?: string | null } | null | undefined
): string | undefined {
	if (!ref) return undefined;
	if (typeof ref === "string") return ref;
	return typeof ref.id === "string" ? ref.id : undefined;
}

/** Convert a Stripe epoch-seconds timestamp to epoch milliseconds. */
export function stripeSecondsToMs(seconds: number | null | undefined): number | undefined {
	return typeof seconds === "number" ? seconds * 1000 : undefined;
}

/**
 * Minimal structural view of a Stripe `Charge` as delivered on a
 * `charge.refunded` event. Kept structural (rather than importing the SDK type)
 * so tests can build fixtures without the whole `Stripe.Charge` shape.
 */
export interface ChargeRefundInput {
	amount?: number | null;
	amount_captured?: number | null;
	amount_refunded?: number | null;
	refunded?: boolean | null;
	currency?: string | null;
	payment_intent?: string | { id?: string | null } | null;
	refunds?: { data?: Array<{ id?: string | null; created?: number | null }> | null } | null;
}

export interface RefundFacts {
	/** PaymentIntent id used to resolve the in-app payment record. */
	paymentIntentId: string | undefined;
	/** Total captured amount (falls back to `amount` when `amount_captured` is absent). */
	amountCaptured: number;
	/** Cumulative amount refunded so far, smallest currency unit. */
	amountRefunded: number;
	/** True when the whole captured amount has been refunded. */
	isFullyRefunded: boolean;
	/** Maps to a `payments.refundStatus` value. */
	refundStatus: typeof PAYMENT_REFUND_STATUS.SUCCEEDED | typeof PAYMENT_REFUND_STATUS.PARTIAL;
	/** Most recent Stripe refund id, when the charge carries an expanded refunds list. */
	latestRefundId: string | undefined;
	/** Timestamp (ms) of the most recent refund, when available. */
	refundedAtMs: number | undefined;
}

/**
 * Derives refund facts from a `charge.refunded` charge object. Treats the
 * refund as full when Stripe flags `refunded: true` or the refunded amount has
 * caught up to the captured amount; otherwise partial.
 */
export function computeRefundFacts(charge: ChargeRefundInput): RefundFacts {
	const amountCaptured = charge.amount_captured ?? charge.amount ?? 0;
	const amountRefunded = charge.amount_refunded ?? 0;
	const isFullyRefunded =
		charge.refunded === true || (amountCaptured > 0 && amountRefunded >= amountCaptured);

	const latest = charge.refunds?.data?.[0];
	const latestRefundId = typeof latest?.id === "string" ? latest.id : undefined;
	const refundedAtMs = stripeSecondsToMs(latest?.created);

	return {
		paymentIntentId: extractStripeId(charge.payment_intent),
		amountCaptured,
		amountRefunded,
		isFullyRefunded,
		refundStatus: isFullyRefunded ? PAYMENT_REFUND_STATUS.SUCCEEDED : PAYMENT_REFUND_STATUS.PARTIAL,
		latestRefundId,
		refundedAtMs,
	};
}

/**
 * One entry of a dispute's `balance_transactions` array.
 *
 * Stripe posts one balance transaction when a dispute is opened (the money and
 * the fee leaving) and another when it is reversed (both coming back), so the
 * array can hold entries of both signs. Only `fee` and `created` matter here.
 */
export interface DisputeBalanceTransactionInput {
	fee?: number | null;
	created?: number | null;
	reporting_category?: string | null;
}

/**
 * Minimal structural view of a Stripe `Dispute` as delivered on a
 * `charge.dispute.*` event.
 */
export interface DisputeInput {
	id: string;
	amount?: number | null;
	currency?: string | null;
	reason?: string | null;
	status?: string | null;
	charge?: string | { id?: string | null } | null;
	payment_intent?: string | { id?: string | null } | null;
	created?: number | null;
	balance_transactions?: DisputeBalanceTransactionInput[] | null;
}

export interface DisputeFacts {
	disputeId: string;
	amount: number;
	currency: string;
	reason: string;
	status: string;
	chargeId: string | undefined;
	paymentIntentId: string | undefined;
	/** Dispute `created` timestamp (ms), when present. */
	createdAtMs: number | undefined;
	/** True when Stripe has resolved the dispute against us (funds withdrawn). */
	isLost: boolean;
	/**
	 * Stripe's dispute fee in the smallest currency unit, when the dispute's
	 * balance transactions expose one. **Tavli absorbs this** — it is recorded
	 * for the platform's own accounting and never added to a restaurant's
	 * recovery ledger.
	 */
	feeAmount: number | undefined;
	/** `created` (ms) of the balance transaction the fee came from. */
	feeAtMs: number | undefined;
}

/**
 * The dispute fee, summed across the balance transactions that charge one.
 *
 * Summed rather than "the first one": a dispute that is lost and later
 * reinstated posts a second balance transaction, and Stripe refunds the fee on
 * some reversals by posting a negative one. Adding them up is therefore the
 * only reading that stays true as a dispute moves — and a net of zero (fee
 * charged, fee returned) is a real answer, not a missing one.
 *
 * Returns `undefined` when no balance transaction is present at all, which is
 * the normal state for a warning-stage dispute and for the slimmed-down object
 * Stripe puts on some deliveries; the caller then fetches the dispute.
 */
export function computeDisputeFee(dispute: DisputeInput): {
	feeAmount: number | undefined;
	feeAtMs: number | undefined;
} {
	const transactions = dispute.balance_transactions;
	if (!Array.isArray(transactions) || transactions.length === 0) {
		return { feeAmount: undefined, feeAtMs: undefined };
	}

	let total = 0;
	let seenFee = false;
	let feeAtMs: number | undefined;
	for (const transaction of transactions) {
		if (typeof transaction?.fee !== "number") continue;
		seenFee = true;
		total += transaction.fee;
		// The earliest fee-bearing transaction dates the fee: that is the month
		// the platform was charged in, which is what the aggregate is keyed by.
		const createdMs = stripeSecondsToMs(transaction.created);
		if (createdMs !== undefined && (feeAtMs === undefined || createdMs < feeAtMs)) {
			feeAtMs = createdMs;
		}
	}

	return seenFee ? { feeAmount: total, feeAtMs } : { feeAmount: undefined, feeAtMs: undefined };
}

/** Extracts the dispute facts we persist and surface for staff visibility. */
export function computeDisputeFacts(dispute: DisputeInput): DisputeFacts {
	const { feeAmount, feeAtMs } = computeDisputeFee(dispute);
	return {
		disputeId: dispute.id,
		amount: dispute.amount ?? 0,
		currency: dispute.currency ?? "",
		reason: dispute.reason ?? "unknown",
		status: dispute.status ?? "unknown",
		chargeId: extractStripeId(dispute.charge),
		paymentIntentId: extractStripeId(dispute.payment_intent),
		createdAtMs: stripeSecondsToMs(dispute.created),
		isLost: isDisputeLost(dispute.status),
		feeAmount,
		feeAtMs,
	};
}
