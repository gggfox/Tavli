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
