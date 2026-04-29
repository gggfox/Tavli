/**
 * Translation keys for relative-time display ("just now", "5 min ago", ...).
 * Consumed by `getRelativeTime` in `src/global/utils/relativeTime.ts`, which
 * returns a key + interpolation values; the calling component resolves them
 * with `t(key, vars)`.
 */
export const TimeKeys = {
	JUST_NOW: "time.relative.justNow",
	MIN_AGO: "time.relative.minAgo",
	HOUR_AGO: "time.relative.hourAgo",
	DAY_AGO: "time.relative.dayAgo",
} as const;

export type TimeKey = (typeof TimeKeys)[keyof typeof TimeKeys];
