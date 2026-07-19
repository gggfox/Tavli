/**
 * Unit tests for the pure tab helpers in `convex/sessionHelpers.ts`.
 *
 * `decideTabReconciliation` is the decision core of the TAVLI-45 stuck-tab
 * reconciliation cron: it maps a Stripe PaymentIntent status plus the age of
 * the payment lock to one of settle / unlock / wait / alert, with no Stripe or
 * database involvement.
 */
import { describe, expect, it } from "vitest";
import { decideTabReconciliation } from "../sessionHelpers";

const MINUTE = 60 * 1000;
const ALERT_AGE_MS = 30 * MINUTE;

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
