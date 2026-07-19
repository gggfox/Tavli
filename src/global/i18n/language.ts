/**
 * Language resolution shared by the SSR pass and the browser.
 *
 * The i18next browser detector only ever sees `localStorage` / `navigator`,
 * neither of which exists on the server, so SSR used to always resolve to
 * `fallbackLng` (`en`). A returning Spanish user then hydrated to `es`, which
 * flipped `<html lang>` and every translated string on first paint.
 *
 * The fix is a cookie: it is the only client-persisted preference the server
 * can read. This module owns the cookie name/format so the detector
 * (`config.ts`), the SSR reader (root route) and the explicit writers
 * (settings modal) cannot drift apart.
 */
import { type Language, Languages } from "./keys/languages";

/**
 * Cookie the language preference is persisted under. Deliberately the same
 * name as the localStorage key so the two caches read as one preference.
 */
export const LANGUAGE_COOKIE_NAME = "i18nextLng";

/** One year, in minutes (i18next detector) and seconds (`document.cookie`). */
export const LANGUAGE_COOKIE_MINUTES = 525_600;
const LANGUAGE_COOKIE_MAX_AGE_SECONDS = LANGUAGE_COOKIE_MINUTES * 60;

const SUPPORTED_LANGUAGES = new Set<string>(Object.values(Languages));

/**
 * Collapse a BCP-47 tag onto the two languages the app actually ships
 * (`en-US` -> `en`, `es-MX` -> `es`). Anything unrecognised falls back to
 * English, matching `fallbackLng`.
 */
export function normalizeLanguage(lang: string | null | undefined): Language {
	return lang?.startsWith("es") ? Languages.ES : Languages.EN;
}

/** True only for an exact supported code (`en` / `es`) — no tag collapsing. */
export function isSupportedLanguage(value: string | null | undefined): value is Language {
	return !!value && SUPPORTED_LANGUAGES.has(value);
}

/**
 * Customer-facing menus live at `/r/:slug/:lang/...`, where the URL segment
 * is the authoritative choice — a QR code printed in Spanish must render in
 * Spanish regardless of what the visitor's cookie says. Returns `null` for
 * every other route so the caller can fall back to the cookie.
 */
export function languageFromPathname(pathname: string): Language | null {
	const segment = /^\/r\/[^/]+\/([^/]+)/.exec(pathname)?.[1];
	return isSupportedLanguage(segment) ? segment : null;
}

/** Parse a raw `Cookie:` header (or `document.cookie`) for the language. */
export function parseLanguageCookie(cookieHeader: string | null | undefined): Language | null {
	if (!cookieHeader) return null;
	for (const part of cookieHeader.split(";")) {
		const separator = part.indexOf("=");
		if (separator === -1) continue;
		if (part.slice(0, separator).trim() !== LANGUAGE_COOKIE_NAME) continue;
		const value = decodeURIComponent(part.slice(separator + 1).trim());
		return value ? normalizeLanguage(value) : null;
	}
	return null;
}

/**
 * Read the language cookie from wherever we happen to be running.
 *
 * The `import.meta.env.SSR` branch is replaced with a literal by Vite, so the
 * dynamic import of the server-only module is dead code in the client bundle.
 */
export async function readLanguageCookie(): Promise<Language | null> {
	if (import.meta.env.SSR) {
		try {
			const { getCookie } = await import("@tanstack/react-start/server");
			const value = getCookie(LANGUAGE_COOKIE_NAME);
			return value ? normalizeLanguage(value) : null;
		} catch {
			// No request context (prerender, tests) — fall through to the default.
			return null;
		}
	}
	return typeof document === "undefined" ? null : parseLanguageCookie(document.cookie);
}

/**
 * Persist the language so the *next* SSR pass renders in it. The i18next
 * detector also caches to this cookie, but writing it explicitly keeps the
 * guarantee at the call site that changes the language.
 */
export function writeLanguageCookie(language: Language): void {
	if (typeof document === "undefined") return;
	document.cookie = `${LANGUAGE_COOKIE_NAME}=${encodeURIComponent(language)}; path=/; max-age=${LANGUAGE_COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
}

/**
 * The single language decision for a request: URL segment wins, then the
 * cookie, then English.
 */
export async function resolveLanguage(pathname: string): Promise<Language> {
	return languageFromPathname(pathname) ?? (await readLanguageCookie()) ?? Languages.EN;
}
