/**
 * Client boot of the i18next singleton, as it happens on hydration.
 *
 * TanStack's client `hydrate()` trusts the server's `beforeLoad` context and
 * does not re-run the root route's `beforeLoad`, so nothing calls
 * `changeLanguage` before the first client render: whatever the browser
 * detector picks at module load is the language React hydrates with. These
 * tests import `config.ts` fresh against a given URL + browser state and
 * assert the language that first render would see.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { i18n as I18n } from "i18next";
import { CommonKeys } from "./keys/common";
import { Languages } from "./keys/languages";
import { LANGUAGE_COOKIE_NAME, parseLanguageCookie } from "./language";
import esTranslations from "./locales/es.json";

function clearLanguageState() {
	document.cookie = `${LANGUAGE_COOKIE_NAME}=; path=/; max-age=0`;
	localStorage.removeItem(LANGUAGE_COOKIE_NAME);
}

/** Simulate a returning visitor whose browser cached a region tag. */
function seedDetectorCache(value: string) {
	document.cookie = `${LANGUAGE_COOKIE_NAME}=${value}; path=/`;
	localStorage.setItem(LANGUAGE_COOKIE_NAME, value);
}

async function bootI18n(pathname: string): Promise<I18n> {
	window.history.replaceState(null, "", pathname);
	vi.resetModules();
	return (await import("./config")).default;
}

describe("i18n client boot (hydration)", () => {
	beforeEach(() => {
		// Node's own (file-less) `localStorage` global shadows jsdom's.
		const storage = new Map<string, string>();
		vi.stubGlobal("localStorage", {
			getItem: (k: string) => storage.get(k) ?? null,
			setItem: (k: string, v: string) => storage.set(k, v),
			removeItem: (k: string) => storage.delete(k),
		});
		clearLanguageState();
	});
	afterEach(() => {
		clearLanguageState();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		window.history.replaceState(null, "", "/");
	});

	it("renders a Spanish diner URL in Spanish over an en-US cookie + localStorage", async () => {
		seedDetectorCache("en-US");

		const i18n = await bootI18n("/r/vernaculo-spgg/es/menu");

		expect(i18n.language).toBe(Languages.ES);
		expect(i18n.t(CommonKeys.BUTTON_SAVED)).toBe(esTranslations.common.button.saved);
	});

	it("does not persist the diner URL's language over the visitor's preference", async () => {
		seedDetectorCache("en-US");

		const i18n = await bootI18n("/r/vernaculo-spgg/es/menu");
		await i18n.changeLanguage(Languages.ES);

		expect(parseLanguageCookie(document.cookie)).toBe(Languages.EN);
		expect(localStorage.getItem(LANGUAGE_COOKIE_NAME)).toBe("en-US");
	});

	it("keeps cookie -> localStorage -> navigator detection off the diner routes", async () => {
		seedDetectorCache("es-MX");

		const i18n = await bootI18n("/admin/menus");

		expect(i18n.language).toBe(Languages.ES);
	});

	it("normalizes a detected region tag onto a supported base language", async () => {
		vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["es-MX", "en-US"]);
		vi.spyOn(window.navigator, "language", "get").mockReturnValue("es-MX");

		const i18n = await bootI18n("/admin/menus");

		expect(i18n.language).toBe(Languages.ES);
		// Caches the normalized code, so the next SSR pass reads `es`.
		expect(localStorage.getItem(LANGUAGE_COOKIE_NAME)).toBe(Languages.ES);
	});

	it("normalizes an en-US cookie to en rather than an unshipped region code", async () => {
		seedDetectorCache("en-US");

		const i18n = await bootI18n("/admin/menus");

		expect(i18n.language).toBe(Languages.EN);
	});

	it("falls back to en for a language the app does not ship", async () => {
		seedDetectorCache("fr-FR");
		vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["fr-FR"]);

		const i18n = await bootI18n("/admin/menus");

		expect(i18n.language).toBe(Languages.EN);
	});
});
