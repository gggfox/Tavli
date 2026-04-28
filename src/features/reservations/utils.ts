/**
 * Date-range and formatting helpers for the reservation dashboard.
 *
 * The dashboard exposes named ranges (today, week, month, ...) that all
 * resolve to a `[fromMs, toMs)` window in the user's local timezone. This
 * matches the user's intuition for "this week" and avoids the complexity of
 * per-restaurant timezone math (which is a v2 concern -- v1 trusts the
 * browser timezone for display).
 */

export type ReservationRange =
	| "today"
	| "week"
	| "month"
	| "quarter"
	| "year"
	| "all";

export interface RangeBounds {
	fromMs: number;
	toMs: number;
}

const ALL_FROM_MS = 0;
// 100 years out is "essentially forever" for a reservation system.
const ALL_TO_MS = Date.now() + 100 * 365 * 24 * 60 * 60 * 1000;

function startOfDay(d: Date): Date {
	const out = new Date(d);
	out.setHours(0, 0, 0, 0);
	return out;
}

function startOfWeek(d: Date): Date {
	const out = startOfDay(d);
	const dayOfWeek = out.getDay();
	out.setDate(out.getDate() - dayOfWeek);
	return out;
}

function startOfMonth(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function startOfQuarter(d: Date): Date {
	const quarterMonth = Math.floor(d.getMonth() / 3) * 3;
	return new Date(d.getFullYear(), quarterMonth, 1, 0, 0, 0, 0);
}

function startOfYear(d: Date): Date {
	return new Date(d.getFullYear(), 0, 1, 0, 0, 0, 0);
}

export function rangeBounds(range: ReservationRange, now: Date = new Date()): RangeBounds {
	const start = (() => {
		switch (range) {
			case "today":
				return startOfDay(now);
			case "week":
				return startOfWeek(now);
			case "month":
				return startOfMonth(now);
			case "quarter":
				return startOfQuarter(now);
			case "year":
				return startOfYear(now);
			case "all":
				return new Date(ALL_FROM_MS);
		}
	})();
	const end = (() => {
		switch (range) {
			case "today": {
				const out = new Date(start);
				out.setDate(out.getDate() + 1);
				return out;
			}
			case "week": {
				const out = new Date(start);
				out.setDate(out.getDate() + 7);
				return out;
			}
			case "month": {
				const out = new Date(start);
				out.setMonth(out.getMonth() + 1);
				return out;
			}
			case "quarter": {
				const out = new Date(start);
				out.setMonth(out.getMonth() + 3);
				return out;
			}
			case "year": {
				const out = new Date(start);
				out.setFullYear(out.getFullYear() + 1);
				return out;
			}
			case "all":
				return new Date(ALL_TO_MS);
		}
	})();
	return { fromMs: start.getTime(), toMs: end.getTime() };
}

export const RANGE_LABELS: Record<ReservationRange, string> = {
	today: "Today",
	week: "This week",
	month: "This month",
	quarter: "This quarter",
	year: "This year",
	all: "All time",
};

export const ORDERED_RANGES: ReservationRange[] = [
	"today",
	"week",
	"month",
	"quarter",
	"year",
	"all",
];

/**
 * Format a UTC ms timestamp in the browser's locale. Used everywhere the UI
 * renders reservation times.
 */
export function formatReservationTime(ms: number): string {
	return new Date(ms).toLocaleString(undefined, {
		weekday: "short",
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

export function formatTimeOnly(ms: number): string {
	return new Date(ms).toLocaleTimeString(undefined, {
		hour: "numeric",
		minute: "2-digit",
	});
}

/**
 * Build a `<input type="datetime-local">`-compatible string from a UTC ms.
 * The browser interprets the value as local time when round-tripping.
 */
export function toDateTimeLocalValue(ms: number): string {
	const d = new Date(ms);
	const pad = (n: number) => n.toString().padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromDateTimeLocalValue(value: string): number {
	return new Date(value).getTime();
}
