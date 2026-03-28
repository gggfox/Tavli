import { type Language, Languages } from "@/global/i18n/locales";
import { Outlet, createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

const supportedLanguages = new Set<string>(Object.values(Languages));

export const Route = createFileRoute("/r/$slug/t/$tableNumber/$lang")({
	component: LanguageLayout,
});

function LanguageLayout() {
	const { lang } = Route.useParams();
	const { i18n } = useTranslation();

	useEffect(() => {
		if (supportedLanguages.has(lang) && i18n.language !== lang) {
			i18n.changeLanguage(lang as Language);
		}
	}, [lang, i18n]);

	return <Outlet />;
}
