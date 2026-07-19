import { Outlet, createFileRoute } from "@tanstack/react-router";

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
	component: LanguageLayout,
});

function LanguageLayout() {
	return <Outlet />;
}
