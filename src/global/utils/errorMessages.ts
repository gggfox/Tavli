/**
 * Error-message utilities for i18n-compatible error handling.
 *
 * The Convex backend throws **stable string codes** (e.g. `ERROR_TABLE_LOCKED`,
 * `ERROR_MANAGER_ROLE_REQUIRED`, `NOT_AUTHORIZED`) rather than prose, so the
 * frontend can map them to localized messages. Those codes reach the client in
 * one of two shapes:
 *
 *   1. A `ConvexError` **data payload** — either the code string directly, or a
 *      `{ name, message }` object (see `CustomErrorObject` in
 *      `convex/_shared/errors.ts`).
 *   2. A plain `Error` whose `message` is the Convex **wrapper** around the
 *      thrown message, e.g.
 *      `"[CONVEX M(reservations:create)] [request-id] Server Error\nUncaught Error: ERROR_BLACKOUT_WINDOW\n    at ..."`.
 *
 * `extractErrorCode` normalizes both into a known code, and `getErrorMessage`
 * turns any caught value into a localized, user-safe string with a generic
 * localized fallback for unknown codes. Raw backend messages must never reach
 * the UI — always route caught errors through `getErrorMessage`.
 */
import {
	BACKEND_ERROR_CODES,
	ERROR_CODE_KEYS,
	ErrorKeys,
	type BackendErrorCode,
} from "@/global/i18n/keys/errors";
import type { TFunction } from "i18next";

/** Exact-match lookup set for candidate strings (payloads, error `name`). */
const KNOWN_CODE_SET: ReadonlySet<string> = new Set(BACKEND_ERROR_CODES);

/**
 * `ERROR_*` codes only, sorted longest-first. Substring matching against the
 * Convex wrapper message uses this list; sorting longest-first stops a shorter
 * code from shadowing a more specific one (e.g. `ERROR_TAB_LOCKED` vs
 * `ERROR_TABLE_LOCKED`). The generic `ERROR_NAMES` values (`NOT_AUTHORIZED`,
 * `CONFLICT`, …) are intentionally excluded here — they are matched only by
 * exact candidate (data payload / error `name`) to avoid false positives from
 * incidental substrings in a stack trace.
 */
const SUBSTRING_MATCH_CODES: readonly BackendErrorCode[] = BACKEND_ERROR_CODES.filter((code) =>
	code.startsWith("ERROR_")
)
	.slice()
	.sort((a, b) => b.length - a.length);

/**
 * Collects the strings that might carry a stable code from an arbitrary caught
 * value, most-reliable first: ConvexError `data` payloads, then the error
 * `name`, then the (possibly wrapped) `message`.
 */
function candidateStrings(error: unknown): string[] {
	const out: string[] = [];
	const push = (value: unknown) => {
		if (typeof value === "string" && value.length > 0) out.push(value);
	};

	if (typeof error === "string") {
		push(error);
		return out;
	}

	if (error && typeof error === "object") {
		const err = error as Record<string, unknown>;

		// 1. ConvexError data payload: a bare code string, or a CustomErrorObject.
		const data = err.data;
		if (typeof data === "string") {
			push(data);
		} else if (data && typeof data === "object") {
			const payload = data as Record<string, unknown>;
			push(payload.name);
			push(payload.code);
			push(payload.message);
		}

		// 2. Error subclass name (e.g. "NOT_FOUND") and any explicit code field.
		push(err.name);
		push(err.code);

		// 3. The wrapped message (last — least structured).
		push(err.message);
	}

	return out;
}

/**
 * Extracts the stable backend code from a caught value, or `null` when none is
 * present. Handles ConvexError data payloads and the wrapped `[CONVEX …] CODE`
 * message format.
 */
export function extractErrorCode(error: unknown): BackendErrorCode | null {
	const candidates = candidateStrings(error);

	// Exact match first — the most reliable signal (payloads, error `name`).
	for (const candidate of candidates) {
		if (KNOWN_CODE_SET.has(candidate)) {
			return candidate as BackendErrorCode;
		}
	}

	// Fall back to substring matching for wrapped Convex messages.
	for (const candidate of candidates) {
		for (const code of SUBSTRING_MATCH_CODES) {
			if (candidate.includes(code)) {
				return code;
			}
		}
	}

	return null;
}

/**
 * Resolves the i18n key for a caught error. Returns the `errors.<CODE>` key for
 * a known code, otherwise `fallbackKey` (a generic localized message).
 */
export function getErrorMessageKey(
	error: unknown,
	fallbackKey: string = ErrorKeys.GENERIC
): string {
	const code = extractErrorCode(error);
	return code ? ERROR_CODE_KEYS[code] : fallbackKey;
}

/**
 * Turns any caught value into a localized, user-safe message. Known backend
 * codes map to their translated message; everything else (unknown codes, raw
 * network errors, arbitrary throwables) resolves to the localized `fallbackKey`
 * so raw backend text never reaches the UI.
 */
export function getErrorMessage(
	error: unknown,
	t: TFunction,
	fallbackKey: string = ErrorKeys.GENERIC
): string {
	return t(getErrorMessageKey(error, fallbackKey));
}
