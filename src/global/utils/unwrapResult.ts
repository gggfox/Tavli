import type { CustomErrorObject } from "convex/_shared/errors";
import { fromErrorObject } from "convex/_shared/errors";

/**
 * Convex result tuple shape: success returns `[value, null]`, error
 * returns `[null, ErrorObject]`. Convex queries that opt into the
 * `_shared/errors` system return this tuple as their resolver value;
 * mutations do too.
 */
export type ConvexResult<T> = readonly [T, null] | readonly [null, CustomErrorObject];

/** Extracts the success-branch value type out of a Convex result tuple. */
export type UnwrappedValue<T> = T extends readonly [infer V, null] ? V : never;

/**
 * Unwraps a Convex result tuple. Returns the value on success or throws
 * the corresponding error on failure.
 *
 * Designed to compose with React Query's `select` option for queries
 * (`useQuery({ ..., select: unwrapResult })` — Convex errors become
 * `query.error`) and with `mutateAsync` for mutations
 * (`unwrapResult(await mutation.mutateAsync(...))`).
 *
 * The strict overload is what callers normally infer when they have a
 * typed tuple in hand. The permissive `unknown` overload exists because
 * `convexQuery`'s data type can be wider than the strict tuple shape
 * after TS resolves the discriminated union, and a `select` callback
 * has to accept that widened input. Both overloads run the same
 * runtime check.
 */
export function unwrapResult<T>(result: ConvexResult<T>): T;
export function unwrapResult<T = unknown>(result: unknown): T;
export function unwrapResult<T>(result: unknown): T {
	if (!Array.isArray(result) || result.length !== 2) {
		throw new Error("unwrapResult: expected a Convex tuple of length 2");
	}
	const [value, error] = result as unknown as ConvexResult<T>;
	if (error) {
		throw fromErrorObject(error);
	}
	return value as T;
}
