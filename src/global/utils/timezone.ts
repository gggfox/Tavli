/**
 * Timezone-aware conversion helpers for restaurant-local calendar math.
 *
 * Bridges `(YYYY-MM-DD, minutes-from-midnight)` in a restaurant IANA timezone
 * ↔ UTC ms. The algorithm mirrors `convex/_util/timezone.ts` so frontend
 * rendering stays consistent with backend materialization.
 */

import { DEFAULT_RESTAURANT_TIMEZONE } from "convex/constants";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function isValidIanaTimezone(tz: string): boolean {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(0);
		return true;
	} catch {
		return false;
	}
}

/** Missing or invalid values fall back to {@link DEFAULT_RESTAURANT_TIMEZONE}. */
export function resolveRestaurantTimezone(tz: string | undefined): string {
	const raw = tz?.trim();
	if (raw && isValidIanaTimezone(raw)) return raw;
	return DEFAULT_RESTAURANT_TIMEZONE;
}

export function getZoneOffsetMs(timezone: string, utcMs: number): number {
	const dtf = new Intl.DateTimeFormat("en-US", {
		timeZone: timezone,
		hourCycle: "h23",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
	const parts = dtf.formatToParts(new Date(utcMs));
	const map: Partial<Record<string, number>> = {};
	for (const p of parts) {
		if (p.type === "literal") continue;
		map[p.type] = Number(p.value);
	}
	const localAsUtcMs = Date.UTC(
		map.year ?? 1970,
		(map.month ?? 1) - 1,
		map.day ?? 1,
		map.hour ?? 0,
		map.minute ?? 0,
		map.second ?? 0
	);
	return localAsUtcMs - utcMs;
}

export function ymdHmToUtcMs(ymd: string, minutesFromMidnight: number, timezone: string): number {
	const [y, mo, d] = ymd.split("-").map(Number);
	if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) {
		throw new TypeError(`Invalid YMD string: ${ymd}`);
	}
	const hour = Math.floor(minutesFromMidnight / 60);
	const minute = minutesFromMidnight % 60;
	const guess = Date.UTC(y, mo - 1, d, hour, minute);
	const offset1 = getZoneOffsetMs(timezone, guess);
	const candidate = guess - offset1;
	const offset2 = getZoneOffsetMs(timezone, candidate);
	if (offset1 === offset2) return candidate;
	return guess - offset2;
}

export function utcMsToYmdInTimezone(utcMs: number, timezone: string): string {
	const dtf = new Intl.DateTimeFormat("en-CA", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	});
	return dtf.format(new Date(utcMs));
}

/** Returns "HH:MM" 24-hour string for `utcMs` in `timezone`. */
export function utcMsToHmInTimezone(utcMs: number, timezone: string): string {
	const dtf = new Intl.DateTimeFormat("en-GB", {
		timeZone: timezone,
		hourCycle: "h23",
		hour: "2-digit",
		minute: "2-digit",
	});
	return dtf.format(new Date(utcMs));
}

export function ymdToDayOfWeekMonStart(ymd: string): number {
	const [y, mo, d] = ymd.split("-").map(Number);
	const jsDay = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
	return (jsDay + 6) % 7;
}

export function addDaysToYmd(ymd: string, days: number): string {
	const [y, mo, d] = ymd.split("-").map(Number);
	const t = new Date(Date.UTC(y, mo - 1, d));
	t.setUTCDate(t.getUTCDate() + days);
	const yy = t.getUTCFullYear();
	const mm = String(t.getUTCMonth() + 1).padStart(2, "0");
	const dd = String(t.getUTCDate()).padStart(2, "0");
	return `${yy}-${mm}-${dd}`;
}

export function formatHm(minutesFromMidnight: number): string {
	const h = Math.floor(minutesFromMidnight / 60);
	const m = minutesFromMidnight % 60;
	return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function parseHm(hm: string): number | null {
	const match = /^(\d{1,2}):(\d{2})$/.exec(hm);
	if (!match) return null;
	const h = Number(match[1]);
	const m = Number(match[2]);
	if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
	if (h < 0 || h > 23 || m < 0 || m > 59) return null;
	return h * 60 + m;
}

export function getMondayYmdOfWeek(anchorMs: number, timezone: string): string {
	const ymd = utcMsToYmdInTimezone(anchorMs, timezone);
	const dow = ymdToDayOfWeekMonStart(ymd);
	return addDaysToYmd(ymd, -dow);
}

/** Return the UTC ms of `00:00` local time on `ymd` in `timezone`. */
export function startOfDayMs(ymd: string, timezone: string): number {
	return ymdHmToUtcMs(ymd, 0, timezone);
}

/**
 * Return the UTC ms of the local midnight 7 calendar days after `mondayYmd`
 * (i.e. the following Monday's `00:00`). Resolved per calendar day rather
 * than `+ 24h` so a week containing a DST switch is 167 or 169 hours long,
 * matching the restaurant's wall clock.
 */
export function endOfWeekMs(mondayYmd: string, timezone: string): number {
	return startOfDayMs(addDaysToYmd(mondayYmd, 7), timezone);
}

/**
 * Whole calendar days from `fromYmd` to `toYmd` (negative when `toYmd` is
 * earlier). Pure string-date math — independent of any timezone.
 */
export function ymdDayDiff(fromYmd: string, toYmd: string): number {
	const [fy, fm, fd] = fromYmd.split("-").map(Number);
	const [ty, tm, td] = toYmd.split("-").map(Number);
	return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / MS_PER_DAY);
}

/**
 * Format a `YYYY-MM-DD` calendar date for display (e.g. "Sep 28" / "28 sept").
 *
 * The label always names the day in `ymd`, whatever the browser's timezone:
 * the date is pinned to UTC midnight and formatted in UTC, so a browser at
 * UTC-6 can't roll "2026-09-28" back to the 27th. Use this for day/week
 * labels derived from restaurant-local ymd strings instead of formatting a
 * `Date` in the viewer's zone.
 */
export function formatYmd(
	ymd: string,
	localeTag: string,
	options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }
): string {
	const [y, mo, d] = ymd.split("-").map(Number);
	return new Intl.DateTimeFormat(localeTag, { ...options, timeZone: "UTC" }).format(
		new Date(Date.UTC(y, mo - 1, d))
	);
}

/** Standard 7-day Mon-start week labels, e.g. ["2026-05-04", ..., "2026-05-10"]. */
export function getWeekYmds(mondayYmd: string): string[] {
	const out: string[] = [];
	for (let i = 0; i < 7; i++) {
		out.push(addDaysToYmd(mondayYmd, i));
	}
	return out;
}

export const SCHEDULE_MS_PER_DAY = MS_PER_DAY;
