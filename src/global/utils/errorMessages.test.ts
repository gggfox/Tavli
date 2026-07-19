import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import {
	AppUrlNotConfiguredError,
	fromErrorObject,
	UserInputValidationError,
} from "convex/_shared/errors";
import en from "@/global/i18n/locales/en.json";
import { ErrorKeys } from "@/global/i18n/keys/errors";
import { extractErrorCode, getErrorMessage, getErrorMessageKey } from "./errorMessages";

/**
 * Stand-in for i18next's `t`: echoes the key so assertions can check which key
 * was resolved without booting the real i18n instance. Matches the codebase
 * convention (see OrderItemRow.test.tsx) of mocking `t` to identity.
 */
const t = ((key: string) => key) as unknown as TFunction;

/**
 * Resolves a dotted i18n key against the real EN locale, so tests can assert
 * the actual user-facing string (and prove the SPECIFIC message wins over the
 * generic category one).
 */
function translateEn(key: string): string {
	const value = key
		.split(".")
		.reduce<unknown>(
			(node, part) =>
				node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined,
			en
		);
	return typeof value === "string" ? value : key;
}
const tEn = ((key: string) => translateEn(key)) as unknown as TFunction;

describe("extractErrorCode", () => {
	it("returns a bare code string", () => {
		expect(extractErrorCode("ERROR_TABLE_LOCKED")).toBe("ERROR_TABLE_LOCKED");
	});

	it("returns the code from a plain Error whose message is the code", () => {
		expect(extractErrorCode(new Error("ERROR_MANAGER_ROLE_REQUIRED"))).toBe(
			"ERROR_MANAGER_ROLE_REQUIRED"
		);
	});

	it("extracts the code from the wrapped Convex message format", () => {
		const wrapped = new Error(
			"[CONVEX M(reservations:create)] [request-id abc123] Server Error\n" +
				"Uncaught Error: ERROR_BLACKOUT_WINDOW\n    at handler (../convex/reservations.ts:133:9)"
		);
		expect(extractErrorCode(wrapped)).toBe("ERROR_BLACKOUT_WINDOW");
	});

	it("extracts a bare code from a data payload string", () => {
		expect(extractErrorCode({ data: "ERROR_TAB_EMPTY" })).toBe("ERROR_TAB_EMPTY");
	});

	it("does not confuse ERROR_TAB_LOCKED with ERROR_TABLE_LOCKED", () => {
		expect(extractErrorCode(new Error("Uncaught Error: ERROR_TABLE_LOCKED at ..."))).toBe(
			"ERROR_TABLE_LOCKED"
		);
		expect(extractErrorCode(new Error("Uncaught Error: ERROR_TAB_LOCKED at ..."))).toBe(
			"ERROR_TAB_LOCKED"
		);
	});

	it("returns null for an unknown code", () => {
		expect(extractErrorCode(new Error("Database connection failed"))).toBeNull();
		expect(extractErrorCode("something went wrong")).toBeNull();
		expect(extractErrorCode(null)).toBeNull();
		expect(extractErrorCode(undefined)).toBeNull();
		expect(extractErrorCode({})).toBeNull();
	});

	it("does not treat a plain Error name as a code", () => {
		// new Error(...).name === "Error", which is not a stable code.
		expect(extractErrorCode(new Error("nope"))).toBeNull();
	});
});

/**
 * The REAL runtime shape: the backend RETURNS `[null, someError.toObject()]`
 * and `unwrapResult` rethrows `fromErrorObject(obj)`, producing an `Error`
 * whose `.name` is the GENERIC category and whose `.message` is the SPECIFIC
 * stable code. The specific code must win over the generic category.
 */
