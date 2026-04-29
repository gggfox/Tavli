import { TimeKeys } from "@/global/i18n";

/**
 * Urgency level for a timestamp. Mapped to color in the UI by the
 * consumer (e.g. `URGENCY_CLASS[urgency]`); the util stays free of
 * presentation concerns so non-React callers can reuse the thresholds.
 */
export type Urgency = "fresh" | "stale" | "cold";

/**
 * Pure descriptor for a relative-time label. The caller resolves the label
 * via `t(key, vars)`; keeping `t` out of this util means non-React callers
 * (server-rendered receipts, tests, etc.) can reuse the urgency thresholds.
 */
export type RelativeTime = {
	/** i18n key to feed into `t()`. One of the `TimeKeys.*` values. */
	key: string;
	/** Interpolation values for `t(key, vars)`. Absent for "just now". */
	vars?: { count: number };
	/** Urgency level. Map to a className in the rendering layer. */
	urgency: Urgency;
	/** Raw minute delta. Useful for non-display logic. */
	minutes: number;
};

const FRESH_THRESHOLD_MINUTES = 10;
const STALE_THRESHOLD_MINUTES = 30;

/**
 * Returns an i18n-ready descriptor for "how long ago was this timestamp?"
 *
 * Buckets:
 * - `< 1 min` -> "just now"
 * - `< 60 min` -> "N min ago"
 * - `< 24 h`  -> "N h ago"
 * - otherwise -> "N d ago"
 *
 * Urgency reflects kitchen freshness, not absolute age:
 * - `fresh`: under 10 minutes
 * - `stale`: 10 to 30 minutes
 * - `cold`: over 30 minutes
 */
export function getRelativeTime(timestamp: number, now: number): RelativeTime {
	const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));

	let key: string;
	let vars: { count: number } | undefined;
	if (minutes < 1) {
		key = TimeKeys.JUST_NOW;
	} else if (minutes < 60) {
		key = TimeKeys.MIN_AGO;
		vars = { count: minutes };
	} else if (minutes < 60 * 24) {
		key = TimeKeys.HOUR_AGO;
		vars = { count: Math.floor(minutes / 60) };
	} else {
		key = TimeKeys.DAY_AGO;
		vars = { count: Math.floor(minutes / (60 * 24)) };
	}

	let urgency: Urgency;
	if (minutes < FRESH_THRESHOLD_MINUTES) urgency = "fresh";
	else if (minutes < STALE_THRESHOLD_MINUTES) urgency = "stale";
	else urgency = "cold";

	return { key, vars, urgency, minutes };
}
