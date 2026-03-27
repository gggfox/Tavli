import { describe, expect, it } from "vitest";
import { extractError } from "./extractError";

describe("extractError", () => {
	it("returns null for successful results", () => {
		expect(extractError({ success: true })).toBeNull();
		expect(extractError({ success: true, value: "data" })).toBeNull();
	});

	it("extracts message from an Error instance", () => {
		const result = extractError({
			success: false,
			error: new Error("Something broke"),
		});
		expect(result).toEqual({ message: "Something broke" });
	});

	it("extracts message from a string error", () => {
		const result = extractError({ success: false, error: "Network failure" });
		expect(result).toEqual({ message: "Network failure" });
	});

	it("extracts message from an object with a message property", () => {
		const result = extractError({
			success: false,
			error: { message: "Custom error object" },
		});
		expect(result).toEqual({ message: "Custom error object" });
	});

	it("returns unknown error message for non-standard error shapes", () => {
		const result = extractError({ success: false, error: 42 });
		expect(result).toEqual({ message: "An unknown error occurred" });
	});

	it("returns null when error field is undefined on a failed result", () => {
		const result = extractError({ success: false });
		expect(result).toBeNull();
	});

	it("handles empty string error", () => {
		const result = extractError({ success: false, error: "" });
		expect(result).toBeNull();
	});
});
