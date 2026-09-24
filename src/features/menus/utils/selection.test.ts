import { describe, expect, it } from "vitest";
import { sectionSelectionState, toggleSection, toggleSelection } from "./selection";

const ORDER = ["a", "b", "c", "d", "e"] as const;
type Id = (typeof ORDER)[number];
const set = (...ids: Id[]) => new Set<Id>(ids);

describe("toggleSelection", () => {
	it("a plain click toggles one item", () => {
		expect(toggleSelection(set(), "b", ORDER, null, false)).toEqual(set("b"));
		expect(toggleSelection(set("b"), "b", ORDER, "b", false)).toEqual(set());
	});

	it("Shift+click selects the range from the anchor, in either direction", () => {
		expect(toggleSelection(set("b"), "d", ORDER, "b", true)).toEqual(set("b", "c", "d"));
		expect(toggleSelection(set("d"), "b", ORDER, "d", true)).toEqual(set("b", "c", "d"));
	});

	it("Shift+click on a selected item clears the range", () => {
		expect(toggleSelection(set("a", "b", "c", "d"), "c", ORDER, "a", true)).toEqual(set("d"));
	});

	it("falls back to a plain toggle when the anchor is gone from the visible order", () => {
		expect(toggleSelection(set(), "c", ["c", "d"], "a" as never, true)).toEqual(set("c"));
	});

	it("does not mutate the previous set", () => {
		const prev = set("a");
		toggleSelection(prev, "b", ORDER, null, false);
		expect(prev).toEqual(set("a"));
	});
});

describe("toggleSection", () => {
	it("selects the whole section when some or none are selected", () => {
		expect(toggleSection(set("e"), ["a", "b"])).toEqual(set("a", "b", "e"));
		expect(toggleSection(set("a", "e"), ["a", "b"])).toEqual(set("a", "b", "e"));
	});

	it("clears the section when all of it is selected, keeping other sections", () => {
		expect(toggleSection(set("a", "b", "e"), ["a", "b"])).toEqual(set("e"));
	});

	it("an empty section changes nothing", () => {
		expect(toggleSection(set("a"), [])).toEqual(set("a"));
	});
});

describe("sectionSelectionState", () => {
	it("reports none, some and all with the count", () => {
		expect(sectionSelectionState(set(), ["a", "b"])).toEqual({ state: "none", count: 0 });
		expect(sectionSelectionState(set("a"), ["a", "b"])).toEqual({ state: "some", count: 1 });
		expect(sectionSelectionState(set("a", "b"), ["a", "b"])).toEqual({ state: "all", count: 2 });
	});
});
