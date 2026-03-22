import type { CustomErrorObject } from "./errors";

/**
 * Return type for synchronous functions that can return either a value or an error.
 * Uses ErrorObject (plain objects) instead of Error instances for Convex compatibility.
 */
export type SyncReturn<T, E extends CustomErrorObject> = [T, null] | [null, E];

/**
 * Return type for asynchronous functions that can return either a value or an error.
 * Uses ErrorObject (plain objects) instead of Error instances for Convex compatibility.
 */
export type AsyncReturn<T, E extends CustomErrorObject> = Promise<SyncReturn<T, E>>;
