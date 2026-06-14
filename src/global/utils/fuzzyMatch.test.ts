import { describe, expect, it } from "vitest";
import { fuzzyMatch, levenshtein } from "./fuzzyMatch";

describe("levenshtein", () => {
	it("returns 0 for identical strings", () => {
		expect(levenshtein("rib eye", "rib eye")).toBe(0);
	});

	it("counts single-character edits", () => {
		expect(levenshtein("ribey", "ribeye")).toBe(1);
	});
});

describe("fuzzyMatch", () => {
	it("returns false for empty query", () => {
		expect(fuzzyMatch("", "Rib eye")).toBe(false);
		expect(fuzzyMatch("   ", "Rib eye")).toBe(false);
	});

	it("matches case-insensitive substrings", () => {
		expect(fuzzyMatch("rib", "Rib eye")).toBe(true);
		expect(fuzzyMatch("SOPA", "Sopa de almeja")).toBe(true);
	});

	it("tolerates small typos when substring does not match", () => {
		expect(fuzzyMatch("ribey", "ribeye")).toBe(true);
	});

	it("avoids loose matches on very short queries", () => {
		expect(fuzzyMatch("x", "Rib eye")).toBe(false);
	});
});
