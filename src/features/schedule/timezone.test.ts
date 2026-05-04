import { describe, expect, it } from "vitest";
import {
	addDaysToYmd,
	endOfWeekMs,
	formatHm,
	getMondayYmdOfWeek,
	getWeekYmds,
	getZoneOffsetMs,
	parseHm,
	startOfDayMs,
	utcMsToHmInTimezone,
	utcMsToYmdInTimezone,
	ymdHmToUtcMs,
	ymdToDayOfWeekMonStart,
} from "./timezone";

const HOUR_MS = 60 * 60 * 1000;

describe("ymdHmToUtcMs / utcMsToYmdInTimezone", () => {
	it("round-trips a UTC timestamp through `UTC` timezone", () => {
		const ymd = "2026-05-04";
		const ms = ymdHmToUtcMs(ymd, 9 * 60 + 30, "UTC");
		expect(utcMsToYmdInTimezone(ms, "UTC")).toBe(ymd);
		expect(utcMsToHmInTimezone(ms, "UTC")).toBe("09:30");
	});

	it("handles the CDMX timezone correctly (UTC-6, no DST after 2022)", () => {
		const ms = ymdHmToUtcMs("2026-05-04", 9 * 0 + 9 * 60, "America/Mexico_City");
		// 09:00 in CDMX → 15:00 UTC
		const utc = new Date(ms);
		expect(utc.getUTCHours()).toBe(15);
		expect(utc.getUTCMinutes()).toBe(0);
	});

	it("survives a DST spring-forward in a zone that observes it (NYC: 2026-03-08)", () => {
		// In America/New_York, on 2026-03-08 the clock jumps from 02:00 to 03:00.
		// We pick 03:30 local — well past the gap — to verify the timestamp is real.
		const ms = ymdHmToUtcMs("2026-03-08", 3 * 60 + 30, "America/New_York");
		const offsetMs = getZoneOffsetMs("America/New_York", ms);
		// During EDT, offset is UTC-4 → -4 * HOUR_MS
		expect(offsetMs).toBe(-4 * HOUR_MS);
		// Round-trip the local fields
		expect(utcMsToYmdInTimezone(ms, "America/New_York")).toBe("2026-03-08");
		expect(utcMsToHmInTimezone(ms, "America/New_York")).toBe("03:30");
	});

	it("survives a DST fall-back in a zone that observes it (NYC: 2026-11-01)", () => {
		// 01:30 occurs twice on fall-back day. We expect a valid round-trip.
		const ms = ymdHmToUtcMs("2026-11-01", 60 + 30, "America/New_York");
		expect(utcMsToYmdInTimezone(ms, "America/New_York")).toBe("2026-11-01");
		expect(utcMsToHmInTimezone(ms, "America/New_York")).toBe("01:30");
	});

	it("rejects malformed YMD strings", () => {
		expect(() => ymdHmToUtcMs("not-a-date", 0, "UTC")).toThrow(TypeError);
	});
});

describe("formatHm / parseHm", () => {
	it("round-trips minutes ↔ HH:MM", () => {
		expect(formatHm(0)).toBe("00:00");
		expect(formatHm(9 * 60 + 5)).toBe("09:05");
		expect(formatHm(23 * 60 + 59)).toBe("23:59");
		expect(parseHm("09:05")).toBe(9 * 60 + 5);
		expect(parseHm("23:59")).toBe(23 * 60 + 59);
	});

	it("rejects invalid HH:MM input", () => {
		expect(parseHm("24:00")).toBeNull();
		expect(parseHm("13:60")).toBeNull();
		expect(parseHm("9-05")).toBeNull();
		expect(parseHm("foo")).toBeNull();
	});
});

describe("ymdToDayOfWeekMonStart", () => {
	it("returns 0 for Monday", () => {
		// 2026-05-04 is a Monday
		expect(ymdToDayOfWeekMonStart("2026-05-04")).toBe(0);
	});

	it("returns 6 for Sunday", () => {
		expect(ymdToDayOfWeekMonStart("2026-05-10")).toBe(6);
	});
});

describe("addDaysToYmd", () => {
	it("rolls to next month correctly", () => {
		expect(addDaysToYmd("2026-01-31", 1)).toBe("2026-02-01");
	});

	it("handles negative days for backward navigation", () => {
		expect(addDaysToYmd("2026-03-01", -1)).toBe("2026-02-28");
	});

	it("crosses leap year correctly", () => {
		expect(addDaysToYmd("2024-02-28", 1)).toBe("2024-02-29");
	});
});

describe("getMondayYmdOfWeek", () => {
	it("returns Monday of the week containing the anchor (UTC)", () => {
		// 2026-05-07 is a Thursday in UTC
		const anchor = ymdHmToUtcMs("2026-05-07", 12 * 60, "UTC");
		expect(getMondayYmdOfWeek(anchor, "UTC")).toBe("2026-05-04");
	});

	it("returns the same day if the anchor is already a Monday", () => {
		const anchor = ymdHmToUtcMs("2026-05-04", 8 * 60, "UTC");
		expect(getMondayYmdOfWeek(anchor, "UTC")).toBe("2026-05-04");
	});
});

describe("getWeekYmds", () => {
	it("returns 7 consecutive Mon→Sun YMDs", () => {
		expect(getWeekYmds("2026-05-04")).toEqual([
			"2026-05-04",
			"2026-05-05",
			"2026-05-06",
			"2026-05-07",
			"2026-05-08",
			"2026-05-09",
			"2026-05-10",
		]);
	});
});

describe("startOfDayMs / endOfWeekMs", () => {
	it("startOfDayMs aligns with local midnight", () => {
		const ms = startOfDayMs("2026-05-04", "UTC");
		expect(utcMsToHmInTimezone(ms, "UTC")).toBe("00:00");
	});

	it("endOfWeekMs is exactly 7 days after the Monday midnight", () => {
		const monday = startOfDayMs("2026-05-04", "UTC");
		const end = endOfWeekMs("2026-05-04", "UTC");
		expect(end - monday).toBe(7 * 24 * HOUR_MS);
	});
});
