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
 * Minimal structural view of a Stripe `Dispute` as delivered on a
 * `charge.dispute.created` / `charge.dispute.closed` event.
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
}

/** Which `charge.dispute.*` event produced these facts. */
export const DISPUTE_PHASE = {
	CREATED: "created",
	CLOSED: "closed",
} as const;

export type DisputePhase = (typeof DISPUTE_PHASE)[keyof typeof DISPUTE_PHASE];

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
}

/** Extracts the dispute facts we persist and surface for staff visibility. */
export function computeDisputeFacts(dispute: DisputeInput): DisputeFacts {
	return {
		disputeId: dispute.id,
		amount: dispute.amount ?? 0,
		currency: dispute.currency ?? "",
		reason: dispute.reason ?? "unknown",
		status: dispute.status ?? "unknown",
		chargeId: extractStripeId(dispute.charge),
		paymentIntentId: extractStripeId(dispute.payment_intent),
		createdAtMs: stripeSecondsToMs(dispute.created),
		isLost: dispute.status === "lost",
	};
}