describe("extractErrorCode — real returned error shapes (fromErrorObject)", () => {
	it("prefers the specific code on .message over the generic category on .name (CONFLICT)", () => {
		const err = fromErrorObject({ name: "CONFLICT", message: "ERROR_BLACKOUT_WINDOW" });
		expect(err.name).toBe("CONFLICT");
		expect(extractErrorCode(err)).toBe("ERROR_BLACKOUT_WINDOW");
	});

	it("prefers the specific code for a reservation NO_TABLES conflict", () => {
		const err = fromErrorObject({ name: "CONFLICT", message: "ERROR_NO_TABLES_AVAILABLE" });
		expect(extractErrorCode(err)).toBe("ERROR_NO_TABLES_AVAILABLE");
	});

	it("unwraps the 'field: CODE' validation shape", () => {
		const err = fromErrorObject({
			name: "VALIDATION_ERROR",
			message: "tableNumber: ERROR_TABLE_NUMBER_EXISTS",
		});
		expect(extractErrorCode(err)).toBe("ERROR_TABLE_NUMBER_EXISTS");
	});

	it("reads the code from a UserInputValidationError payload as tables.ts builds it", () => {
		// Mirrors convex/tables.ts (~lines 91, 150).
		const payload = new UserInputValidationError({
			fields: [{ field: "tableNumber", message: "ERROR_TABLE_NUMBER_EXISTS" }],
		}).toObject();
		expect(payload.name).toBe("VALIDATION_ERROR");
		expect(extractErrorCode(payload)).toBe("ERROR_TABLE_NUMBER_EXISTS");
	});

	it("prefers the specific PIN/auth code over the NOT_AUTHORIZED category", () => {
		expect(
			extractErrorCode(fromErrorObject({ name: "NOT_AUTHORIZED", message: "ERROR_INVALID_PIN" }))
		).toBe("ERROR_INVALID_PIN");
		expect(
			extractErrorCode(fromErrorObject({ name: "NOT_AUTHORIZED", message: "ERROR_PIN_LOCKED" }))
		).toBe("ERROR_PIN_LOCKED");
		expect(
			extractErrorCode(
				fromErrorObject({ name: "NOT_AUTHORIZED", message: "ERROR_MANAGER_ROLE_REQUIRED" })
			)
		).toBe("ERROR_MANAGER_ROLE_REQUIRED");
	});

	it("falls back to the generic category when .message carries no specific code", () => {
		// getCurrentUserId returns NotAuthenticatedError → message is prose, name is the category.
		const err = fromErrorObject({ name: "NOT_AUTHENTICATED", message: "Not authenticated" });
		expect(extractErrorCode(err)).toBe("NOT_AUTHENTICATED");

		const conflict = fromErrorObject({ name: "CONFLICT", message: "Conflict" });
		expect(extractErrorCode(conflict)).toBe("CONFLICT");
	});

	it("returns null when neither a specific code nor a known category is present", () => {
		const err = fromErrorObject({ name: "MYSTERY_CATEGORY", message: "ERROR_NOT_A_REAL_CODE" });
		expect(extractErrorCode(err)).toBeNull();
	});

	it("resolves APP_URL_NOT_CONFIGURED (a standalone code with prose on .message)", () => {
		// getAppUrl() throws this directly (not via a returned tuple), but it is
		// registered in BACKEND_ERROR_CODES for consistency — verify it still
		// resolves correctly if ever caught and passed through the mapper.
		const err = new AppUrlNotConfiguredError(
			'PUBLIC_APP_URL (or VITE_APP_URL) must be set when CONVEX_ENV is "production"; refusing to fall back to localhost.'
		);
		expect(extractErrorCode(err)).toBe("APP_URL_NOT_CONFIGURED");
	});
});

describe("getErrorMessageKey", () => {
	it("maps a known code to its errors.<CODE> key", () => {
		expect(getErrorMessageKey(new Error("ERROR_TABLE_LOCKED"))).toBe("errors.ERROR_TABLE_LOCKED");
	});

	it("maps the specific returned-error code, not the generic category", () => {
		expect(
			getErrorMessageKey(fromErrorObject({ name: "CONFLICT", message: "ERROR_BLACKOUT_WINDOW" }))
		).toBe("errors.ERROR_BLACKOUT_WINDOW");
	});

	it("falls back to the generic key for unknown codes", () => {
		expect(getErrorMessageKey(new Error("whatever"))).toBe(ErrorKeys.GENERIC);
	});

	it("uses the provided fallback key for unknown codes", () => {
		expect(getErrorMessageKey(new Error("whatever"), "custom.fallback")).toBe("custom.fallback");
	});
});

describe("getErrorMessage", () => {
	it("returns the translated key for a known code", () => {
		expect(getErrorMessage(new Error("ERROR_MANAGER_ROLE_REQUIRED"), t)).toBe(
			"errors.ERROR_MANAGER_ROLE_REQUIRED"
		);
	});

	it("returns the translated key for a wrapped Convex message", () => {
		const wrapped = new Error("[CONVEX M(x)] Server Error Uncaught Error: ERROR_TAB_LOCKED at y");
		expect(getErrorMessage(wrapped, t)).toBe("errors.ERROR_TAB_LOCKED");
	});

	it("returns the generic localized fallback for unknown codes", () => {
		expect(getErrorMessage(new Error("boom"), t)).toBe(ErrorKeys.GENERIC);
	});

	it("returns a custom localized fallback when provided", () => {
		expect(getErrorMessage("mystery", t, "reservations.errors.actionFailed")).toBe(
			"reservations.errors.actionFailed"
		);
	});

	it("resolves the SPECIFIC EN message for a returned PIN error, not the generic one", () => {
		const err = fromErrorObject({ name: "NOT_AUTHORIZED", message: "ERROR_INVALID_PIN" });
		expect(getErrorMessage(err, tEn)).toBe("That PIN is incorrect. Please try again.");
		expect(getErrorMessage(err, tEn)).not.toBe(en.errors.NOT_AUTHORIZED);
	});

	it("resolves the SPECIFIC EN message for a returned table-number conflict", () => {
		const err = fromErrorObject({
			name: "VALIDATION_ERROR",
			message: "tableNumber: ERROR_TABLE_NUMBER_EXISTS",
		});
		expect(getErrorMessage(err, tEn)).toBe("A table with that number already exists.");
		expect(getErrorMessage(err, tEn)).not.toBe(en.errors.VALIDATION_ERROR);
	});

	it("resolves the SPECIFIC EN reservation reason for a returned blackout conflict", () => {
		const err = fromErrorObject({ name: "CONFLICT", message: "ERROR_BLACKOUT_WINDOW" });
		expect(getErrorMessage(err, tEn)).toBe(en.errors.ERROR_BLACKOUT_WINDOW);
		expect(getErrorMessage(err, tEn)).not.toBe(en.errors.CONFLICT);
	});
});
