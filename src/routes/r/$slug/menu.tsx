import { CustomerMenuPage } from "@/features/ordering";
import { type Language, Languages } from "@/global/i18n";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

const SUPPORTED_LANGUAGES = new Set<string>(Object.values(Languages));

export const Route = createFileRoute("/r/$slug/menu")({
	component: Page,
});

function resolveLang(raw: string): Language {
	const normalized = raw.split("-")[0];
	return SUPPORTED_LANGUAGES.has(normalized) ? (normalized as Language) : Languages.EN;
}

function Page() {
	const { slug } = Route.useParams();
	const navigate = useNavigate();
	const { i18n } = useTranslation();

	return (
		<CustomerMenuPage
			onNavigateToCheckout={(orderId) => {
				const lang = resolveLang(i18n.language);
				navigate({
					to: "/r/$slug/$lang/checkout",
					params: { slug, lang },
					search: { orderId },
				});
			}}
		/>
	);
}
