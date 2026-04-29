import { describe, expect, it } from "vitest";
import { ORDERED_RANGES, RANGE_LABEL_KEYS, rangeBounds } from "./utils";

const FIXED_NOW = new Date("2026-04-27T14:30:00");

describe("rangeBounds", () => {
	it("today: covers exactly the day window", () => {
		const { fromMs, toMs } = rangeBounds("today", FIXED_NOW);
		const from = new Date(fromMs);
		const to = new Date(toMs);
		expect(from.getHours()).toBe(0);
		expect(from.getMinutes()).toBe(0);
		expect(from.getDate()).toBe(FIXED_NOW.getDate());
		expect(to.getDate()).toBe(FIXED_NOW.getDate() + 1);
	});

	it("week: starts on the local week's start and is 7 days wide", () => {
		const { fromMs, toMs } = rangeBounds("week", FIXED_NOW);
		expect(toMs - fromMs).toBe(7 * 86_400_000);
	});

	it("month: starts at day 1 of the current month", () => {
		const { fromMs, toMs } = rangeBounds("month", FIXED_NOW);
		expect(new Date(fromMs).getDate()).toBe(1);
		expect(new Date(fromMs).getMonth()).toBe(FIXED_NOW.getMonth());
		expect(new Date(toMs).getMonth()).toBe(FIXED_NOW.getMonth() + 1);
	});

	it("quarter: starts at month 0/3/6/9 of the current year", () => {
		const { fromMs } = rangeBounds("quarter", FIXED_NOW);
		const startMonth = new Date(fromMs).getMonth();
		expect([0, 3, 6, 9]).toContain(startMonth);
	});

	it("year: starts at January 1 of the current year", () => {
		const { fromMs, toMs } = rangeBounds("year", FIXED_NOW);
		expect(new Date(fromMs).getMonth()).toBe(0);
		expect(new Date(fromMs).getDate()).toBe(1);
		expect(new Date(toMs).getFullYear()).toBe(FIXED_NOW.getFullYear() + 1);
	});

	it("all: covers the entire range from epoch start to far future", () => {
		const { fromMs, toMs } = rangeBounds("all", FIXED_NOW);
		expect(fromMs).toBe(0);
		expect(toMs).toBeGreaterThan(FIXED_NOW.getTime());
	});

	it("ORDERED_RANGES has translation keys for every range", () => {
		for (const range of ORDERED_RANGES) {
			expect(RANGE_LABEL_KEYS[range]).toBeTruthy();
		}
	});
});
