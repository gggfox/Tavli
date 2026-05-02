import { describe, expect, it } from "vitest";
import { DEFAULT_ORDER_DAY_START_MINUTES, getOrderServiceDateKey } from "./orderServiceDate";

describe("getOrderServiceDateKey", () => {
	it("uses previous calendar date before cutoff (UTC)", () => {
		// 2024-06-15 03:30 UTC — before 04:00 cutoff → service date 2024-06-14
		const ms = Date.UTC(2024, 5, 15, 3, 30, 0, 0);
		expect(getOrderServiceDateKey(ms, "UTC", DEFAULT_ORDER_DAY_START_MINUTES)).toBe("2024-06-14");
	});

	it("uses same calendar date at and after cutoff (UTC)", () => {
		const atCutoff = Date.UTC(2024, 5, 15, 4, 0, 0, 0);
		expect(getOrderServiceDateKey(atCutoff, "UTC", DEFAULT_ORDER_DAY_START_MINUTES)).toBe("2024-06-15");

		const after = Date.UTC(2024, 5, 15, 10, 0, 0, 0);
		expect(getOrderServiceDateKey(after, "UTC", DEFAULT_ORDER_DAY_START_MINUTES)).toBe("2024-06-15");
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
