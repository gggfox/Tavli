/**
 * Unit tests for the pure tab helpers in `convex/sessionHelpers.ts`.
 *
 * `decideTabReconciliation` is the decision core of the TAVLI-45 stuck-tab
 * reconciliation cron: it maps a Stripe PaymentIntent status plus the age of
 * the payment lock to one of settle / unlock / wait / alert, with no Stripe or
 * database involvement.
 */
import { describe, expect, it } from "vitest";
import type { Doc } from "../_generated/dataModel";
import { blocksTabSettlement, decideTabReconciliation } from "../sessionHelpers";

const MINUTE = 60 * 1000;
const ALERT_AGE_MS = 30 * MINUTE;

/** Only the two fields `blocksTabSettlement` reads. */
function orderLike(status: string, paymentState = "unpaid"): Doc<"orders"> {
	return { status, paymentState } as unknown as Doc<"orders">;
}

describe("decideTabReconciliation", () => {
	it("settles when the PaymentIntent has succeeded (dropped webhook)", () => {
		expect(
			decideTabReconciliation({
				paymentIntentStatus: "succeeded",
				lockAgeMs: 12 * MINUTE,
				alertAgeMs: ALERT_AGE_MS,
			})
		).toBe("settle");
	});

	it("settles a succeeded PaymentIntent regardless of how old the lock is", () => {
		expect(
			decideTabReconciliation({
				paymentIntentStatus: "succeeded",
				lockAgeMs: 5 * 60 * MINUTE,
				alertAgeMs: ALERT_AGE_MS,
			})
		).toBe("settle");
	});

	it("unlocks a canceled PaymentIntent", () => {
		expect(
			decideTabReconciliation({
				paymentIntentStatus: "canceled",
				lockAgeMs: 12 * MINUTE,
				alertAgeMs: ALERT_AGE_MS,
			})
		).toBe("unlock");
	});

	it("unlocks when the attempt is stalled waiting on the customer", () => {
		for (const status of ["requires_payment_method", "requires_confirmation", "requires_action"]) {
			expect(
				decideTabReconciliation({
					paymentIntentStatus: status,
					lockAgeMs: 12 * MINUTE,
					alertAgeMs: ALERT_AGE_MS,
				})
			).toBe("unlock");
		}
	});

	it("waits while a young PaymentIntent is still processing", () => {
		expect(
			decideTabReconciliation({
				paymentIntentStatus: "processing",
				lockAgeMs: 12 * MINUTE,
				alertAgeMs: ALERT_AGE_MS,
			})
		).toBe("wait");
	});

	it("alerts once a still-processing PaymentIntent outlives the alert age", () => {
		expect(
			decideTabReconciliation({
				paymentIntentStatus: "processing",
				lockAgeMs: ALERT_AGE_MS,
				alertAgeMs: ALERT_AGE_MS,
			})
		).toBe("alert");
		expect(
			decideTabReconciliation({
				paymentIntentStatus: "processing",
				lockAgeMs: 45 * MINUTE,
				alertAgeMs: ALERT_AGE_MS,
			})
		).toBe("alert");
	});

	it("holds the lock on an unexpected status, escalating to alert when old", () => {
		// requires_capture never occurs in this automatic-capture integration, but
		// the fallback must not guess: young → wait, old → alert (never unlock).
		expect(
			decideTabReconciliation({
				paymentIntentStatus: "requires_capture",
				lockAgeMs: 12 * MINUTE,
				alertAgeMs: ALERT_AGE_MS,
			})
		).toBe("wait");
		expect(
			decideTabReconciliation({
				paymentIntentStatus: "requires_capture",
				lockAgeMs: 40 * MINUTE,
				alertAgeMs: ALERT_AGE_MS,
			})
		).toBe("alert");
	});
});

describe("blocksTabSettlement", () => {
	it("does not block a served order — the only settleable status", () => {
		expect(blocksTabSettlement(orderLike("served"))).toBe(false);
	});

	it("blocks every payable order the diner hasn't received yet", () => {
		for (const status of ["submitted", "preparing", "ready"]) {
			expect(blocksTabSettlement(orderLike(status))).toBe(true);
		}
	});

	it("does not block a draft order", () => {
		// An open cart was never sent to the kitchen, so it is neither billed nor
		// a reason the diner can't settle what they have already eaten.
		expect(blocksTabSettlement(orderLike("draft"))).toBe(false);
	});

	it("does not block a cancelled order — this is the escape valve", () => {
		// Staff cancelling un-served food is how a blocked tab gets unblocked. The
		// order leaves the tab in the same instant, and costs nothing: an unpaid
		// cancel makes no Stripe call.
		expect(blocksTabSettlement(orderLike("cancelled"))).toBe(false);
	});

	it("does not block an already-paid order left in a pre-served status", () => {
		// The legacy per-order path writes exactly this shape
		// (`orders.confirmPayment`: status `submitted`, paymentState `paid`).
		// Blocking here would deadlock the tab, and the only way out — cancelling
		// the order — resolves to a real Stripe refund, which is the outcome this
		// whole guard exists to prevent.
		expect(blocksTabSettlement(orderLike("submitted", "paid"))).toBe(false);
	});
});
