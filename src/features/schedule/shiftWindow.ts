/**
 * Pure helpers for turning restaurant-local shift inputs into UTC windows and
 * back into grid-friendly facts.
 *
 * A one-off shift is entered as `(ymd, startMin, endMin)` in the restaurant's
 * timezone. An end before the start means the shift crosses midnight (a bar
 * close at 02:00 after an 18:00 start), so the end resolves on the next
 * calendar day in that timezone — resolved per day, not `+ 24h`, so a DST
 * switch overnight still lands on the wall-clock time the manager typed. An
 * end equal to the start is a zero-length shift and is rejected.
 *
 * Every shift is displayed in the cell of the day it *starts* on; the chip
 * then marks how many calendar days later it ends ("+1").
 */
import { AdminStaffKeys } from "@/global/i18n";
import {
	addDaysToYmd,
	utcMsToYmdInTimezone,
	ymdDayDiff,
	ymdHmToUtcMs,
} from "@/global/utils/timezone";

const MINUTES_PER_DAY = 24 * 60;

export interface ShiftWindow {
	readonly startsAt: number;
	readonly endsAt: number;
	/** True when the end resolved on the calendar day after `ymd`. */
	readonly endsNextDay: boolean;
}

/** `endMin` before `startMin` means the shift ends the next day. */
export function endsNextDay(startMin: number, endMin: number): boolean {
	return endMin < startMin;
}

/**
 * Resolve `(ymd, startMin, endMin)` in `timezone` to a UTC window. Returns
 * `null` for a zero-length shift (start === end) or when a DST gap collapses
 * the window to nothing.
 */
export function resolveShiftWindow(
	ymd: string,
	startMin: number,
	endMin: number,
	timezone: string
): ShiftWindow | null {
	if (startMin === endMin) return null;
	const overnight = endsNextDay(startMin, endMin);
	const startsAt = ymdHmToUtcMs(ymd, startMin, timezone);
	const endsAt = ymdHmToUtcMs(overnight ? addDaysToYmd(ymd, 1) : ymd, endMin, timezone);
	if (endsAt <= startsAt) return null;
	return { startsAt, endsAt, endsNextDay: overnight };
}

export interface OneOffShiftInput {
	readonly memberId: string;
	readonly ymd: string;
	readonly startMin: number;
	readonly endMin: number;
}

export type OneOffShiftValidation =
	| { readonly ok: true; readonly window: ShiftWindow }
	| { readonly ok: false; readonly errorKey: string };

/**
 * Client-side validation for the one-off tab of `ShiftDrawer`. Returns an
 * `AdminStaffKeys` i18n key on failure so the drawer renders it via `t()`.
 */
export function validateOneOffShift(
	input: OneOffShiftInput,
	timezone: string
): OneOffShiftValidation {
	if (!input.memberId) {
		return { ok: false, errorKey: AdminStaffKeys.SCHEDULE_DRAWER_ERROR_NO_MEMBER };
	}
	if (input.startMin === input.endMin) {
		return { ok: false, errorKey: AdminStaffKeys.SCHEDULE_DRAWER_ERROR_ZERO_LENGTH };
	}
	const window = resolveShiftWindow(input.ymd, input.startMin, input.endMin, timezone);
	if (!window) return { ok: false, errorKey: AdminStaffKeys.SCHEDULE_DRAWER_ERROR_TIME };
	return { ok: true, window };
}

/**
 * Wall-clock end of a weekly template (`startMin + durationMin`), for the
 * drawer hint. `dayOffset` is how many days after the start day it ends.
 */
export function templateEnd(
	startMin: number,
	durationMin: number
): { readonly endMin: number; readonly dayOffset: number } {
	const total = startMin + durationMin;
	return { endMin: total % MINUTES_PER_DAY, dayOffset: Math.floor(total / MINUTES_PER_DAY) };
}

/**
 * Calendar days between the restaurant-local day a shift starts on and the
 * day it ends on. `0` for a same-day shift, `1` for an overnight one. A shift
 * ending exactly at midnight counts as ending on its start day (it never
 * works a minute of the next one).
 */
export function shiftEndDayOffset(startsAt: number, endsAt: number, timezone: string): number {
	const startYmd = utcMsToYmdInTimezone(startsAt, timezone);
	const endYmd = utcMsToYmdInTimezone(Math.max(startsAt, endsAt - 1), timezone);
	return ymdDayDiff(startYmd, endYmd);
}

/**
 * Bucket shifts by `memberId|ymd`, where `ymd` is the restaurant-local day
 * the shift starts on (so a Sunday 22:00–03:00 shift lives in Sunday's cell).
 * Each bucket is sorted by start time.
 */
export function groupShiftsByMemberAndDay<
	T extends { readonly memberId: string; readonly startsAt: number },
>(shifts: readonly T[], timezone: string): Map<string, T[]> {
	const map = new Map<string, T[]>();
	for (const s of shifts) {
		const key = `${s.memberId}|${utcMsToYmdInTimezone(s.startsAt, timezone)}`;
		const list = map.get(key);
		if (list) list.push(s);
		else map.set(key, [s]);
	}
	for (const list of map.values()) {
		list.sort((a, b) => a.startsAt - b.startsAt);
	}
	return map;
}
