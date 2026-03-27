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
