/**
 * Pure helpers for local calendar month grids and YYYY-MM-DD strings.
 * No I/O; safe for tests and Convex-free UI.
 */

export const YMD_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function isValidYmd(s: string): boolean {
	if (!YMD_RE.test(s)) return false;
	const [y, m, d] = s.split("-").map(Number);
	const dt = new Date(y, m - 1, d);
	return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/** Local calendar date at midnight. */
export function ymdToLocalDate(ymd: string): Date {
	const [y, m, d] = ymd.split("-").map(Number);
	return new Date(y, m - 1, d, 0, 0, 0, 0);
}

export function localDateToYmd(d: Date): string {
	const pad = (n: number) => n.toString().padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayLocalYmd(now: Date = new Date()): string {
	const s = new Date(now);
	s.setHours(0, 0, 0, 0);
	return localDateToYmd(s);
}

/**
 * JS `Date#getDay()` value for the first day of the week (0 Sun .. 6 Sat).
 * Uses `Intl.Locale#getWeekInfo` when available; otherwise Monday (1).
 */
type LocaleWithWeekInfo = Intl.Locale & {
	getWeekInfo?: () => { firstDay?: number };
};

export function getWeekStartsOnJsDay(localeTag: string): number {
	try {
		const loc = new Intl.Locale(localeTag) as LocaleWithWeekInfo;
		const wi = loc.getWeekInfo?.();
		if (wi?.firstDay !== undefined) {
			// ECMA-402: 1 = Monday .. 7 = Sunday
			const fd = wi.firstDay;
			return fd === 7 ? 0 : fd;
		}
	} catch {
		// invalid locale tag
	}
	return 1; // Monday
}

export type MonthGridCell = {
	readonly kind: "day";
	readonly ymd: string;
	readonly dayOfMonth: number;
	readonly inCurrentMonth: boolean;
};

/**
 * Fixed 6×7 grid (42 cells) for a visible month. Leading/trailing cells outside
 * the month still carry a `ymd` so navigation feels continuous.
 */
export function buildMonthGrid(
	visibleYear: number,
	visibleMonthIndex: number,
	weekStartsOnJsDay: number
): readonly MonthGridCell[] {
	const firstOfMonth = new Date(visibleYear, visibleMonthIndex, 1, 0, 0, 0, 0);
	const lead =
		(firstOfMonth.getDay() - weekStartsOnJsDay + 7) % 7;

	const cells: MonthGridCell[] = [];
	const cursor = new Date(visibleYear, visibleMonthIndex, 1 - lead, 0, 0, 0, 0);

	for (let i = 0; i < 42; i++) {
		const ymd = localDateToYmd(cursor);
		const inCurrentMonth = cursor.getMonth() === visibleMonthIndex;
		cells.push({
			kind: "day",
			ymd,
			dayOfMonth: cursor.getDate(),
			inCurrentMonth,
		});
		cursor.setDate(cursor.getDate() + 1);
	}

	return cells;
}

export function addMonths(year: number, monthIndex: number, delta: number): { year: number; monthIndex: number } {
	const d = new Date(year, monthIndex + delta, 1);
	return { year: d.getFullYear(), monthIndex: d.getMonth() };
}
