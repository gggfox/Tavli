import { describe, expect, it } from "vitest";
import {
	CommonKeys,
	Languages,
	MenusKeys,
	OptionsKeys,
	OrderingKeys,
	OrdersKeys,
	PaymentsKeys,
	ReservationSettingsKeys,
	ReservationsKeys,
	RestaurantsKeys,
	RoleKeys,
	SidebarKeys,
	TimeKeys,
	WelcomeKeys,
} from "./locales";
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

const enPaths = new Set(flattenKeys(en));
const esPaths = new Set(flattenKeys(es));

/**
 * Resolves an enum value against a flat path set, accepting i18next
 * pluralization suffixes (`_one` / `_other`). A pluralized enum value points
 * at a logical key that doesn't exist directly -- both suffixed forms must.
 */
function resolves(path: string, paths: Set<string>): boolean {
	if (paths.has(path)) return true;
	return paths.has(`${path}_one`) && paths.has(`${path}_other`);
}

/**
 * Asserts that every value in a typed key enum (e.g. `SidebarKeys`) resolves
 * in both `en.json` and `es.json`. New per-feature enums plug in here as
 * one-line additions to the `it.each` table below.
 */
function expectAllKeysResolve(name: string, keysObject: Record<string, string>) {
	for (const key of Object.values(keysObject)) {
		expect(resolves(key, enPaths), `Missing en.json key for ${name} value "${key}"`).toBe(true);
		expect(resolves(key, esPaths), `Missing es.json key for ${name} value "${key}"`).toBe(true);
	}
}

describe("Locale files", () => {
	const enKeys = flattenKeys(en).sort((a, b) => a.localeCompare(b));
	const esKeys = flattenKeys(es).sort((a, b) => a.localeCompare(b));

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

describe("Key enums resolve in every locale", () => {
	it.each([
		["SidebarKeys", SidebarKeys as Record<string, string>],
		["CommonKeys", CommonKeys as Record<string, string>],
		["ReservationSettingsKeys", ReservationSettingsKeys as Record<string, string>],
		["RoleKeys", RoleKeys as Record<string, string>],
		["TimeKeys", TimeKeys as Record<string, string>],
		["OrdersKeys", OrdersKeys as Record<string, string>],
		["PaymentsKeys", PaymentsKeys as Record<string, string>],
		["ReservationsKeys", ReservationsKeys as Record<string, string>],
		["MenusKeys", MenusKeys as Record<string, string>],
		["OptionsKeys", OptionsKeys as Record<string, string>],
		["RestaurantsKeys", RestaurantsKeys as Record<string, string>],
		["WelcomeKeys", WelcomeKeys as Record<string, string>],
		["OrderingKeys", OrderingKeys as Record<string, string>],
	])("%s -- all values resolve in en.json and es.json", (name, keys) => {
		expectAllKeysResolve(name, keys);
	});
});
