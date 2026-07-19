import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import { ErrorKeys } from "@/global/i18n/keys/errors";
import { extractErrorCode, getErrorMessage, getErrorMessageKey } from "./errorMessages";

/**
 * Stand-in for i18next's `t`: echoes the key so assertions can check which key
 * was resolved without booting the real i18n instance. Matches the codebase
 * convention (see OrderItemRow.test.tsx) of mocking `t` to identity.
 */
const t = ((key: string) => key) as unknown as TFunction;

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

	it("extracts the code from a ConvexError data payload object", () => {
		expect(extractErrorCode({ data: { name: "NOT_AUTHORIZED", message: "Not authorized" } })).toBe(
			"NOT_AUTHORIZED"
		);
	});

	it("extracts the code from a ConvexError data payload string", () => {
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

describe("getErrorMessageKey", () => {
	it("maps a known code to its errors.<CODE> key", () => {
		expect(getErrorMessageKey(new Error("ERROR_TABLE_LOCKED"))).toBe("errors.ERROR_TABLE_LOCKED");
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
});
