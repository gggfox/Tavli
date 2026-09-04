import { describe, expect, it } from "vitest";
import {
	TIP_MAX_PERCENT,
	TIP_MIN_PERCENT,
	clampTipPercent,
	computeOrderCharge,
	computeTipAmount,
	tipMood,
} from "./tip";

/** The rate the app ships with, so the arithmetic below is the real one. */
const FEE_RATE = 0.12;

describe("computeOrderCharge", () => {
	it("computes the tip on the subtotal, not the total", () => {
		// The whole point. 10% of a $100 subtotal is $10; 10% of the $112 the
		// diner actually pays is $11.20 — which tips on Tavli's service fee.
		// The restaurant did not earn that and the diner did not intend it.
		const charge = computeOrderCharge(10_000, FEE_RATE, 10);
		expect(charge.gratuityAmount).toBe(1_000);
		expect(charge.gratuityAmount).not.toBe(1_120);
	});

	it("computes the fee on the subtotal, not on the subtotal plus tip", () => {
		// The schema's invariant: the service fee never applies to tips.
		const withoutTip = computeOrderCharge(10_000, FEE_RATE, 0);
		const withTip = computeOrderCharge(10_000, FEE_RATE, 20);
		expect(withTip.feeAmount).toBe(withoutTip.feeAmount);
	});

	it("adds up", () => {
		// A receipt whose lines do not sum to its total is a support ticket
		// nobody can close.
		for (const subtotal of [1, 99, 100, 333, 10_000, 123_456]) {
			for (const percent of [0, 1, 7, 10, 15, 25]) {
				const charge = computeOrderCharge(subtotal, FEE_RATE, percent);
				expect(
					charge.subtotalAmount + charge.feeAmount + charge.gratuityAmount,
					`${subtotal} @ ${percent}%`
				).toBe(charge.amount);
			}
		}
	});

	it("returns whole cents", () => {
		// Stripe takes integers. A fractional cent anywhere here is a rejected
		// PaymentIntent at the worst possible moment.
		for (const subtotal of [1, 7, 33, 4_999, 100_003]) {
			for (const percent of [0, 3, 10, 17, 25]) {
				const charge = computeOrderCharge(subtotal, FEE_RATE, percent);
				for (const [name, value] of Object.entries(charge)) {
					expect(Number.isInteger(value), `${name} @ ${subtotal}/${percent}%`).toBe(true);
				}
			}
		}
	});

	it("charges no tip at zero", () => {
		const charge = computeOrderCharge(10_000, FEE_RATE, 0);
		expect(charge.gratuityAmount).toBe(0);
		expect(charge.amount).toBe(10_000 + charge.feeAmount);
	});
});

describe("computeTipAmount", () => {
	it("rounds half-up", () => {
		// 3% of 1050 is 31.5 cents.
		expect(computeTipAmount(1_050, 3)).toBe(32);
	});

	it("never charges a negative tip", () => {
		expect(computeTipAmount(10_000, -50)).toBe(0);
	});

	it("caps at the slider's maximum", () => {
		expect(computeTipAmount(10_000, 999)).toBe(computeTipAmount(10_000, TIP_MAX_PERCENT));
	});
});

describe("clampTipPercent", () => {
	it("clamps rather than throwing", () => {
		// This value arrives from a slider. A diner whose input is somehow out
		// of range should be charged a sane amount, not shown a payment error
		// they have no way to act on.
		expect(clampTipPercent(-1)).toBe(TIP_MIN_PERCENT);
		expect(clampTipPercent(1_000)).toBe(TIP_MAX_PERCENT);
		expect(clampTipPercent(Number.NaN)).toBe(TIP_MIN_PERCENT);
		expect(clampTipPercent(Number.POSITIVE_INFINITY)).toBe(TIP_MIN_PERCENT);
	});

	it("rounds to whole percentage points", () => {
		expect(clampTipPercent(10.4)).toBe(10);
		expect(clampTipPercent(10.6)).toBe(11);
	});
});

describe("tipMood", () => {
	it("is neutral at zero, never sad", () => {
		// A frowning face aimed at the diner who chose not to tip is a nudge
		// pointed at the one person it cannot fairly be pointed at — they may
		// be tipping the server in cash — and it is the sort of thing that gets
		// screenshotted.
		expect(tipMood(0)).toBe("neutral");
	});

	it("brightens at the default and celebrates above it", () => {
		expect(tipMood(10)).toBe("happy");
		expect(tipMood(15)).toBe("party");
		expect(tipMood(25)).toBe("party");
	});

	it("never returns anything but the three known moods", () => {
		for (let percent = -5; percent <= 30; percent++) {
			expect(["neutral", "happy", "party"]).toContain(tipMood(percent));
		}
	});
});
