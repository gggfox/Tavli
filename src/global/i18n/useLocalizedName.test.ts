import { describe, expect, it } from "vitest";
import { localizeName } from "./useLocalizedName";

const translations = {
	en: { name: "Ribeye" },
	es: { name: "Bife de costilla" },
};

describe("localizeName", () => {
	it("returns translation for the requested language", () => {
		expect(localizeName("Rib eye", translations, "es")).toBe("Bife de costilla");
		expect(localizeName("Rib eye", translations, "en")).toBe("Ribeye");
	});

	it("normalizes regional codes (es-MX -> es)", () => {
		expect(localizeName("Rib eye", translations, "es-MX")).toBe("Bife de costilla");
	});

	it("falls back to snapshot when language has no translation", () => {
		expect(localizeName("Rib eye", { en: { name: "Ribeye" } }, "es")).toBe("Rib eye");
	});

	it("falls back to snapshot when translations is undefined", () => {
		expect(localizeName("Rib eye", undefined, "es")).toBe("Rib eye");
	});

	it("falls back to snapshot when language is undefined", () => {
		expect(localizeName("Rib eye", translations, undefined)).toBe("Rib eye");
	});

	it("falls back to snapshot when the entry's name is empty/missing", () => {
		expect(localizeName("Rib eye", { es: {} }, "es")).toBe("Rib eye");
	});
});
