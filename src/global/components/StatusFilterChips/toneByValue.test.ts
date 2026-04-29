import { describe, expect, it } from "vitest";
import type { StatusFilterOption } from "./StatusFilterChips";
import { toneByValue } from "./statusPalette";

type Status = "pending" | "confirmed" | "cancelled";

const CHIPS: ReadonlyArray<StatusFilterOption<Status>> = [
	{ value: "pending", label: "Pending", tone: "warning" },
	{ value: "confirmed", label: "Confirmed", tone: "info" },
	{ value: "cancelled", label: "Cancelled", tone: "danger" },
];

describe("toneByValue", () => {
	it("returns the tone for a known value", () => {
		expect(toneByValue(CHIPS, "pending")).toBe("warning");
		expect(toneByValue(CHIPS, "confirmed")).toBe("info");
		expect(toneByValue(CHIPS, "cancelled")).toBe("danger");
	});

	it("returns undefined when the value is not in the chip set", () => {
		// @ts-expect-error - intentionally passing a value outside the union to
		// exercise the runtime path; callers may receive arbitrary strings from
		// the API layer.
		expect(toneByValue(CHIPS, "unknown")).toBeUndefined();
	});

	it("returns undefined when chips is empty", () => {
		expect(toneByValue([], "pending" as Status)).toBeUndefined();
	});
});
