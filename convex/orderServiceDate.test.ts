import { describe, expect, it } from "vitest";
import {
	DEFAULT_ORDER_DAY_START_MINUTES,
	getOrderResetPeriodKey,
	getOrderServiceDateKey,
} from "./orderServiceDate";

describe("getOrderServiceDateKey", () => {
	it("uses previous calendar date before cutoff (UTC)", () => {
		// 2024-06-15 03:30 UTC — before 04:00 cutoff → service date 2024-06-14
		const ms = Date.UTC(2024, 5, 15, 3, 30, 0, 0);
		expect(getOrderServiceDateKey(ms, "UTC", DEFAULT_ORDER_DAY_START_MINUTES)).toBe("2024-06-14");
	});

	it("uses same calendar date at and after cutoff (UTC)", () => {
		const atCutoff = Date.UTC(2024, 5, 15, 4, 0, 0, 0);
		expect(getOrderServiceDateKey(atCutoff, "UTC", DEFAULT_ORDER_DAY_START_MINUTES)).toBe(
			"2024-06-15"
		);

		const after = Date.UTC(2024, 5, 15, 10, 0, 0, 0);
		expect(getOrderServiceDateKey(after, "UTC", DEFAULT_ORDER_DAY_START_MINUTES)).toBe(
			"2024-06-15"
		);
	});

	it("defaults cutoff to 04:00 when minutes omitted", () => {
		const ms = Date.UTC(2024, 5, 15, 3, 59, 0, 0);
		expect(getOrderServiceDateKey(ms, "UTC", undefined)).toBe("2024-06-14");
	});

	it("uses UTC when timezone missing", () => {
		const ms = Date.UTC(2024, 5, 15, 10, 0, 0, 0);
		expect(getOrderServiceDateKey(ms, undefined, 0)).toBe("2024-06-15");
	});

	it("respects custom cutoff minute boundary", () => {
		const cutoff = 8 * 60; // 08:00
		const before = Date.UTC(2024, 5, 15, 7, 59, 0, 0);
		expect(getOrderServiceDateKey(before, "UTC", cutoff)).toBe("2024-06-14");
		const at = Date.UTC(2024, 5, 15, 8, 0, 0, 0);
		expect(getOrderServiceDateKey(at, "UTC", cutoff)).toBe("2024-06-15");
	});

	it("maps America/New_York local wall time (summer)", () => {
		// 2024-06-15 08:00 UTC = 04:00 EDT → exactly at default cutoff → same NY calendar day 2024-06-15
		const ms = Date.UTC(2024, 5, 15, 8, 0, 0, 0);
		expect(getOrderServiceDateKey(ms, "America/New_York", DEFAULT_ORDER_DAY_START_MINUTES)).toBe(
			"2024-06-15"
		);
	});

	it("falls back to UTC on invalid timezone string", () => {
		const ms = Date.UTC(2024, 5, 15, 10, 0, 0, 0);
		expect(getOrderServiceDateKey(ms, "Not/A_Real_Zone", 0)).toBe("2024-06-15");
	});
});

describe("getOrderResetPeriodKey", () => {
	const cutoff = DEFAULT_ORDER_DAY_START_MINUTES;

	describe("daily", () => {
		it("equals the daily service date key", () => {
			const ms = Date.UTC(2024, 5, 15, 10, 0, 0, 0);
			expect(getOrderResetPeriodKey(ms, "UTC", cutoff, "daily")).toBe(
				getOrderServiceDateKey(ms, "UTC", cutoff)
			);
		});
	});

	describe("monthly (default)", () => {
		it("collapses to YYYY-MM", () => {
			const ms = Date.UTC(2024, 5, 15, 10, 0, 0, 0);
			expect(getOrderResetPeriodKey(ms, "UTC", cutoff, "monthly")).toBe("2024-06");
		});

		it("rolls into the previous month when before cutoff on the 1st", () => {
			// 2024-07-01 03:30 UTC, 04:00 cutoff → service day 2024-06-30 → month 2024-06
			const ms = Date.UTC(2024, 6, 1, 3, 30, 0, 0);
			expect(getOrderResetPeriodKey(ms, "UTC", cutoff, "monthly")).toBe("2024-06");
		});

		it("uses monthly when frequency is undefined (default)", () => {
			const ms = Date.UTC(2024, 5, 15, 10, 0, 0, 0);
			expect(getOrderResetPeriodKey(ms, "UTC", cutoff, undefined)).toBe("2024-06");
		});
	});

	describe("weekly", () => {
		it("returns YYYY-Www for an ISO week (Mon-start)", () => {
			// 2024-06-12 (Wed) → ISO week 24 of 2024
			const ms = Date.UTC(2024, 5, 12, 10, 0, 0, 0);
			expect(getOrderResetPeriodKey(ms, "UTC", cutoff, "weekly")).toBe("2024-W24");
		});

		it("rolls into the previous ISO week before cutoff on a Monday", () => {
			// 2024-06-17 03:30 UTC is a Monday before 04:00 cutoff. The service
			// date is 2024-06-16 (Sunday), which belongs to ISO week 24, not 25.
			const ms = Date.UTC(2024, 5, 17, 3, 30, 0, 0);
			expect(getOrderResetPeriodKey(ms, "UTC", cutoff, "weekly")).toBe("2024-W24");
		});

		it("crosses an ISO year boundary correctly", () => {
			// 2024-12-30 is Mon of ISO week 1 of 2025.
			const ms = Date.UTC(2024, 11, 30, 10, 0, 0, 0);
			expect(getOrderResetPeriodKey(ms, "UTC", cutoff, "weekly")).toBe("2025-W01");
		});
	});

	describe("biweekly", () => {
		it("collapses pairs of ISO weeks into a single bucket", () => {
			// 2024-06-12 (Wed, ISO week 24) and 2024-06-19 (Wed, ISO week 25)
			// share the same biweekly bucket: floor(24/2)*2 = 24 and
			// floor(25/2)*2 = 24.
			const wkA = Date.UTC(2024, 5, 12, 10, 0, 0, 0);
			const wkB = Date.UTC(2024, 5, 19, 10, 0, 0, 0);
			const a = getOrderResetPeriodKey(wkA, "UTC", cutoff, "biweekly");
			const b = getOrderResetPeriodKey(wkB, "UTC", cutoff, "biweekly");
			expect(a).toBe("2024-B24");
			expect(b).toBe(a);
		});

		it("starts a new bucket once the bucket boundary is crossed", () => {
			// ISO week 26 (2024-06-26 Wed) → floor(26/2)*2 = 26 → "2024-B26"
			const ms = Date.UTC(2024, 5, 26, 10, 0, 0, 0);
			expect(getOrderResetPeriodKey(ms, "UTC", cutoff, "biweekly")).toBe("2024-B26");
		});
	});

	describe("timezone awareness", () => {
		it("differs between UTC and a westward zone at a UTC-day boundary", () => {
			// 2024-06-15 02:00 UTC = 2024-06-14 22:00 in America/New_York (EDT).
			// Monthly bucket therefore also differs only when straddling a month
			// boundary; for 2024-06-15 both are still "2024-06". Use 2024-07-01
			// 02:00 UTC instead — which is 2024-06-30 22:00 EDT.
			const ms = Date.UTC(2024, 6, 1, 2, 0, 0, 0);
			expect(getOrderResetPeriodKey(ms, "UTC", 0, "monthly")).toBe("2024-07");
			expect(getOrderResetPeriodKey(ms, "America/New_York", 0, "monthly")).toBe("2024-06");
		});
	});
});
