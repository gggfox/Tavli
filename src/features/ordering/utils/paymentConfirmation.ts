/**
 * "The diner has confirmed this card payment" — remembered in the browser.
 *
 * The backend cannot answer that question. A payment row goes `processing` the
 * moment its PaymentIntent is created (see `decidePaymentReconciliation` in
 * `convex/paymentReconcileHelpers.ts`), long before the diner types a card, so
 * `activePayment.status === "processing"` means "a charge is prepared", not "a
 * charge is moving". Treating it as the latter would lock every diner who
 * reloads an untouched checkout out of the pay button.
 *
 * What the browser does know is the moment `stripe.confirmPayment` came back
 * without an error (or Stripe redirected back after 3-D Secure saying so). That
 * moment is recorded here, per order, keyed by the PaymentIntent it confirmed,
 * so the checkout can keep showing "confirming your payment" across a reload
 * instead of offering a second attempt. A record for an intent the order no
 * longer points at is ignored by the caller, so a superseded attempt can never
 * hold a fresh one hostage.
 *
 * `sessionStorage` is per tab and survives a reload and a same-tab 3-D Secure
 * redirect, which is exactly the window this has to cover. It can be missing
 * or throw (private windows, blocked storage); every access is guarded and the
 * fallback is the old behaviour — the pay button — where the backend already
 * refuses a second charge with `ERROR_PAYMENT_ALREADY_PAID`.
 */
import { useSyncExternalStore } from "react";

export interface PaymentConfirmation {
	/** The PaymentIntent the diner confirmed (`pi_…`). */
	readonly paymentIntentId: string;
	/** Epoch ms when the confirmation was observed; drives the escalation copy. */
	readonly confirmedAt: number;
}

/**
 * How long "confirming your payment" stays calm before the copy escalates to
 * "don't pay again, show this screen to staff".
 *
 * The webhook normally lands in a second or two, so 25 seconds is well past
 * the normal case without leaving a diner staring at a spinner long enough to
 * start tapping things. It is not a deadline for the money: a dropped webhook
 * is settled by the stuck-payment sweep (`reconcileStuckPayments`, minutes
 * later), and the screen keeps listening the whole time.
 */
export const PAYMENT_CONFIRMATION_ESCALATE_AFTER_MS = 25_000;

/**
 * PaymentIntent statuses that mean the diner's part is done and the money is
 * Stripe's to settle. `requires_capture` cannot happen on this automatic-capture
 * integration; it is listed so a future manual-capture flow is not mistaken for
 * a failure.
 */
const CONFIRMED_INTENT_STATUSES = new Set(["succeeded", "processing", "requires_capture"]);

/** Does this PaymentIntent (or 3-D Secure `redirect_status`) mean "confirmed"? */
export function isConfirmedIntentStatus(status: string | undefined): boolean {
	return status !== undefined && CONFIRMED_INTENT_STATUSES.has(status);
}

const storageKey = (orderId: string) => `tavli:order-payment-confirmation:${orderId}`;

const listeners = new Set<() => void>();

function notify() {
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function readRaw(orderId: string): string | null {
	try {
		return globalThis.sessionStorage?.getItem(storageKey(orderId)) ?? null;
	} catch {
		return null;
	}
}

function parse(raw: string | null): PaymentConfirmation | null {
	if (!raw) return null;
	try {
		const value = JSON.parse(raw) as Partial<PaymentConfirmation>;
		if (typeof value.paymentIntentId !== "string" || typeof value.confirmedAt !== "number") {
			return null;
		}
		return { paymentIntentId: value.paymentIntentId, confirmedAt: value.confirmedAt };
	} catch {
		return null;
	}
}

export function readPaymentConfirmation(orderId: string): PaymentConfirmation | null {
	return parse(readRaw(orderId));
}

export function rememberPaymentConfirmation(
	orderId: string,
	confirmation: PaymentConfirmation
): void {
	try {
		globalThis.sessionStorage?.setItem(storageKey(orderId), JSON.stringify(confirmation));
	} catch {
		// Storage unavailable: the in-page state still covers this visit.
	}
	notify();
}

export function forgetPaymentConfirmation(orderId: string): void {
	try {
		globalThis.sessionStorage?.removeItem(storageKey(orderId));
	} catch {
		// Nothing stored, nothing to forget.
	}
	notify();
}

/**
 * The stored confirmation for `orderId`, or `null`.
 *
 * An external store rather than a `useState` initializer so the server render
 * (no storage) and the first client render agree: the server snapshot is
 * always `null`, and the stored value arrives on the client without a
 * hydration mismatch. The snapshot is the raw string, which compares by value,
 * so an unchanged record never re-renders.
 */
export function useStoredPaymentConfirmation(orderId: string): PaymentConfirmation | null {
	const raw = useSyncExternalStore(
		subscribe,
		() => readRaw(orderId),
		() => null
	);
	return parse(raw);
}
