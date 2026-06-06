import { describe, expect, it } from "vitest";
import {
	clampStartsAtToHorizon,
	getTimelineDayPhase,
	getTimelineMarkers,
	minuteOffsetToStartsAt,
	pointerRatioToSnappedMinute,
	snapMinuteUp,
} from "./timelineCoordinates";

describe("timelineCoordinates", () => {
	it("snaps to 15-minute increments", () => {
		expect(pointerRatioToSnappedMinute(0.1, 780)).toBe(75);
		expect(pointerRatioToSnappedMinute(0.5, 780)).toBe(390);
	});

	it("builds startsAt from day + open hour + offset", () => {
		const startsAt = minuteOffsetToStartsAt("2026-05-30", 10, 240);
		const d = new Date(startsAt);
		expect(d.getFullYear()).toBe(2026);
		expect(d.getMonth()).toBe(4);
		expect(d.getDate()).toBe(30);
		expect(d.getHours()).toBe(14);
		expect(d.getMinutes()).toBe(0);
	});

	it("snapMinuteUp rounds up to 15-minute boundary", () => {
		expect(snapMinuteUp(240)).toBe(240);
		expect(snapMinuteUp(241)).toBe(255);
		expect(snapMinuteUp(277)).toBe(285);
	});

	describe("getTimelineDayPhase", () => {
		it("classifies past, today, and future days", () => {
			expect(getTimelineDayPhase("2026-05-29", "2026-05-30")).toBe("past");
			expect(getTimelineDayPhase("2026-05-30", "2026-05-30")).toBe("today");
			expect(getTimelineDayPhase("2026-05-31", "2026-05-30")).toBe("future");
		});
	});

	describe("getTimelineMarkers", () => {
		const openHour = 10;
		const totalMinutes = 13 * 60;

		it("returns full stripe on past days", () => {
			expect(
				getTimelineMarkers({
					selectedDay: "2026-05-29",
					openHour,
					totalMinutes,
					nowMs: Date.UTC(2026, 4, 30, 14, 7),
					minAdvanceMinutes: 30,
					todayYmd: "2026-05-30",
				})
			).toEqual({ blockedRatio: 1, nowRatio: null });
		});

		it("returns null markers on future days", () => {
			expect(
				getTimelineMarkers({
					selectedDay: "2026-05-31",
					openHour,
					totalMinutes,
					nowMs: Date.UTC(2026, 4, 30, 14, 7),
					minAdvanceMinutes: 30,
					todayYmd: "2026-05-30",
				})
			).toEqual({ blockedRatio: null, nowRatio: null });
		});

		it("computes blocked and now ratios for today", () => {
			const day = "2026-05-30";
			const now = minuteOffsetToStartsAt(day, openHour, 247);
			const markers = getTimelineMarkers({
				selectedDay: day,
				openHour,
				totalMinutes,
				nowMs: now,
				minAdvanceMinutes: 30,
				todayYmd: day,
			});

			expect(markers.nowRatio).toBeCloseTo(247 / totalMinutes, 5);
			expect(markers.blockedRatio).toBeCloseTo(277 / totalMinutes, 5);
		});
	});

	describe("clampStartsAtToHorizon", () => {
		const day = "2026-05-30";
		const openHour = 10;

		it("returns unchanged on non-today days", () => {
			const startsAt = minuteOffsetToStartsAt("2026-05-31", openHour, 0);
			expect(
				clampStartsAtToHorizon(startsAt, "2026-05-31", openHour, 30, Date.now(), "2026-05-30")
			).toBe(startsAt);
		});

		it("bumps past times to earliest horizon snap", () => {
			const nowMs = minuteOffsetToStartsAt(day, openHour, 247);
			const tooEarly = minuteOffsetToStartsAt(day, openHour, 240);
			const clamped = clampStartsAtToHorizon(tooEarly, day, openHour, 30, nowMs, day);
			expect(clamped).toBe(minuteOffsetToStartsAt(day, openHour, 285));
		});

		it("leaves future times unchanged", () => {
			const nowMs = minuteOffsetToStartsAt(day, openHour, 247);
			const future = minuteOffsetToStartsAt(day, openHour, 360);
			expect(clampStartsAtToHorizon(future, day, openHour, 30, nowMs, day)).toBe(future);
		});
	});
});
