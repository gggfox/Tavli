/**
 * Resolves a `DashboardRangeKind` (+ optional custom range) into a concrete
 * `[from, to)` window in UTC milliseconds.
 *
 * Boundaries are computed in the user's local timezone (browser default) so
 * "this week" matches what they expect from their wall clock; the server then
 * filters by the resulting UTC ms — close enough for analytics, since
 * restaurant timezones are bucketed inside the per-widget queries.
 */
import type { DashboardCustomRange, DashboardRangeKind, ResolvedRange } from "../types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function startOfLocalDay(t: number): number {
	const d = new Date(t);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

function startOfWeekMonday(t: number): number {
	const d = new Date(startOfLocalDay(t));
	const dayOfWeek = (d.getDay() + 6) % 7;
	d.setDate(d.getDate() - dayOfWeek);
	return d.getTime();
}

function startOfMonth(t: number): number {
	const d = new Date(t);
	d.setHours(0, 0, 0, 0);
	d.setDate(1);
	return d.getTime();
}

function startOfQuarter(t: number): number {
	const d = new Date(t);
	d.setHours(0, 0, 0, 0);
	const month = d.getMonth();
	const quarterStartMonth = month - (month % 3);
	d.setMonth(quarterStartMonth, 1);
	return d.getTime();
}

function startOfYear(t: number): number {
	const d = new Date(t);
	d.setHours(0, 0, 0, 0);
	d.setMonth(0, 1);
	return d.getTime();
}

/**
 * Returns the inclusive-start, exclusive-end window for the given range kind.
 * For `custom`, the supplied range is returned verbatim (callers that want a
 * `to` of "end of day" are expected to construct that themselves).
 */
export function resolveRange(
	kind: DashboardRangeKind,
	customRange: DashboardCustomRange | undefined,
	now: number = Date.now()
): ResolvedRange {
	switch (kind) {
		case "today": {
			const from = startOfLocalDay(now);
			return { from, to: from + MS_PER_DAY };
		}
		case "week": {
			const from = startOfWeekMonday(now);
			return { from, to: from + 7 * MS_PER_DAY };
		}
		case "month": {
			const from = startOfMonth(now);
			const next = new Date(from);
			next.setMonth(next.getMonth() + 1);
			return { from, to: next.getTime() };
		}
		case "quarter": {
			const from = startOfQuarter(now);
			const next = new Date(from);
			next.setMonth(next.getMonth() + 3);
			return { from, to: next.getTime() };
		}
		case "year": {
			const from = startOfYear(now);
			const next = new Date(from);
			next.setFullYear(next.getFullYear() + 1);
			return { from, to: next.getTime() };
		}
		case "custom": {
			if (customRange && customRange.to > customRange.from) {
				return { from: customRange.from, to: customRange.to };
			}
			const from = startOfLocalDay(now);
			return { from, to: from + MS_PER_DAY };
		}
		default: {
			const exhaustive: never = kind;
			throw new Error(`unhandled range kind: ${String(exhaustive)}`);
		}
	}
}
