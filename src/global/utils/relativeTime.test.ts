import { TimeKeys } from "@/global/i18n";
import { describe, expect, it } from "vitest";
import { getRelativeTime } from "./relativeTime";

const NOW = 1_700_000_000_000;
const minutesAgo = (n: number) => NOW - n * 60_000;

describe("getRelativeTime", () => {
	it("returns just-now key for sub-minute deltas", () => {
		const result = getRelativeTime(NOW - 30_000, NOW);
		expect(result.key).toBe(TimeKeys.JUST_NOW);
		expect(result.vars).toBeUndefined();
		expect(result.minutes).toBe(0);
	});

	it("returns minutes key with count for < 1 hour", () => {
		const result = getRelativeTime(minutesAgo(7), NOW);
		expect(result.key).toBe(TimeKeys.MIN_AGO);
		expect(result.vars).toEqual({ count: 7 });
		expect(result.minutes).toBe(7);
	});

	it("returns hours key with count for < 1 day", () => {
		const result = getRelativeTime(minutesAgo(125), NOW);
		expect(result.key).toBe(TimeKeys.HOUR_AGO);
		expect(result.vars).toEqual({ count: 2 });
	});

	it("returns days key with count for >= 1 day", () => {
		const result = getRelativeTime(minutesAgo(60 * 24 * 3 + 5), NOW);
		expect(result.key).toBe(TimeKeys.DAY_AGO);
		expect(result.vars).toEqual({ count: 3 });
	});

	it("clamps negative deltas to zero (clock skew)", () => {
		const result = getRelativeTime(NOW + 5_000, NOW);
		expect(result.minutes).toBe(0);
		expect(result.key).toBe(TimeKeys.JUST_NOW);
	});

	it("uses fresh urgency under 10 minutes", () => {
		const result = getRelativeTime(minutesAgo(5), NOW);
		expect(result.urgency).toBe("fresh");
	});

	it("uses stale urgency from 10 to 30 minutes", () => {
		const result = getRelativeTime(minutesAgo(20), NOW);
		expect(result.urgency).toBe("stale");
	});

	it("uses cold urgency past 30 minutes", () => {
		const result = getRelativeTime(minutesAgo(45), NOW);
		expect(result.urgency).toBe("cold");
	});
});
