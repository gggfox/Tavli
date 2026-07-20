import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import { Languages } from "./keys/languages.ts";
import { LANGUAGE_COOKIE_MINUTES, LANGUAGE_COOKIE_NAME } from "./language.ts";
import enTranslations from "./locales/en.json";
import esTranslations from "./locales/es.json";

i18n
	.use(LanguageDetector)
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
		detection: {
			// Cookie first: it is the only one of these the server can read, so
			// it is what keeps the SSR pass and hydration on the same language.
			// See `language.ts`.
			order: ["cookie", "localStorage", "navigator"],
			// Cache user language preference. Writing both keeps the cookie in
			// sync on every `changeLanguage`, not just the explicit writes.
			caches: ["cookie", "localStorage"],
			// Only detect languages that are in our resources
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
