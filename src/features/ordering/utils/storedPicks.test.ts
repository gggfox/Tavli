/* eslint-disable boundaries/no-unknown-files, @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { picksFromDraftLines } from "./menuPicks";
import {
	clearStoredPicks,
	loadStoredPicks,
	saveStoredPicks,
	STORED_PICKS_TTL_MS,
	storedPicksKey,
} from "./storedPicks";

const verde = {
	optionGroupId: "optionGroups:salsa",
	optionGroupName: "Salsa",
	optionId: "options:verde",
	optionName: "Verde",
	priceModifier: 150,
} as any;

const LINES = [
	{ menuItemId: "menuItems:tacos", quantity: 2, unitPrice: 1000, selectedOptions: [verde] },
	{ menuItemId: "menuItems:soup", quantity: 1, unitPrice: 600, selectedOptions: [] },
] as any[];

const NOW = 1_800_000_000_000;

describe("storedPicks", () => {
	beforeEach(() => sessionStorage.clear());
	afterEach(() => vi.restoreAllMocks());

	it("round-trips picks as draft lines, so they seed through the draft path", () => {
		saveStoredPicks("casa", picksFromDraftLines(LINES), NOW);

		const loaded = loadStoredPicks("casa", NOW + 1000);
		expect(loaded).toEqual(LINES);
		// …and the lines rebuild the very same picks.
		expect(picksFromDraftLines(loaded!)).toEqual(picksFromDraftLines(LINES));
	});

	it("keeps each restaurant's picks apart", () => {
		saveStoredPicks("casa", picksFromDraftLines(LINES), NOW);

		expect(loadStoredPicks("otra", NOW)).toBeNull();
		expect(loadStoredPicks("casa", NOW)).toHaveLength(2);
	});

	it("removes the entry when the picks are emptied, and on clear", () => {
		saveStoredPicks("casa", picksFromDraftLines(LINES), NOW);
		saveStoredPicks("casa", new Map(), NOW);
		expect(sessionStorage.getItem(storedPicksKey("casa"))).toBeNull();

		saveStoredPicks("casa", picksFromDraftLines(LINES), NOW);
		clearStoredPicks("casa");
		expect(loadStoredPicks("casa", NOW)).toBeNull();
	});

	it("expires picks older than the TTL, and drops the stale entry", () => {
		saveStoredPicks("casa", picksFromDraftLines(LINES), NOW);

		expect(loadStoredPicks("casa", NOW + STORED_PICKS_TTL_MS)).toHaveLength(2);
		expect(loadStoredPicks("casa", NOW + STORED_PICKS_TTL_MS + 1)).toBeNull();
		expect(sessionStorage.getItem(storedPicksKey("casa"))).toBeNull();
	});

	it.each([
		["not JSON", "{oops"],
		["another version", JSON.stringify({ version: 2, savedAt: NOW, lines: LINES })],
		["a line without a dish", JSON.stringify({ version: 1, savedAt: NOW, lines: [{}] })],
		[
			"a malformed option",
			JSON.stringify({
				version: 1,
				savedAt: NOW,
				lines: [{ ...LINES[0], selectedOptions: [{ optionId: 3 }] }],
			}),
		],
		["a date in the future", JSON.stringify({ version: 1, savedAt: NOW + 60_000, lines: LINES })],
	])("ignores and removes an entry that is %s", (_label, raw) => {
		sessionStorage.setItem(storedPicksKey("casa"), raw);

		expect(loadStoredPicks("casa", NOW)).toBeNull();
		expect(sessionStorage.getItem(storedPicksKey("casa"))).toBeNull();
	});

	it("never throws when storage does (private mode, blocked site data)", () => {
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("SecurityError");
		});
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("QuotaExceededError");
		});
		vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
			throw new Error("SecurityError");
		});

		expect(() => saveStoredPicks("casa", picksFromDraftLines(LINES), NOW)).not.toThrow();
		expect(() => saveStoredPicks("casa", new Map(), NOW)).not.toThrow();
		expect(() => clearStoredPicks("casa")).not.toThrow();
		expect(loadStoredPicks("casa", NOW)).toBeNull();
	});

	it("never throws when there is no storage at all (the server render)", () => {
		vi.spyOn(globalThis, "sessionStorage", "get").mockReturnValue(undefined as any);

		expect(() => saveStoredPicks("casa", picksFromDraftLines(LINES), NOW)).not.toThrow();
		expect(loadStoredPicks("casa", NOW)).toBeNull();
	});
});
