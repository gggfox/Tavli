import { describe, expect, it } from "vitest";
import { Languages, SidebarKeys } from "./locales";
import en from "./locales/en.json";
import es from "./locales/es.json";

function flattenKeys(obj: Record<string, unknown>, prefix = ""): string[] {
	return Object.entries(obj).flatMap(([key, value]) => {
		const path = prefix ? `${prefix}.${key}` : key;
		if (typeof value === "object" && value !== null) {
			return flattenKeys(value as Record<string, unknown>, path);
		}
		return [path];
	});
}

describe("Locale files", () => {
	const enKeys = flattenKeys(en).sort();
	const esKeys = flattenKeys(es).sort();

	it("en.json and es.json have the same keys", () => {
		expect(enKeys).toEqual(esKeys);
	});

	it("no locale has empty string values", () => {
		for (const key of enKeys) {
			const value = key.split(".").reduce((o: any, k) => o?.[k], en);
			expect(value, `en.json key "${key}" is empty`).not.toBe("");
		}
		for (const key of esKeys) {
			const value = key.split(".").reduce((o: any, k) => o?.[k], es);
			expect(value, `es.json key "${key}" is empty`).not.toBe("");
		}
	});
});

describe("Languages constant", () => {
	it("exports EN and ES", () => {
		expect(Languages.EN).toBe("en");
		expect(Languages.ES).toBe("es");
	});
});

describe("SidebarKeys", () => {
	it("all sidebar key values exist in en.json", () => {
		for (const key of Object.values(SidebarKeys)) {
			const value = key.split(".").reduce((o: any, k) => o?.[k], en);
			expect(value, `Missing en.json key for SidebarKeys value "${key}"`).toBeDefined();
		}
	});
});
