/**
 * Timezone-aware date helpers for shift template materialization.
 *
 * Shifts are stored as UTC milliseconds (`startsAt`, `endsAt`), but recurring
 * templates think in terms of *local* day-of-week + minutes-from-midnight in
 * the restaurant's `timezone`. This module bridges the two: it converts
 * `(ymd, minutesFromMidnight)` in a given IANA timezone to a UTC instant,
 * handles DST transitions, and exposes the small calendar utilities needed by
 * the materialization loop.
 *
 * Algorithm reference:
 *   - `getZoneOffsetMs` formats `utcMs` in the target timezone via
 *     `Intl.DateTimeFormat`, parses the formatted parts back into a UTC
 *     timestamp, and subtracts. The difference is the offset *at that
 *     instant* (which is what DST-aware code needs).
 *   - `ymdHmToUtcMs` does a one-step adjustment plus a recheck after applying
 *     the first offset, which is correct for non-ambiguous local times. For
 *     the once-per-year ambiguous hour during DST fall-back, the algorithm
 *     consistently picks the second occurrence (post-fall-back); this is the
 *     industry convention and matches `date-fns-tz` / `luxon` behavior.
 */

/** UTC millis ↔ minute conversion. */
const MINUTE_MS = 60_000;

/**
 * Returns the offset in milliseconds between local time in `timezone` and UTC
 * at `utcMs`. Positive for zones east of UTC, negative for zones west.
 */
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

/**
 * Convert a local `(YYYY-MM-DD, minutes-from-midnight)` in `timezone` to UTC ms.
 * DST-safe via two-pass offset resolution.
 */
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

/** Convert a UTC instant to its local YYYY-MM-DD in `timezone`. */
export function utcMsToYmdInTimezone(utcMs: number, timezone: string): string {
	const dtf = new Intl.DateTimeFormat("en-CA", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	});
	return dtf.format(new Date(utcMs));
}

/**
 * Day of week using a Monday-start week.
 * Returns 0 (Mon) … 6 (Sun) so it lines up with `shiftTemplates.dayOfWeek`.
 */
export function ymdToDayOfWeekMonStart(ymd: string): number {
	const [y, mo, d] = ymd.split("-").map(Number);
	const jsDay = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
	return (jsDay + 6) % 7;
}

/** Add `days` calendar days to `ymd`, returning a new YYYY-MM-DD string. */
export function addDaysToYmd(ymd: string, days: number): string {
	const [y, mo, d] = ymd.split("-").map(Number);
	const t = new Date(Date.UTC(y, mo - 1, d));
	t.setUTCDate(t.getUTCDate() + days);
	const yy = t.getUTCFullYear();
	const mm = String(t.getUTCMonth() + 1).padStart(2, "0");
	const dd = String(t.getUTCDate()).padStart(2, "0");
	return `${yy}-${mm}-${dd}`;
}

/** Lexicographic comparison works for ISO YYYY-MM-DD; convenience aliases. */
export function maxYmd(a: string, b: string): string {
	return a > b ? a : b;
}
export function minYmd(a: string, b: string): string {
	return a < b ? a : b;
}

/** Convert minutes-from-midnight (0..1439) to "HH:MM" 24-hour string. */
export function formatHm(minutesFromMidnight: number): string {
	const h = Math.floor(minutesFromMidnight / 60);
	const m = minutesFromMidnight % 60;
	return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Parse "HH:MM" into minutes-from-midnight or return null on invalid input. */
export function parseHm(hm: string): number | null {
	const match = /^(\d{1,2}):(\d{2})$/.exec(hm);
	if (!match) return null;
	const h = Number(match[1]);
	const m = Number(match[2]);
	if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
	if (h < 0 || h > 23 || m < 0 || m > 59) return null;
	return h * 60 + m;
}

/** Convenience: ms-per-minute constant export for callers. */
export const MS_PER_MINUTE = MINUTE_MS;
