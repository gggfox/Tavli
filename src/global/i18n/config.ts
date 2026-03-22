import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import { Languages } from "./locales.ts";
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
			// Order of detection methods
			order: ["localStorage", "navigator"],
			// Cache user language preference
			caches: ["localStorage"],
			// Only detect languages that are in our resources
			lookupLocalStorage: "i18nextLng",
		},
		interpolation: {
			escapeValue: false, // React already escapes values
		},
	});

export default i18n;
