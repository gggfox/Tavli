/**
 * Error-message utilities for i18n-compatible error handling.
 *
 * The Convex backend surfaces errors as **stable string codes** rather than
 * prose, so the frontend can map them to localized messages. Backend functions
 * RETURN errors as result tuples (`[null, someError.toObject()]`), and on the
 * client `unwrapResult` calls `fromErrorObject` (`convex/_shared/errors.ts`),
 * which produces a plain `Error` split across two fields:
 *
 *   - `.name` carries the **generic category** — `CONFLICT`, `NOT_AUTHORIZED`,
 *     `VALIDATION_ERROR`, `NOT_FOUND`, … (the `ERROR_NAMES` values).
 *   - `.message` carries the **specific stable code** — e.g.
 *     `ERROR_BLACKOUT_WINDOW`, `ERROR_INVALID_PIN`, `ERROR_MANAGER_ROLE_REQUIRED`
 *     — or, for validation errors, `"field: CODE"`
 *     (e.g. `"tableNumber: ERROR_TABLE_NUMBER_EXISTS"`). The code may also be
 *     carried on a `fields`/`data` payload.
 *
 * Server-*thrown* (not returned) errors instead surface as a wrapped message
 * string, e.g.
 * `"[CONVEX M(reservations:create)] [request-id] Server Error\nUncaught Error: ERROR_BLACKOUT_WINDOW\n    at ..."`.
 *
 * `extractErrorCode` prioritizes the **specific** `ERROR_*` code (the actionable
 * one) over the generic category, so the UI shows "That PIN is incorrect."
 * rather than the generic "You don't have permission." When no specific code is
 * present it falls back to the generic category, then to a localized generic
 * message. Raw backend messages must never reach the UI — always route caught
 * errors through `getErrorMessage`.
 */
import {
	BACKEND_ERROR_CODES,
	ERROR_CODE_KEYS,
	ErrorKeys,
	type BackendErrorCode,
} from "@/global/i18n/keys/errors";
import type { TFunction } from "i18next";

/**
 * Specific `ERROR_*` codes only, sorted longest-first. These are the actionable
 * codes carried on `.message` (or a `fields`/`data` payload, or the wrapped
 * `[CONVEX …] CODE` string). Sorting longest-first stops a shorter code from
 * shadowing a more specific one during substring matching (e.g. `ERROR_TAB_LOCKED`
 * must not shadow `ERROR_TABLE_LOCKED`).
 */
const SPECIFIC_CODES: readonly BackendErrorCode[] = BACKEND_ERROR_CODES.filter((code) =>
	code.startsWith("ERROR_")
)
	.slice()
	.sort((a, b) => b.length - a.length);

/**
 * Generic error categories (the `ERROR_NAMES` values carried on `.name`, e.g.
 * `CONFLICT`, `NOT_AUTHORIZED`, `VALIDATION_ERROR`). Matched only by exact
 * candidate — never by substring — to avoid false positives from incidental
 * substrings in a stack trace, and only as a fallback once no specific code
 * is found.
 */
const GENERIC_CODE_SET: ReadonlySet<string> = new Set(
	BACKEND_ERROR_CODES.filter((code) => !code.startsWith("ERROR_"))
);

/**
 * Finds a specific `ERROR_*` code inside a single candidate string. Handles a
 * bare code, the `"field: CODE"` validation shape, and the wrapped
 * `[CONVEX …] CODE` message — all via a longest-first substring scan so the
 * most specific code wins.
 */
function matchSpecificCode(candidate: string): BackendErrorCode | null {
	for (const code of SPECIFIC_CODES) {
		if (candidate.includes(code)) {
			return code;
		}
	}
	return null;
}

/**
 * Collects candidate strings from an arbitrary caught value, ordered so the
 * **specific-code-carrying** fields (`message`, `fields[].message`, `data`
 * payload) come before the generic `name`. Every string is scanned for a
 * specific code first; only if none is found is a generic `name` considered.
 */
function candidateStrings(error: unknown): string[] {
	const out: string[] = [];
	const push = (value: unknown) => {
		if (typeof value === "string" && value.length > 0) out.push(value);
	};
	const pushFields = (fields: unknown) => {
		if (Array.isArray(fields)) {
			for (const field of fields) {
				if (field && typeof field === "object") {
					push((field as Record<string, unknown>).message);
				}
			}
		}
	};

	if (typeof error === "string") {
		push(error);
		return out;
	}

	if (error && typeof error === "object") {
		const err = error as Record<string, unknown>;

		// 1. Result-tuple / payload objects: a bare code string, or an error
		//    object whose specific code lives on `message`/`code`/`fields`.
		const data = err.data;
		if (typeof data === "string") {
			push(data);
		} else if (data && typeof data === "object") {
			const payload = data as Record<string, unknown>;
			push(payload.message);
			push(payload.code);
			pushFields(payload.fields);
			push(payload.name);
		}

		// 2. The (possibly wrapped) message and any structured fields — these
		//    carry the SPECIFIC code.
		push(err.message);
		push(err.code);
		pushFields(err.fields);

		// 3. The error `name` — the GENERIC category (fallback only).
		push(err.name);
	}

	return out;
}

/**
 * Extracts the stable backend code from a caught value, or `null` when none is
 * present.
 *
 * Priority:
 *   1. The **specific** `ERROR_*` code carried on `.message` / `fields` / a
 *      `data` payload (also unwrapping the `"field: CODE"` and
 *      `[CONVEX …] CODE` shapes). Longest-match wins.
 *   2. The **generic** category from `.name` (`CONFLICT`, `NOT_AUTHORIZED`, …).
 *   3. `null` — the caller resolves a localized generic fallback.
 */
export function extractErrorCode(error: unknown): BackendErrorCode | null {
	const candidates = candidateStrings(error);

	// 1. Specific ERROR_* code — the actionable signal, highest priority.
	for (const candidate of candidates) {
		const code = matchSpecificCode(candidate);
		if (code) {
			return code;
		}
	}

	// 2. Generic category (exact match only) as a fallback.
	for (const candidate of candidates) {
		if (GENERIC_CODE_SET.has(candidate)) {
			return candidate as BackendErrorCode;
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
