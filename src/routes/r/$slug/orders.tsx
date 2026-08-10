import { resolveLanguage } from "@/global/i18n";
import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Legacy unlocalized route. Customer pages live under `/r/$slug/$lang/*`;
 * this redirects using the same resolution the root layout applies (URL
 * segment — none here — then the language cookie, then English).
 */
export const Route = createFileRoute("/r/$slug/orders")({
	beforeLoad: async ({ params, location }) => {
		const lang = await resolveLanguage(location.pathname);
		throw redirect({
			to: "/r/$slug/$lang/orders",
			params: { slug: params.slug, lang },
		});
	},
});
