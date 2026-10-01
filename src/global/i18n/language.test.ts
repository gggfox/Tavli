import { describe, expect, it } from "vitest";
import { Languages } from "./keys/languages";
import {
	LANGUAGE_COOKIE_NAME,
	isSupportedLanguage,
	languageFromPathname,
	normalizeLanguage,
	parseLanguageCookie,
	readLanguageCookie,
	replaceLanguageSegment,
	resolveLanguage,
	toSupportedLanguage,
	writeLanguageCookie,
} from "./language";

describe("normalizeLanguage", () => {
	it("collapses regional Spanish tags onto es", () => {
		expect(normalizeLanguage("es")).toBe(Languages.ES);
		expect(normalizeLanguage("es-MX")).toBe(Languages.ES);
		expect(normalizeLanguage("es-419")).toBe(Languages.ES);
	});

	it("falls back to en for everything else", () => {
		expect(normalizeLanguage("en-US")).toBe(Languages.EN);
		expect(normalizeLanguage("fr")).toBe(Languages.EN);
		expect(normalizeLanguage("")).toBe(Languages.EN);
		expect(normalizeLanguage(null)).toBe(Languages.EN);
		expect(normalizeLanguage(undefined)).toBe(Languages.EN);
	});
});

describe("isSupportedLanguage", () => {
	it("only accepts exact supported codes", () => {
		expect(isSupportedLanguage("en")).toBe(true);
		expect(isSupportedLanguage("es")).toBe(true);
		expect(isSupportedLanguage("es-MX")).toBe(false);
		expect(isSupportedLanguage("de")).toBe(false);
		expect(isSupportedLanguage(undefined)).toBe(false);
	});
});

describe("languageFromPathname", () => {
	it("reads the /r/:slug/:lang segment", () => {
		expect(languageFromPathname("/r/tavli/es/menu")).toBe(Languages.ES);
		expect(languageFromPathname("/r/tavli/en")).toBe(Languages.EN);
		expect(languageFromPathname("/r/tavli/es/orders")).toBe(Languages.ES);
	});

	it("returns null when the segment is not a language", () => {
		// `/r/:slug/menu` is a sibling route, not a language-scoped one.
		expect(languageFromPathname("/r/tavli/menu")).toBeNull();
		expect(languageFromPathname("/r/tavli/reserve")).toBeNull();
		expect(languageFromPathname("/r/tavli")).toBeNull();
	});

	it("returns null for non-customer routes", () => {
		expect(languageFromPathname("/")).toBeNull();
		expect(languageFromPathname("/admin/menus/es")).toBeNull();
	});
});

describe("toSupportedLanguage", () => {
	it("collapses region tags onto the shipped base language", () => {
		expect(toSupportedLanguage("es-MX")).toBe(Languages.ES);
		expect(toSupportedLanguage("en-US")).toBe(Languages.EN);
		expect(toSupportedLanguage("ES_es")).toBe(Languages.ES);
		expect(toSupportedLanguage("es")).toBe(Languages.ES);
	});

	it("keeps unshipped languages unmatched instead of forcing en", () => {
		expect(toSupportedLanguage("fr-FR")).toBeNull();
		expect(toSupportedLanguage("")).toBeNull();
		expect(toSupportedLanguage(undefined)).toBeNull();
	});
});

describe("replaceLanguageSegment (unsupported :lang redirect target)", () => {
	it("swaps only the :lang segment and keeps the rest of the path", () => {
		expect(replaceLanguageSegment("/r/vernaculo-spgg/fr/menu", Languages.EN)).toBe(
			"/r/vernaculo-spgg/en/menu"
		);
		expect(replaceLanguageSegment("/r/vernaculo-spgg/fr/order/abc?table=4#top", Languages.ES)).toBe(
			"/r/vernaculo-spgg/es/order/abc?table=4#top"
		);
		expect(replaceLanguageSegment("/r/vernaculo-spgg/fr", Languages.ES)).toBe(
			"/r/vernaculo-spgg/es"
		);
	});

	it("leaves non-diner paths alone", () => {
		expect(replaceLanguageSegment("/admin/menus/fr", Languages.EN)).toBe("/admin/menus/fr");
	});
});

describe("parseLanguageCookie", () => {
	it("finds the language cookie among others", () => {
		expect(parseLanguageCookie(`theme=dark; ${LANGUAGE_COOKIE_NAME}=es; other=1`)).toBe(
			Languages.ES
		);
	});

	it("normalizes the stored value", () => {
		expect(parseLanguageCookie(`${LANGUAGE_COOKIE_NAME}=es-MX`)).toBe(Languages.ES);
		expect(parseLanguageCookie(`${LANGUAGE_COOKIE_NAME}=en-GB`)).toBe(Languages.EN);
	});

	it("ignores cookies whose name merely contains the key", () => {
		expect(parseLanguageCookie(`not_${LANGUAGE_COOKIE_NAME}=es`)).toBeNull();
	});

	it("returns null when absent or empty", () => {
		expect(parseLanguageCookie("theme=dark")).toBeNull();
		expect(parseLanguageCookie(`${LANGUAGE_COOKIE_NAME}=`)).toBeNull();
		expect(parseLanguageCookie("")).toBeNull();
		expect(parseLanguageCookie(undefined)).toBeNull();
	});
});

describe("resolveLanguage (browser)", () => {
	function clearLanguageCookie() {
		document.cookie = `${LANGUAGE_COOKIE_NAME}=; path=/; max-age=0`;
	}

	it("reads the cookie written by writeLanguageCookie", async () => {
		clearLanguageCookie();
		writeLanguageCookie(Languages.ES);
		await expect(readLanguageCookie()).resolves.toBe(Languages.ES);
		clearLanguageCookie();
	});

	it("prefers the URL segment over the cookie", async () => {
		clearLanguageCookie();
		writeLanguageCookie(Languages.ES);
		await expect(resolveLanguage("/r/tavli/en/menu")).resolves.toBe(Languages.EN);
		clearLanguageCookie();
	});

	it("prefers a Spanish URL over an en-US cookie", async () => {
		clearLanguageCookie();
		document.cookie = `${LANGUAGE_COOKIE_NAME}=en-US; path=/`;
		await expect(resolveLanguage("/r/vernaculo-spgg/es/menu")).resolves.toBe(Languages.ES);
		clearLanguageCookie();
	});

	it("resolves an unsupported :lang segment to the cookie, the redirect's fallback", async () => {
		clearLanguageCookie();
		document.cookie = `${LANGUAGE_COOKIE_NAME}=es-MX; path=/`;
		await expect(resolveLanguage("/r/vernaculo-spgg/fr/menu")).resolves.toBe(Languages.ES);
		clearLanguageCookie();
		await expect(resolveLanguage("/r/vernaculo-spgg/fr/menu")).resolves.toBe(Languages.EN);
	});

	it("falls back to the cookie off the language-scoped routes", async () => {
		clearLanguageCookie();
		writeLanguageCookie(Languages.ES);
		await expect(resolveLanguage("/admin/menus")).resolves.toBe(Languages.ES);
		clearLanguageCookie();
	});

	it("falls back to en when nothing is set", async () => {
		clearLanguageCookie();
		await expect(resolveLanguage("/admin/menus")).resolves.toBe(Languages.EN);
	});
});
