/**
 * Date and timestamp utility functions and constants
 */

/**
 * Minimum valid timestamp (January 1, 2020, 00:00:00 UTC).
 * Used to validate timestamps and filter out invalid or placeholder values.
 * Timestamps before this date are considered invalid for the application.
 */
export const MIN_VALID_TIMESTAMP = 1577836800000;

/**
 * Type guard: Check if a timestamp is valid (not undefined, not 0, and after the minimum valid date).
 * This function narrows the type from `number | undefined` to `number`.
 */
export function isValidTimestamp(timestamp: number | undefined): timestamp is number {
	return timestamp !== undefined && timestamp >= MIN_VALID_TIMESTAMP;
}

export function formatDate(timestamp: number | undefined, locale: string = "en-US"): string {
	if (!isValidTimestamp(timestamp)) {
		return "—";
	}
	return new Intl.DateTimeFormat(locale, {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	}).format(new Date(timestamp));
}

/**
 * Get the best available timestamp for display.
 * Falls back to `fallback` (typically `_creationTime`) if `timestamp` is invalid.
 */
export function getDisplayTimestamp(
	timestamp: number | undefined,
	fallback: number | undefined
): number | undefined {
	if (isValidTimestamp(timestamp)) {
		return timestamp;
	}
	return fallback;
}
