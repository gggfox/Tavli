/**
 * Structural guards for the per-order tip's money rules (TAVLI-99).
 *
 * These are source assertions rather than behaviour tests, and that is a
 * deliberate trade rather than a shortcut: both invariants live inside
 * `stripe.createPaymentIntent`, an action whose behaviour cannot be exercised
 * without standing up a Stripe double, and both fail **silently and
 * expensively** if broken. A guard that pins the line is worth more than no
 * guard at all while a full integration harness does not exist.
 *
 * If one of these ever fires, do not "fix" it by editing the assertion.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(join(__dirname, "stripe.ts"), "utf8");

/** The `createPaymentIntent` action body. */
function createPaymentIntentSource(): string {
	const start = SOURCE.indexOf("export const createPaymentIntent = action({");
	expect(start, "createPaymentIntent not found — was it renamed?").toBeGreaterThan(-1);
	const next = SOURCE.indexOf("\nexport const ", start + 1);
	return SOURCE.slice(start, next === -1 ? undefined : next);
}

describe("the tip does not attract the platform fee", () => {
	it("passes feeAmount to Stripe as application_fee_amount, never amount", () => {
		// `amount` includes the tip. Passing it here would take 12% of every
		// gratuity — the restaurant quietly loses money on tips, and the diner
		// is charged a service fee on a gift they chose to give. The schema
		// states the invariant outright: "tip payments carry feeAmount 0 — the
		// service fee never applies to tips."
		const body = createPaymentIntentSource();
		expect(body).toContain("application_fee_amount: feeAmount");
		expect(body).not.toContain("application_fee_amount: amount");
	});

	it("computes the fee from the subtotal alone", () => {
		// `computeOrderCharge` takes the subtotal and derives the fee from it;
		// nothing in this action may re-derive a fee from a tip-inclusive total.
		const body = createPaymentIntentSource();
		expect(body).toContain("computeOrderCharge(");
		expect(body).not.toMatch(/feeAmount\s*=\s*Math\.round\(\s*amount/);
	});
});

describe("changing the tip cannot reuse a stale PaymentIntent", () => {
	it("includes gratuity in the reuse check", () => {
		// The trap. Without this the order has not been edited, so `updatedAt`
		// and the subtotal both still match and the stale intent looks
		// reusable — Stripe fixed its amount at creation, so the diner moves
		// the slider, watches the total update, taps Pay, and is charged what
		// the slider said a minute ago. No error anywhere; the receipt simply
		// disagrees with the screen.
		const body = createPaymentIntentSource();
		const reuseStart = body.indexOf("const canReuseExistingIntent =");
		expect(reuseStart, "the reuse check was renamed or removed").toBeGreaterThan(-1);
		const reuseCheck = body.slice(reuseStart, body.indexOf(";", reuseStart));

		expect(
			reuseCheck,
			"createPaymentIntent can reuse an existing intent without comparing the tip. " +
				"A diner who changes the tip after the sheet mounts would be charged the " +
				"previous amount, silently."
		).toContain("gratuityAmount");
	});

	it("still compares the subtotal and the order's updatedAt", () => {
		// The pre-existing halves of the same guard: an edited order must
		// supersede its intent, and a legacy fee-less row must not be reused.
		const body = createPaymentIntentSource();
		const reuseStart = body.indexOf("const canReuseExistingIntent =");
		const reuseCheck = body.slice(reuseStart, body.indexOf(";", reuseStart));
		expect(reuseCheck).toContain("orderUpdatedAtSnapshot === order.updatedAt");
		expect(reuseCheck).toContain("subtotalAmount === order.totalAmount");
	});
});
