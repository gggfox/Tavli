import type { CustomErrorObject } from "./errors";

export type SyncReturn<T, E extends CustomErrorObject> = [T, null] | [null, E];

export type AsyncReturn<T, E extends CustomErrorObject> = Promise<SyncReturn<T, E>>;
