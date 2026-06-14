import { describe, expect, it } from "vitest";
import { utcMsToYmdInTimezone } from "@/global/utils/timezone";
import {
	clampStartsAtToHorizon,
	computeTimelineScrollToNow,
	getTimelineDayPhase,
	getTimelineMarkers,
	minuteOffsetToStartsAt,
	pointerRatioToSnappedMinute,
	snapMinuteUp,
} from "./timelineCoordinates";

const CDMX = "America/Mexico_City";
const UTC = "UTC";

describe("timelineCoordinates", () => {
	it("snaps to 15-minute increments", () => {
		expect(pointerRatioToSnappedMinute(0.1, 780)).toBe(75);
		expect(pointerRatioToSnappedMinute(0.5, 780)).toBe(390);
	});

	it("builds startsAt from day + open hour + offset in restaurant TZ", () => {
		const startsAt = minuteOffsetToStartsAt("2026-05-30", 10, 240, CDMX);
		expect(utcMsToYmdInTimezone(startsAt, CDMX)).toBe("2026-05-30");
		const hm = new Intl.DateTimeFormat("en-GB", {
			timeZone: CDMX,
			hourCycle: "h23",
			hour: "2-digit",
			minute: "2-digit",
		}).format(new Date(startsAt));
		expect(hm).toBe("14:00");
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
					timezone: UTC,
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
					timezone: UTC,
					todayYmd: "2026-05-30",
				})
			).toEqual({ blockedRatio: null, nowRatio: null });
		});

		it("computes blocked and now ratios for today", () => {
			const day = "2026-05-30";
			const now = minuteOffsetToStartsAt(day, openHour, 247, UTC);
			const markers = getTimelineMarkers({
				selectedDay: day,
				openHour,
				totalMinutes,
				nowMs: now,
				minAdvanceMinutes: 30,
				timezone: UTC,
				todayYmd: day,
			});

			expect(markers.nowRatio).toBeCloseTo(247 / totalMinutes, 5);
			expect(markers.blockedRatio).toBeCloseTo(277 / totalMinutes, 5);
		});

		it("uses restaurant timezone for now line, not device-local interpretation", () => {
			const day = "2026-06-14";
			// 10:30 AM in CDMX on 2026-06-14
			const cdmx1030 = minuteOffsetToStartsAt(day, 10, 30, CDMX);
			const cdmxMarkers = getTimelineMarkers({
				selectedDay: day,
				openHour: 10,
				totalMinutes: 13 * 60,
				nowMs: cdmx1030,
				minAdvanceMinutes: 30,
				timezone: CDMX,
				todayYmd: day,
			});

			// Same UTC instant viewed as UTC "today" would land on a different ratio
			const utcToday = utcMsToYmdInTimezone(cdmx1030, UTC);
			const utcMarkers = getTimelineMarkers({
				selectedDay: utcToday,
				openHour: 10,
				totalMinutes: 13 * 60,
				nowMs: cdmx1030,
				minAdvanceMinutes: 30,
				timezone: UTC,
				todayYmd: utcToday,
			});

			expect(cdmxMarkers.nowRatio).toBeCloseTo(30 / (13 * 60), 5);
			expect(utcMarkers.nowRatio).not.toBeCloseTo(cdmxMarkers.nowRatio ?? 0, 2);
		});
	});

	describe("computeTimelineScrollToNow", () => {
		const timelineWidth = 1040;
		const hourColumnWidth = 80;
		const scrollWidth = 1200;
		const clientWidth = 600;

		it("returns 0 when nowRatio is null", () => {
			expect(
				computeTimelineScrollToNow({
					nowRatio: null,
					timelineWidth,
					hourColumnWidth,
					scrollWidth,
					clientWidth,
				})
			).toBe(0);
		});

		it("returns 0 when now is at the start of the day", () => {
			expect(
				computeTimelineScrollToNow({
					nowRatio: 0,
					timelineWidth,
					hourColumnWidth,
					scrollWidth,
					clientWidth,
				})
			).toBe(0);
		});

		it("positions now near the end of the first visible hour column", () => {
			const nowRatio = 0.5;
			const scrollLeft = computeTimelineScrollToNow({
				nowRatio,
				timelineWidth,
				hourColumnWidth,
				scrollWidth,
				clientWidth,
			});

			expect(scrollLeft).toBeCloseTo(nowRatio * timelineWidth - hourColumnWidth * 0.9, 5);
		});

		it("clamps to max scroll when now is late in the day", () => {
			const scrollLeft = computeTimelineScrollToNow({
				nowRatio: 1,
				timelineWidth,
				hourColumnWidth,
				scrollWidth,
				clientWidth,
			});

			expect(scrollLeft).toBe(scrollWidth - clientWidth);
		});
	});

	describe("clampStartsAtToHorizon", () => {
		const day = "2026-05-30";
		const openHour = 10;

		it("returns unchanged on non-today days", () => {
			const startsAt = minuteOffsetToStartsAt("2026-05-31", openHour, 0, UTC);
			expect(
				clampStartsAtToHorizon(startsAt, "2026-05-31", openHour, 30, Date.now(), UTC, "2026-05-30")
			).toBe(startsAt);
		});

		it("bumps past times to earliest horizon snap", () => {
			const nowMs = minuteOffsetToStartsAt(day, openHour, 247, UTC);
			const tooEarly = minuteOffsetToStartsAt(day, openHour, 240, UTC);
			const clamped = clampStartsAtToHorizon(tooEarly, day, openHour, 30, nowMs, UTC, day);
			expect(clamped).toBe(minuteOffsetToStartsAt(day, openHour, 285, UTC));
		});

		it("leaves future times unchanged", () => {
			const nowMs = minuteOffsetToStartsAt(day, openHour, 247, UTC);
			const future = minuteOffsetToStartsAt(day, openHour, 360, UTC);
			expect(clampStartsAtToHorizon(future, day, openHour, 30, nowMs, UTC, day)).toBe(future);
		});
	});
});
