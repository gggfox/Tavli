import { describe, expect, it } from "vitest";
import {
	DISPUTE_RECOVERY_MAX_PERCENT,
	DISPUTE_RECOVERY_WRITE_OFF_MS,
	DISPUTE_STATUS,
} from "./constants";
import {
	clampDisputeRecoveryPercent,
	computeDisputeDeduction,
	disputeFeeMonthKey,
	isDisputeLost,
	isDisputeWon,
	isValidDisputeRecoveryPercent,
	normalizeDisputeStatus,
	planLedgerDrawDown,
	writeOffCutoff,
} from "./disputeRecoveryHelpers";

describe("computeDisputeDeduction", () => {
	it("withholds nothing when the percentage is zero", () => {
		expect(
			computeDisputeDeduction({
				restaurantShare: 10_000,
				recoveryBase: 10_000,
				percent: 0,
				totalOutstanding: 50_000,
			})
		).toBe(0);
	});

	it("withholds nothing when nothing is outstanding", () => {
		expect(
			computeDisputeDeduction({
				restaurantShare: 10_000,
				recoveryBase: 10_000,
				percent: 25,
				totalOutstanding: 0,
			})
		).toBe(0);
	});

	it("takes the percentage of the recovery base, rounded down", () => {
		// 25% of 1,001 cents is 250.25 -> 250. Rounding down is what keeps the
		// restaurant on the right side of every fractional cent.
		expect(
			computeDisputeDeduction({
				restaurantShare: 1_001,
				recoveryBase: 1_001,
				percent: 25,
				totalOutstanding: 50_000,
			})
		).toBe(250);
	});

	it("never takes more than is outstanding", () => {
		expect(
			computeDisputeDeduction({
				restaurantShare: 10_000,
				recoveryBase: 10_000,
				percent: 50,
				totalOutstanding: 900,
			})
		).toBe(900);
	});

	it("excludes the tip from the base, so the whole gratuity still reaches the restaurant", () => {
		// 10,000 subtotal + 2,000 tip. The deduction is 50% of the SUBTOTAL, so
		// the transfer keeps at least the tip plus half the food.
		const deduction = computeDisputeDeduction({
			restaurantShare: 12_000,
			recoveryBase: 10_000,
			percent: 50,
			totalOutstanding: 99_999,
		});
		expect(deduction).toBe(5_000);
		expect(12_000 - deduction).toBeGreaterThan(2_000);
	});

	it("never drives the transfer below zero", () => {
		expect(
			computeDisputeDeduction({
				restaurantShare: 100,
				recoveryBase: 10_000,
				percent: 50,
				totalOutstanding: 99_999,
			})
		).toBe(100);
	});

	it("clamps a percentage above the cap rather than trusting the caller", () => {
		expect(
			computeDisputeDeduction({
				restaurantShare: 10_000,
				recoveryBase: 10_000,
				percent: 90,
				totalOutstanding: 99_999,
			})
		).toBe((10_000 * DISPUTE_RECOVERY_MAX_PERCENT) / 100);
	});

	it("treats a negative or unusable percentage as no deduction", () => {
		for (const percent of [-5, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(
				computeDisputeDeduction({
					restaurantShare: 10_000,
					recoveryBase: 10_000,
					percent,
					totalOutstanding: 99_999,
				})
			).toBe(0);
		}
	});
});

describe("planLedgerDrawDown", () => {
	const rows = [
		{ id: "a", outstanding: 300, lostAt: 1 },
		{ id: "b", outstanding: 500, lostAt: 2 },
		{ id: "c", outstanding: 900, lostAt: 3 },
	];

	it("draws the oldest row down first", () => {
		expect(planLedgerDrawDown(rows, 200)).toEqual([{ id: "a", amount: 200 }]);
	});

	it("spills into later rows once the oldest is cleared", () => {
		expect(planLedgerDrawDown(rows, 700)).toEqual([
			{ id: "a", amount: 300 },
			{ id: "b", amount: 400 },
		]);
	});

	it("stops when the ledger runs out, never inventing debt", () => {
		expect(planLedgerDrawDown(rows, 5_000)).toEqual([
			{ id: "a", amount: 300 },
			{ id: "b", amount: 500 },
			{ id: "c", amount: 900 },
		]);
	});

	it("plans nothing for a zero or negative amount", () => {
		expect(planLedgerDrawDown(rows, 0)).toEqual([]);
		expect(planLedgerDrawDown(rows, -10)).toEqual([]);
	});

	it("skips rows with nothing left rather than emitting zero-value legs", () => {
		expect(planLedgerDrawDown([{ id: "z", outstanding: 0, lostAt: 1 }, ...rows], 100)).toEqual([
			{ id: "a", amount: 100 },
		]);
	});
});

describe("clampDisputeRecoveryPercent / isValidDisputeRecoveryPercent", () => {
	it("accepts whole percentages inside the range", () => {
		expect(isValidDisputeRecoveryPercent(0)).toBe(true);
		expect(isValidDisputeRecoveryPercent(50)).toBe(true);
	});

	it("rejects 51 — the cap is the rule, not a hint", () => {
		expect(isValidDisputeRecoveryPercent(51)).toBe(false);
	});

	it("rejects negatives and fractions", () => {
		expect(isValidDisputeRecoveryPercent(-1)).toBe(false);
		expect(isValidDisputeRecoveryPercent(12.5)).toBe(false);
		expect(isValidDisputeRecoveryPercent(Number.NaN)).toBe(false);
	});

	it("clamps anything unusable to zero", () => {
		expect(clampDisputeRecoveryPercent(undefined)).toBe(0);
		expect(clampDisputeRecoveryPercent(-4)).toBe(0);
		expect(clampDisputeRecoveryPercent(90)).toBe(DISPUTE_RECOVERY_MAX_PERCENT);
		expect(clampDisputeRecoveryPercent(30)).toBe(30);
	});
});

describe("normalizeDisputeStatus", () => {
	it("passes Stripe's documented statuses through", () => {
		expect(normalizeDisputeStatus("needs_response")).toBe(DISPUTE_STATUS.NEEDS_RESPONSE);
		expect(normalizeDisputeStatus("lost")).toBe(DISPUTE_STATUS.LOST);
	});

	it("maps anything else to unknown rather than leaking it", () => {
		expect(normalizeDisputeStatus("something_stripe_added")).toBe(DISPUTE_STATUS.UNKNOWN);
		expect(normalizeDisputeStatus(undefined)).toBe(DISPUTE_STATUS.UNKNOWN);
	});

	it("only says lost for the lost status", () => {
		expect(isDisputeLost("lost")).toBe(true);
		expect(isDisputeLost("Lost")).toBe(false);
		expect(isDisputeLost("under_review")).toBe(false);
	});

	it("treats a closed warning as a win: Stripe never took the money", () => {
		expect(isDisputeWon("won")).toBe(true);
		expect(isDisputeWon("warning_closed")).toBe(true);
		expect(isDisputeWon("lost")).toBe(false);
	});
});

describe("disputeFeeMonthKey", () => {
	it("formats UTC year and month, zero padded", () => {
		expect(disputeFeeMonthKey(Date.UTC(2026, 0, 31, 23, 59))).toBe("2026-01");
		expect(disputeFeeMonthKey(Date.UTC(2026, 11, 1))).toBe("2026-12");
	});
});

describe("writeOffCutoff", () => {
	it("is exactly the write-off window behind now", () => {
		const now = 1_800_000_000_000;
		expect(writeOffCutoff(now)).toBe(now - DISPUTE_RECOVERY_WRITE_OFF_MS);
	});
});
