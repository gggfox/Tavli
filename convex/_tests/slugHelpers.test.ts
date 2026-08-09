import { describe, expect, it } from "vitest";
import {
	RESTAURANT_SLUG_FALLBACK_BASE,
	RESTAURANT_SLUG_MAX_COLLISION_ATTEMPTS,
	RESTAURANT_SLUG_MAX_LENGTH,
} from "../constants";
import {
	buildCandidateSlug,
	candidateSlugs,
	normalizeRestaurantSlug,
	sanitizeSlugInput,
	slugifyRestaurantName,
} from "../slugHelpers";

describe("slugifyRestaurantName", () => {
	it("folds Spanish diacritics instead of shredding them", () => {
		// The frontend-only sanitizer this replaces turned every non-ASCII byte
		// into a separator: "Café Ñoño" became "caf--o-o".
		expect(slugifyRestaurantName("Café Ñoño")).toBe("cafe-nono");
		expect(slugifyRestaurantName("Tacos El Güero")).toBe("tacos-el-guero");
		expect(slugifyRestaurantName("Piñata Bar")).toBe("pinata-bar");
	});

	it("lowercases and separates words", () => {
		expect(slugifyRestaurantName("La Cocina")).toBe("la-cocina");
		expect(slugifyRestaurantName("LA COCINA")).toBe("la-cocina");
	});

	it("collapses every run of punctuation and whitespace into one dash", () => {
		expect(slugifyRestaurantName("La   Cocina")).toBe("la-cocina");
		expect(slugifyRestaurantName("Bar & Grill, Co.")).toBe("bar-grill-co");
		expect(slugifyRestaurantName("A---B__C")).toBe("a-b-c");
	});

	it("trims leading and trailing junk", () => {
		expect(slugifyRestaurantName("  ¡La Cocina!  ")).toBe("la-cocina");
		expect(slugifyRestaurantName("---la-cocina---")).toBe("la-cocina");
	});

	it("keeps digits", () => {
		expect(slugifyRestaurantName("Pizzería 24/7")).toBe("pizzeria-24-7");
	});

	it("falls back to a deterministic base when nothing slug-able survives", () => {
		for (const name of ["🍕🍔", "寿司", "!!!", "   ", ""]) {
			expect(slugifyRestaurantName(name)).toBe(RESTAURANT_SLUG_FALLBACK_BASE);
		}
	});

	it("caps the length without leaving a dangling separator", () => {
		const long = `${"la-cocina-de-la-abuela ".repeat(10)}fin`;
		const slug = slugifyRestaurantName(long);

		expect(slug.length).toBeLessThanOrEqual(RESTAURANT_SLUG_MAX_LENGTH);
		expect(slug.endsWith("-")).toBe(false);
		expect(slug.startsWith("la-cocina-de-la-abuela")).toBe(true);
	});
});

describe("normalizeRestaurantSlug", () => {
	it("returns an empty string rather than inventing a replacement", () => {
		// `update` must REJECT a blank slug; only `create` may substitute a base.
		for (const value of ["", "   ", "---", "!!!", "🍕"]) {
			expect(normalizeRestaurantSlug(value)).toBe("");
		}
	});

	it("normalizes an operator-typed slug the same way a name is slugified", () => {
		expect(normalizeRestaurantSlug("  La Cocina  ")).toBe("la-cocina");
		expect(normalizeRestaurantSlug("La-Cocina-")).toBe("la-cocina");
		expect(normalizeRestaurantSlug("CAFÉ")).toBe("cafe");
	});

	it("leaves an already-normalized slug untouched", () => {
		expect(normalizeRestaurantSlug("la-cocina-2")).toBe("la-cocina-2");
	});
});

describe("buildCandidateSlug", () => {
	it("counts with a dash suffix starting at 2", () => {
		expect(buildCandidateSlug("la-cocina", 0)).toBe("la-cocina");
		expect(buildCandidateSlug("la-cocina", 1)).toBe("la-cocina-2");
		expect(buildCandidateSlug("la-cocina", 2)).toBe("la-cocina-3");
		expect(buildCandidateSlug("la-cocina", 9)).toBe("la-cocina-10");
	});

	it("truncates the base, never the counter, to stay inside the cap", () => {
		const base = "a".repeat(RESTAURANT_SLUG_MAX_LENGTH);
		const second = buildCandidateSlug(base, 1);

		expect(second.length).toBeLessThanOrEqual(RESTAURANT_SLUG_MAX_LENGTH);
		expect(second.endsWith("-2")).toBe(true);
		// Truncating the counter instead would have collided with attempt 0.
		expect(second).not.toBe(buildCandidateSlug(base, 0));
	});

	it("does not leave a doubled separator when the truncation lands on one", () => {
		const base = `${"a".repeat(RESTAURANT_SLUG_MAX_LENGTH - 3)}-bb`;
		expect(buildCandidateSlug(base, 1)).toBe(`${"a".repeat(RESTAURANT_SLUG_MAX_LENGTH - 3)}-2`);
	});

	it("substitutes the fallback base for an empty one", () => {
		expect(buildCandidateSlug("", 0)).toBe(RESTAURANT_SLUG_FALLBACK_BASE);
		expect(buildCandidateSlug("", 1)).toBe(`${RESTAURANT_SLUG_FALLBACK_BASE}-2`);
	});
});

describe("candidateSlugs", () => {
	it("is bounded and free of duplicates", () => {
		const candidates = candidateSlugs("la-cocina");

		expect(candidates).toHaveLength(RESTAURANT_SLUG_MAX_COLLISION_ATTEMPTS);
		expect(new Set(candidates).size).toBe(candidates.length);
		expect(candidates[0]).toBe("la-cocina");
		expect(candidates[1]).toBe("la-cocina-2");
	});

	it("stays unique even when every candidate is truncated to the cap", () => {
		const candidates = candidateSlugs("a".repeat(RESTAURANT_SLUG_MAX_LENGTH * 2));

		expect(new Set(candidates).size).toBe(candidates.length);
		for (const candidate of candidates) {
			expect(candidate.length).toBeLessThanOrEqual(RESTAURANT_SLUG_MAX_LENGTH);
		}
	});
});

describe("sanitizeSlugInput", () => {
	it("keeps a trailing separator so a slug can still be typed", () => {
		// Trimming on every keystroke makes "la-cocina" impossible to reach.
		expect(sanitizeSlugInput("la ")).toBe("la-");
		expect(sanitizeSlugInput("la-c")).toBe("la-c");
	});

	it("folds diacritics as you type", () => {
		expect(sanitizeSlugInput("Café")).toBe("cafe");
	});

	it("never exceeds the stored length", () => {
		expect(sanitizeSlugInput("x".repeat(200))).toHaveLength(RESTAURANT_SLUG_MAX_LENGTH);
	});
});
