/**
 * Timezone-aware conversion helpers used by the schedule UI.
 *
 * The week grid lays out shifts in the *restaurant's* timezone (so a Monday
 * 09:00 shift in CDMX is on the Monday column even when the manager is
 * looking at the page from elsewhere). Convex stores `startsAt` / `endsAt`
 * as UTC ms, so this module bridges:
 *
 *   - `(YYYY-MM-DD, HH:MM)` in `timezone` ↔ UTC ms
 *   - week-anchored navigation (Monday-start, restaurant-local)
 *
 * The algorithm mirrors `convex/_util/timezone.ts` so frontend rendering
 * stays consistent with backend materialization.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

export function ymdHmToUtcMs(
	ymd: string,
	minutesFromMidnight: number,
	timezone: string
): number {
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

/**
 * Find the YYYY-MM-DD of the Monday that begins the week containing
 * `anchorMs` in `timezone`. Used by the week-grid to anchor a Monday-start
 * 7-column layout.
 */
export function getMondayYmdOfWeek(anchorMs: number, timezone: string): string {
	const ymd = utcMsToYmdInTimezone(anchorMs, timezone);
	const dow = ymdToDayOfWeekMonStart(ymd);
	return addDaysToYmd(ymd, -dow);
}

/** Return the UTC ms of `00:00` local time on `ymd` in `timezone`. */
export function startOfDayMs(ymd: string, timezone: string): number {
	return ymdHmToUtcMs(ymd, 0, timezone);
}

/** Return the UTC ms 7 calendar days after the local midnight of `mondayYmd`. */
export function endOfWeekMs(mondayYmd: string, timezone: string): number {
	const sunday = addDaysToYmd(mondayYmd, 6);
	return startOfDayMs(sunday, timezone) + MS_PER_DAY;
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
