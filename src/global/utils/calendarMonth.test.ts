import { describe, expect, it } from "vitest";
import {
	addMonths,
	buildMonthGrid,
	getWeekStartsOnJsDay,
	isValidYmd,
	localDateToYmd,
	todayLocalYmd,
	ymdToLocalDate,
} from "./calendarMonth";

describe("isValidYmd", () => {
	it("accepts valid dates", () => {
		expect(isValidYmd("2026-01-01")).toBe(true);
		expect(isValidYmd("2024-02-29")).toBe(true);
	});
	it("rejects invalid calendar days", () => {
		expect(isValidYmd("2023-02-29")).toBe(false);
		expect(isValidYmd("2026-13-01")).toBe(false);
		expect(isValidYmd("2026-00-10")).toBe(false);
	});
	it("rejects malformed strings", () => {
		expect(isValidYmd("26-01-01")).toBe(false);
		expect(isValidYmd("")).toBe(false);
	});
});

describe("ymd round-trip (local)", () => {
	it("round-trips midnight", () => {
		const ymd = "2026-05-15";
		expect(localDateToYmd(ymdToLocalDate(ymd))).toBe(ymd);
	});
});

describe("buildMonthGrid", () => {
	it("includes 42 cells", () => {
		const grid = buildMonthGrid(2026, 4, 1); // May 2026, week starts Monday
		expect(grid).toHaveLength(42);
	});

	it("marks inCurrentMonth for May 2026 when viewing May", () => {
		const grid = buildMonthGrid(2026, 4, 1);
		const mayDays = grid.filter((c) => c.kind === "day" && c.inCurrentMonth);
		expect(mayDays).toHaveLength(31);
		expect(mayDays[0]?.kind === "day" && mayDays[0].dayOfMonth).toBe(1);
	});

	it("first cell is April when May 1 2026 is Friday and week starts Monday", () => {
		// May 1, 2026 is Friday (getDay 5). Monday start -> grid starts Apr 27
		const grid = buildMonthGrid(2026, 4, 1);
		const first = grid[0];
		expect(first?.kind).toBe("day");
		if (first?.kind === "day") {
			expect(first.inCurrentMonth).toBe(false);
			expect(first.ymd).toBe("2026-04-27");
		}
	});
});

describe("addMonths", () => {
	it("rolls year forward", () => {
		expect(addMonths(2026, 10, 2)).toEqual({ year: 2027, monthIndex: 0 });
	});
	it("rolls year backward", () => {
		expect(addMonths(2026, 0, -1)).toEqual({ year: 2025, monthIndex: 11 });
	});
});

describe("getWeekStartsOnJsDay", () => {
	it("returns a number 0-6", () => {
		const v = getWeekStartsOnJsDay("en-US");
		expect(v).toBeGreaterThanOrEqual(0);
		expect(v).toBeLessThanOrEqual(6);
	});
});

describe("todayLocalYmd", () => {
	it("matches local calendar for a fixed instant", () => {
		const d = new Date(2026, 2, 15, 15, 30, 0, 0);
		expect(todayLocalYmd(d)).toBe("2026-03-15");
	});
});
