import { describe, expect, it } from "vitest";
import { cleanedFields } from "../migrations/stripPriceNotListedNote";
import { hasListedPrice, stripPriceNotListedNote } from "./menuPricing";

describe("hasListedPrice", () => {
	it("accepts a positive price", () => {
		expect(hasListedPrice(1)).toBe(true);
		expect(hasListedPrice(12050)).toBe(true);
	});

	it("rejects 0, which is how an import stores a missing price", () => {
		expect(hasListedPrice(0)).toBe(false);
	});

	it("rejects negative and non-finite values", () => {
		expect(hasListedPrice(-500)).toBe(false);
		expect(hasListedPrice(Number.NaN)).toBe(false);
		expect(hasListedPrice(Number.POSITIVE_INFINITY)).toBe(false);
	});

	it("rejects an absent price", () => {
		expect(hasListedPrice(undefined)).toBe(false);
		expect(hasListedPrice(null)).toBe(false);
	});
});

describe("stripPriceNotListedNote", () => {
	it("drops a description that was only the note", () => {
		expect(stripPriceNotListedNote("(price not listed)")).toBeUndefined();
	});

	it("keeps the rest of the description", () => {
		expect(stripPriceNotListedNote("Grilled octopus (price not listed)")).toBe("Grilled octopus");
		expect(stripPriceNotListedNote("(Price Not Listed) served with rice")).toBe("served with rice");
	});

	it("leaves other descriptions untouched", () => {
		expect(stripPriceNotListedNote("Sopa de almeja con cilantro")).toBe(
			"Sopa de almeja con cilantro"
		);
		expect(stripPriceNotListedNote(undefined)).toBeUndefined();
	});
});

describe("stripPriceNotListedNote migration: cleanedFields", () => {
	it("skips an item without the note", () => {
		expect(cleanedFields({ description: "Rib eye", translations: undefined })).toBeNull();
	});

	it("cleans the base description and every translation", () => {
		expect(
			cleanedFields({
				description: "Octopus (price not listed)",
				translations: {
					es: { name: "Pulpo", description: "(price not listed)" },
					en: { name: "Octopus" },
				},
			})
		).toEqual({
			description: "Octopus",
			translations: { es: { name: "Pulpo" }, en: { name: "Octopus" } },
		});
	});

	it("removes a description that was only the note", () => {
		expect(cleanedFields({ description: "(price not listed)", translations: undefined })).toEqual({
			description: undefined,
			translations: undefined,
		});
	});
});
