import { AdminStaffKeys } from "@/global/i18n";
import { describe, expect, it } from "vitest";
import {
	groupShiftsByMemberAndDay,
	resolveShiftWindow,
	shiftEndDayOffset,
	templateEnd,
	validateOneOffShift,
} from "./shiftWindow";
import { utcMsToHmInTimezone, utcMsToYmdInTimezone, ymdHmToUtcMs } from "./timezone";

const HOUR_MS = 60 * 60 * 1000;
const MTY = "America/Monterrey";
const NYC = "America/New_York";

describe("resolveShiftWindow", () => {
	it("keeps a same-day shift on its ymd", () => {
		const w = resolveShiftWindow("2026-09-28", 11 * 60, 19 * 60, MTY);
		expect(w).not.toBeNull();
		expect(w?.endsNextDay).toBe(false);
		expect(w!.endsAt - w!.startsAt).toBe(8 * HOUR_MS);
		expect(utcMsToYmdInTimezone(w!.endsAt, MTY)).toBe("2026-09-28");
	});

	it("rolls an end before the start onto the next day (18:00–02:00)", () => {
		const w = resolveShiftWindow("2026-09-28", 18 * 60, 2 * 60, MTY);
		expect(w?.endsNextDay).toBe(true);
		expect(w!.endsAt - w!.startsAt).toBe(8 * HOUR_MS);
		expect(utcMsToYmdInTimezone(w!.startsAt, MTY)).toBe("2026-09-28");
		expect(utcMsToYmdInTimezone(w!.endsAt, MTY)).toBe("2026-09-29");
		expect(utcMsToHmInTimezone(w!.endsAt, MTY)).toBe("02:00");
	});

	it("rolls a Sunday-night shift into Monday", () => {
		const w = resolveShiftWindow("2026-10-04", 22 * 60, 3 * 60, MTY);
		expect(utcMsToYmdInTimezone(w!.endsAt, MTY)).toBe("2026-10-05");
	});

	it("rejects a zero-length shift", () => {
		expect(resolveShiftWindow("2026-09-28", 9 * 60, 9 * 60, MTY)).toBeNull();
	});

	it("lands on the typed wall-clock end across a spring-forward night (NY, 2026-03-08)", () => {
		// 22:00 EST → 06:00 EDT: the 02:00 hour doesn't exist, so it is 7h long.
		const w = resolveShiftWindow("2026-03-07", 22 * 60, 6 * 60, NYC);
		expect(w!.endsAt - w!.startsAt).toBe(7 * HOUR_MS);
		expect(utcMsToYmdInTimezone(w!.endsAt, NYC)).toBe("2026-03-08");
		expect(utcMsToHmInTimezone(w!.endsAt, NYC)).toBe("06:00");
	});

	it("lands on the typed wall-clock end across a fall-back night (NY, 2026-11-01)", () => {
		// 22:00 EDT → 06:00 EST: the 01:00 hour repeats, so it is 9h long.
		const w = resolveShiftWindow("2026-10-31", 22 * 60, 6 * 60, NYC);
		expect(w!.endsAt - w!.startsAt).toBe(9 * HOUR_MS);
		expect(utcMsToHmInTimezone(w!.endsAt, NYC)).toBe("06:00");
	});
});

describe("validateOneOffShift", () => {
	const base = { memberId: "m1", ymd: "2026-09-28", startMin: 18 * 60, endMin: 2 * 60 };

	it("requires a member", () => {
		expect(validateOneOffShift({ ...base, memberId: "" }, MTY)).toEqual({
			ok: false,
			errorKey: AdminStaffKeys.SCHEDULE_DRAWER_ERROR_NO_MEMBER,
		});
	});

	it("rejects start === end with the zero-length message", () => {
		expect(validateOneOffShift({ ...base, endMin: base.startMin }, MTY)).toEqual({
			ok: false,
			errorKey: AdminStaffKeys.SCHEDULE_DRAWER_ERROR_ZERO_LENGTH,
		});
	});

	it("accepts an overnight shift and returns its window", () => {
		const result = validateOneOffShift(base, MTY);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.window.endsNextDay).toBe(true);
		expect(result.window.startsAt).toBe(ymdHmToUtcMs("2026-09-28", 18 * 60, MTY));
		expect(result.window.endsAt).toBe(ymdHmToUtcMs("2026-09-29", 2 * 60, MTY));
	});

	it("accepts a same-day shift", () => {
		const result = validateOneOffShift({ ...base, startMin: 9 * 60, endMin: 17 * 60 }, MTY);
		expect(result.ok && result.window.endsNextDay).toBe(false);
	});
});

describe("templateEnd", () => {
	it("reports a same-day end", () => {
		expect(templateEnd(11 * 60, 8 * 60)).toEqual({ endMin: 19 * 60, dayOffset: 0 });
	});

	it("wraps past midnight", () => {
		expect(templateEnd(18 * 60, 8 * 60)).toEqual({ endMin: 2 * 60, dayOffset: 1 });
	});
});

describe("shiftEndDayOffset", () => {
	it("is 0 for a same-day shift and 1 for an overnight one", () => {
		const start = ymdHmToUtcMs("2026-09-28", 18 * 60, MTY);
		expect(shiftEndDayOffset(start, start + 4 * HOUR_MS, MTY)).toBe(0);
		expect(shiftEndDayOffset(start, start + 8 * HOUR_MS, MTY)).toBe(1);
	});

	it("treats an end at exactly midnight as the same day", () => {
		const start = ymdHmToUtcMs("2026-09-28", 18 * 60, MTY);
		const midnight = ymdHmToUtcMs("2026-09-29", 0, MTY);
		expect(shiftEndDayOffset(start, midnight, MTY)).toBe(0);
	});
});

describe("groupShiftsByMemberAndDay", () => {
	it("files a Sunday-night overnight shift under Sunday, sorted by start", () => {
		const sundayLate = {
			memberId: "m1",
			startsAt: ymdHmToUtcMs("2026-10-04", 22 * 60, MTY),
		};
		const sundayEarly = {
			memberId: "m1",
			startsAt: ymdHmToUtcMs("2026-10-04", 10 * 60, MTY),
		};
		const map = groupShiftsByMemberAndDay([sundayLate, sundayEarly], MTY);
		expect(map.get("m1|2026-10-04")).toEqual([sundayEarly, sundayLate]);
		expect(map.has("m1|2026-10-05")).toBe(false);
	});
});
