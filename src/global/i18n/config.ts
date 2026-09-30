import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import { Languages } from "./keys/languages.ts";
import {
	LANGUAGE_COOKIE_MINUTES,
	LANGUAGE_COOKIE_NAME,
	languageFromPathname,
	toSupportedLanguage,
} from "./language.ts";
import enTranslations from "./locales/en.json";
import esTranslations from "./locales/es.json";

/** The diner URL's `:lang` segment, or `null` off `/r/:slug/:lang/*` (and on the server). */
function dinerUrlLanguage() {
	return typeof window === "undefined" ? null : languageFromPathname(window.location.pathname);
}

/**
 * Browser detector that (1) treats a diner URL's `:lang` segment as the
 * first detection source and (2) never persists a language while one is on
 * screen.
 *
 * (1) is the hydration fix. TanStack's client `hydrate()` trusts the context
 * the server's root `beforeLoad` produced and does not run `beforeLoad` again,
 * so nothing calls `changeLanguage` before the first client render — the
 * language React hydrates with is whatever this detector picks at module load.
 * With only cookie → localStorage → navigator, a visitor carrying an `en-US`
 * cookie hydrated `/r/:slug/es/menu` in English: the server rendered Spanish,
 * React hit a text mismatch and re-rendered the tree client-side in English
 * under `<html lang="es">`.
 *
 * (2) is a deliberate persistence decision: opening a diner link is not a
 * preference. A manager who scans their own Spanish QR to check it must not
 * come back to an admin panel that has switched to Spanish, and a diner's
 * cookie should not be flipped by whichever table tent they scanned. The
 * i18next detector otherwise caches on *every* `changeLanguage` — including
 * this initial detection and the root `beforeLoad` on client navigation — so
 * the skip has to live here. The account setting is guarded the same way in
 * `useUserSettings`. Explicit choices still persist: `writeLanguageCookie` is
 * a separate write that does not go through this method.
 */
class AppLanguageDetector extends LanguageDetector {
	override cacheUserLanguage(lng: string, caches?: string[]): void {
		if (dinerUrlLanguage()) return;
		super.cacheUserLanguage(lng, caches);
	}
}

const DINER_URL_DETECTOR = "dinerUrl";

const languageDetector = new AppLanguageDetector();
// Registered before `init`: the detector's own `init` re-adds only the
// built-in lookups, so custom ones survive it.
languageDetector.addDetector({
	name: DINER_URL_DETECTOR,
	lookup: () => dinerUrlLanguage() ?? undefined,
});

i18n
	.use(languageDetector)
	.use(initReactI18next)
	.init({
		resources: {
			[Languages.EN]: {
				translation: enTranslations,
			},
			[Languages.ES]: {
				translation: esTranslations,
			},
		},
		fallbackLng: Languages.EN,
		// Pin `i18n.language` to the two codes we ship. Without this a cached
		// or browser tag like `en-US` / `es-MX` became `i18n.language` verbatim:
		// it still translated (via the `es-MX` → `es` fallback chain) but every
		// `i18n.language === "es"` comparison — and the detector cache — saw a
		// region tag instead.
		supportedLngs: Object.values(Languages),
		detection: {
			// A diner URL's language wins (see `AppLanguageDetector`). Off those
			// routes, cookie first: it is the only one of these the server can
			// read, so it is what keeps the SSR pass and hydration on the same
			// language. See `language.ts`.
			order: [DINER_URL_DETECTOR, "cookie", "localStorage", "navigator"],
			// Collapse each detected tag onto a shipped language *before*
			// i18next picks one. `supportedLngs` alone would scan every candidate
			// for an exact match first, so a navigator `en` could beat an
			// `es-MX` cookie that sits earlier in `order`. Unshipped tags stay as
			// they are and simply never match.
			convertDetectedLanguage: (lng) => toSupportedLanguage(lng) ?? lng,
			// Cache user language preference. Writing both keeps the cookie in
			// sync on every `changeLanguage`, not just the explicit writes.
			caches: ["cookie", "localStorage"],
			lookupLocalStorage: LANGUAGE_COOKIE_NAME,
			lookupCookie: LANGUAGE_COOKIE_NAME,
			cookieMinutes: LANGUAGE_COOKIE_MINUTES,
			cookieOptions: { path: "/", sameSite: "lax" },
		},
		interpolation: {
			escapeValue: false, // React already escapes values
		},
	});

export default i18n;
