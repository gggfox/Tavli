import {
	parseHm,
	resolveRestaurantTimezone,
	SCHEDULE_MS_PER_DAY,
	startOfDayMs,
	utcMsToHmInTimezone,
	utcMsToYmdInTimezone,
	ymdHmToUtcMs,
} from "@/global/utils/timezone";

const SNAP_MINUTES = 15;
const MS_PER_MINUTE = 60_000;

export type TimelineDayPhase = "past" | "today" | "future";

/*
 * The blockedRatio is the ratio of the total minutes to the blocked minutes.
 * The nowRatio is the ratio of the total minutes to the now minutes.
 */
export interface TimelineMarkers {
	readonly blockedRatio: number | null;
	readonly nowRatio: number | null;
}

/** Map horizontal position (0–1) in a timeline row to a snapped minute offset from openHour. */
export function pointerRatioToSnappedMinute(ratio: number, totalMinutes: number): number {
	const minuteOffset = Math.round(ratio * totalMinutes);
	return Math.round(minuteOffset / SNAP_MINUTES) * SNAP_MINUTES;
}

/** Round minute offset up to the next 15-minute snap. */
export function snapMinuteUp(minuteOffset: number): number {
	return Math.ceil(minuteOffset / SNAP_MINUTES) * SNAP_MINUTES;
}

/** Convert snapped minute offset + service day into a reservation `startsAt` timestamp. */
export function minuteOffsetToStartsAt(
	selectedDay: string,
	openHour: number,
	minuteOffset: number,
	timezone: string
): number {
	const minutesFromMidnight = openHour * 60 + minuteOffset;
	return ymdHmToUtcMs(selectedDay, minutesFromMidnight, timezone);
}

/** Map pointer X within a row container to snapped `startsAt`. */
export function pointerXToStartsAt(
	clientX: number,
	containerRect: DOMRect,
	openHour: number,
	totalMinutes: number,
	selectedDay: string,
	timezone: string
): number {
	const ratio = (clientX - containerRect.left) / containerRect.width;
	const snapped = pointerRatioToSnappedMinute(ratio, totalMinutes);
	return minuteOffsetToStartsAt(selectedDay, openHour, snapped, timezone);
}

export function getTimelineDayPhase(selectedDay: string, todayYmd: string): TimelineDayPhase {
	if (selectedDay < todayYmd) return "past";
	if (selectedDay > todayYmd) return "future";
	return "today";
}

/** Minutes elapsed from timeline open on `selectedDay` to `timestampMs` in restaurant TZ. */
export function minuteOffsetFromOpen(
	timestampMs: number,
	selectedDay: string,
	openHour: number,
	timezone: string
): number {
	const timelineStart = ymdHmToUtcMs(selectedDay, openHour * 60, timezone);
	return (timestampMs - timelineStart) / MS_PER_MINUTE;
}

/** `[startOfDay, startOfNextDay)` for a restaurant-local calendar day. */
export function restaurantDayBounds(
	ymd: string,
	timezone: string | undefined
): { fromMs: number; toMs: number } {
	const tz = resolveRestaurantTimezone(timezone);
	const fromMs = startOfDayMs(ymd, tz);
	return { fromMs, toMs: fromMs + SCHEDULE_MS_PER_DAY };
}

/** Minutes from timeline open for a UTC instant on the selected service day. */
export function utcMsToMinutesFromOpen(
	utcMs: number,
	selectedDay: string,
	openHour: number,
	timezone: string
): number {
	const dayYmd = utcMsToYmdInTimezone(utcMs, timezone);
	if (dayYmd !== selectedDay) {
		const hm = utcMsToHmInTimezone(utcMs, timezone);
		const minutes = parseHm(hm) ?? 0;
		if (dayYmd < selectedDay) {
			return minutes - openHour * 60;
		}
		return minutes - openHour * 60 + 24 * 60;
	}
	const hm = utcMsToHmInTimezone(utcMs, timezone);
	const minutes = parseHm(hm) ?? 0;
	return minutes - openHour * 60;
}

export function getTimelineMarkers(params: {
	readonly selectedDay: string;
	readonly openHour: number;
	readonly totalMinutes: number;
	readonly nowMs: number;
	readonly minAdvanceMinutes: number;
	readonly timezone: string;
	readonly todayYmd?: string;
}): TimelineMarkers {
	const todayYmd = params.todayYmd ?? utcMsToYmdInTimezone(params.nowMs, params.timezone);
	const phase = getTimelineDayPhase(params.selectedDay, todayYmd);

	if (phase === "future") {
		return { blockedRatio: null, nowRatio: null };
	}

	if (phase === "past") {
		return { blockedRatio: 1, nowRatio: null };
	}

	const horizonMs = params.nowMs + params.minAdvanceMinutes * MS_PER_MINUTE;
	const blockedOffset = minuteOffsetFromOpen(
		horizonMs,
		params.selectedDay,
		params.openHour,
		params.timezone
	);
	const blockedRatio = Math.min(1, Math.max(0, blockedOffset / params.totalMinutes));

	const nowOffset = minuteOffsetFromOpen(
		params.nowMs,
		params.selectedDay,
		params.openHour,
		params.timezone
	);
	const nowRatio = Math.min(1, Math.max(0, nowOffset / params.totalMinutes));
	return { blockedRatio, nowRatio };
}

/** Bump `startsAt` to the earliest bookable 15-min snap on today (now + minAdvance). */
export function clampStartsAtToHorizon(
	startsAtMs: number,
	selectedDay: string,
	openHour: number,
	minAdvanceMinutes: number,
	nowMs: number,
	timezone: string,
	todayYmd?: string
): number {
	const today = todayYmd ?? utcMsToYmdInTimezone(nowMs, timezone);
	if (getTimelineDayPhase(selectedDay, today) !== "today") {
		return startsAtMs;
	}

	const horizonMs = nowMs + minAdvanceMinutes * MS_PER_MINUTE;
	const horizonOffset = minuteOffsetFromOpen(horizonMs, selectedDay, openHour, timezone);
	const earliestStartsAt = minuteOffsetToStartsAt(
		selectedDay,
		openHour,
		snapMinuteUp(horizonOffset),
		timezone
	);

	return Math.max(startsAtMs, earliestStartsAt);
}

const DEFAULT_NOW_SCROLL_MARGIN = 0.1;

/**
 * Horizontal scroll offset so the now line sits near the right edge of the
 * first visible hour cell (≈90% through that column).
 */
export function computeTimelineScrollToNow(params: {
	readonly nowRatio: number | null;
	readonly timelineWidth: number;
	readonly hourColumnWidth: number;
	readonly scrollWidth: number;
	readonly clientWidth: number;
	readonly margin?: number;
}): number {
	if (params.nowRatio === null || params.timelineWidth <= 0 || params.hourColumnWidth <= 0) {
		return 0;
	}

	const margin = params.margin ?? DEFAULT_NOW_SCROLL_MARGIN;
	const maxScroll = Math.max(0, params.scrollWidth - params.clientWidth);
	const raw = params.nowRatio * params.timelineWidth - params.hourColumnWidth * (1 - margin);

	return Math.min(maxScroll, Math.max(0, raw));
}
