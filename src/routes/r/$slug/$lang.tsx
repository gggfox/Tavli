import { isSupportedLanguage, replaceLanguageSegment } from "@/global/i18n";
import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Language-scoped customer layout.
 *
 * There is deliberately no `useEffect` here: the root route's `beforeLoad`
 * already reads this `$lang` segment out of the pathname (see
 * `src/global/i18n/language.ts`) and applies it before anything renders, so
 * the SSR pass and the first client render agree. Switching the language
 * after hydration would have re-introduced the flash this route existed to
 * avoid.
 */
export const Route = createFileRoute("/r/$slug/$lang")({
	/**
	 * An unsupported segment (`/r/x/fr/menu`, a typo'd QR, a hand-edited URL)
	 * used to render with `lang = "fr"`, which then flowed into mutations and
	 * localized lookups that only understand `en` / `es`. Redirect it to the
	 * same path in the language the root route already resolved for this
	 * request — the cookie, else English, exactly what the legacy
	 * `/r/$slug/menu` redirect uses. The restaurant's menu `defaultLanguage`
	 * would be a nicer fallback, but it is only known after the `$slug`
	 * loader runs, i.e. after every `beforeLoad`; not worth a waterfall for a
	 * URL nobody should be printing.
	 */
	beforeLoad: ({ params, location, context }) => {
		if (isSupportedLanguage(params.lang)) return;
		throw redirect({
			href: replaceLanguageSegment(location.href, context.language),
			replace: true,
		});
	},
	component: LanguageLayout,
});

function LanguageLayout() {
	return <Outlet />;
}
