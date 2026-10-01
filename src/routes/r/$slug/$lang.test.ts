/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, boundaries/element-types, @typescript-eslint/no-explicit-any */
/**
 * An unsupported `:lang` segment redirects to the same path in the language
 * the root route resolved (cookie, else English) instead of rendering with a
 * `lang` param nothing downstream understands.
 */
import { isRedirect } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { Languages } from "@/global/i18n";
import { Route } from "./$lang";

function runBeforeLoad(lang: string, href: string, language: string) {
	return (Route.options.beforeLoad as any)({
		params: { slug: "vernaculo-spgg", lang },
		location: { href, pathname: href.split(/[?#]/)[0] },
		context: { language },
	});
}

function redirectTarget(lang: string, href: string, language: string): string | undefined {
	try {
		runBeforeLoad(lang, href, language);
	} catch (thrown) {
		if (isRedirect(thrown)) return thrown.options.href;
		throw thrown;
	}
	return undefined;
}

describe("/r/$slug/$lang beforeLoad", () => {
	it("redirects an unknown language to the resolved one, keeping path + query", () => {
		expect(redirectTarget("fr", "/r/vernaculo-spgg/fr/menu?table=4", Languages.EN)).toBe(
			"/r/vernaculo-spgg/en/menu?table=4"
		);
		expect(redirectTarget("fr", "/r/vernaculo-spgg/fr/menu", Languages.ES)).toBe(
			"/r/vernaculo-spgg/es/menu"
		);
	});

	it("rejects region tags too — only the exact shipped codes are valid URLs", () => {
		expect(redirectTarget("es-MX", "/r/vernaculo-spgg/es-MX/menu", Languages.ES)).toBe(
			"/r/vernaculo-spgg/es/menu"
		);
	});

	it("lets a supported language through", () => {
		expect(redirectTarget("es", "/r/vernaculo-spgg/es/menu", Languages.EN)).toBeUndefined();
		expect(redirectTarget("en", "/r/vernaculo-spgg/en/menu", Languages.ES)).toBeUndefined();
	});
});
