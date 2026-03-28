import type { CustomErrorObject } from "convex/_shared/errors";
import { fromErrorObject } from "convex/_shared/errors";

/**
 * Unwraps a Convex mutation result tuple `[T, null] | [null, ErrorObject]`.
 * Returns the value on success or throws on error, making it compatible
 * with React Query's error handling (mutateAsync / onError).
 */
export function unwrapResult<T>(result: [T, null] | [null, CustomErrorObject]): T {
	const [value, error] = result;
	if (error) {
		throw fromErrorObject(error);
	}
	return value;
}

/**
 * Safely extracts data and error from a Convex query result tuple.
 * Unlike `unwrapResult` (which throws), this returns both values for
 * non-throwing consumption in components and hooks.
 */
export function unwrapQuery<T>(
	result: readonly [T, null] | readonly [null, CustomErrorObject] | readonly unknown[] | undefined
): { data: T | null; error: CustomErrorObject | null } {
	if (!result || !Array.isArray(result)) return { data: null, error: null };
	return { data: result[0] as T | null, error: result[1] as CustomErrorObject | null };
}
