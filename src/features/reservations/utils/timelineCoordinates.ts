import { todayLocalYmd, ymdToLocalDate } from "@/global/utils/calendarMonth";

const SNAP_MINUTES = 15;
const MS_PER_MINUTE = 60_000;

export type TimelineDayPhase = "past" | "today" | "future";

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
	minuteOffset: number
): number {
	const clickedHour = Math.floor((openHour * 60 + minuteOffset) / 60);
	const clickedMinute = (openHour * 60 + minuteOffset) % 60;
	const baseDate = ymdToLocalDate(selectedDay);
	baseDate.setHours(clickedHour, clickedMinute, 0, 0);
	return baseDate.getTime();
}

/** Map pointer X within a row container to snapped `startsAt`. */
export function pointerXToStartsAt(
	clientX: number,
	containerRect: DOMRect,
	openHour: number,
	totalMinutes: number,
	selectedDay: string
): number {
	const ratio = (clientX - containerRect.left) / containerRect.width;
	const snapped = pointerRatioToSnappedMinute(ratio, totalMinutes);
	return minuteOffsetToStartsAt(selectedDay, openHour, snapped);
}

export function getTimelineDayPhase(selectedDay: string, todayYmd: string): TimelineDayPhase {
	if (selectedDay < todayYmd) return "past";
	if (selectedDay > todayYmd) return "future";
	return "today";
}

/** Minutes elapsed from timeline open on `selectedDay` to `timestampMs`. */
export function minuteOffsetFromOpen(
	timestampMs: number,
	selectedDay: string,
	openHour: number
): number {
	const timelineStart = ymdToLocalDate(selectedDay);
	timelineStart.setHours(openHour, 0, 0, 0);
	return (timestampMs - timelineStart.getTime()) / MS_PER_MINUTE;
}

export function getTimelineMarkers(params: {
	readonly selectedDay: string;
	readonly openHour: number;
	readonly totalMinutes: number;
	readonly nowMs: number;
	readonly minAdvanceMinutes: number;
	readonly todayYmd?: string;
}): TimelineMarkers {
	const todayYmd = params.todayYmd ?? todayLocalYmd(new Date(params.nowMs));
	const phase = getTimelineDayPhase(params.selectedDay, todayYmd);

	if (phase === "future") {
		return { blockedRatio: null, nowRatio: null };
	}

	if (phase === "past") {
		return { blockedRatio: 1, nowRatio: null };
	}

	const horizonMs = params.nowMs + params.minAdvanceMinutes * MS_PER_MINUTE;
	const blockedOffset = minuteOffsetFromOpen(horizonMs, params.selectedDay, params.openHour);
	const blockedRatio = Math.min(1, Math.max(0, blockedOffset / params.totalMinutes));

	const nowOffset = minuteOffsetFromOpen(params.nowMs, params.selectedDay, params.openHour);
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
	todayYmd?: string
): number {
	const today = todayYmd ?? todayLocalYmd(new Date(nowMs));
	if (getTimelineDayPhase(selectedDay, today) !== "today") {
		return startsAtMs;
	}

	const horizonMs = nowMs + minAdvanceMinutes * MS_PER_MINUTE;
	const horizonOffset = minuteOffsetFromOpen(horizonMs, selectedDay, openHour);
	const earliestStartsAt = minuteOffsetToStartsAt(
		selectedDay,
		openHour,
		snapMinuteUp(horizonOffset)
	);

	return Math.max(startsAtMs, earliestStartsAt);
}
