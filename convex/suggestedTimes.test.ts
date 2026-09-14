import { describe, expect, it } from "vitest";
import { symmetricCandidateTimes } from "./_util/tablePlacement";

const MIN = 60_000;
const NOON = 1_900_000_000_000;

describe("symmetricCandidateTimes", () => {
	it("searches both directions, nearest first", () => {
		const candidates = symmetricCandidateTimes(NOON, 30 * MIN, 2);

		expect(candidates.map((c) => (c - NOON) / MIN)).toEqual([30, -30, 60, -60]);
	});

	it("never offers the requested time itself", () => {
		const candidates = symmetricCandidateTimes(NOON, 30 * MIN, 3);

		expect(candidates).not.toContain(NOON);
	});

	it("returns nothing when asked for no steps", () => {
		expect(symmetricCandidateTimes(NOON, 30 * MIN, 0)).toEqual([]);
	});
});
