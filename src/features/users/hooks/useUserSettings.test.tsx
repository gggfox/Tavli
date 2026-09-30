/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
/**
 * The account-language sync must not override a diner URL's language.
 *
 * A signed-in manager with an English account who opens their own Spanish QR
 * (`/r/:slug/es/menu`) must see the Spanish menu, and the visit must not
 * rewrite their saved preference or cookie. Off the diner routes the account
 * language still wins, as before.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, LANGUAGE_COOKIE_NAME, Languages, parseLanguageCookie } from "@/global/i18n";

const hoisted = vi.hoisted(() => ({
	pathname: "/",
	settings: null as any,
	mutation: vi.fn(async () => "userSettings:1"),
}));

vi.mock("convex/react", () => ({
	useConvex: () => ({ mutation: hoisted.mutation }),
	useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
}));

vi.mock("@clerk/tanstack-react-start", () => ({
	useUser: () => ({ user: null }),
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: () => ({ queryKey: ["userSettings:get"] }),
}));

vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: hoisted.settings }),
}));

vi.mock("@tanstack/react-router", () => ({
	useRouterState: ({ select }: { select: (state: any) => unknown }) =>
		select({ location: { pathname: hoisted.pathname } }),
}));

import { useUserSettings } from "./useUserSettings";

function accountSettings(language: string) {
	return { _id: "userSettings:1", _creationTime: 0, userId: "user_1", language };
}

function clearLanguageCookie() {
	document.cookie = `${LANGUAGE_COOKIE_NAME}=; path=/; max-age=0`;
}

describe("useUserSettings language sync", () => {
	beforeEach(async () => {
		clearLanguageCookie();
		hoisted.mutation.mockClear();
		hoisted.settings = accountSettings(Languages.EN);
	});
	afterEach(() => {
		clearLanguageCookie();
		window.history.replaceState(null, "", "/");
	});

	it("leaves a diner URL's language on screen for a signed-in user", async () => {
		// What the root `beforeLoad` / the i18n detector applied for the URL.
		hoisted.pathname = "/r/vernaculo-spgg/es/menu";
		window.history.replaceState(null, "", hoisted.pathname);
		await i18n.changeLanguage(Languages.ES);

		renderHook(() => useUserSettings());

		// Give a (wrongly) firing sync effect its chance to run.
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(i18n.language).toBe(Languages.ES);
		expect(parseLanguageCookie(document.cookie)).toBeNull();
		expect(hoisted.mutation).not.toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ language: Languages.ES })
		);
	});

	it("does not save a diner URL's language as a new account's preference", async () => {
		hoisted.settings = null;
		hoisted.pathname = "/r/vernaculo-spgg/es/menu";
		window.history.replaceState(null, "", hoisted.pathname);
		await i18n.changeLanguage(Languages.ES);

		renderHook(() => useUserSettings());

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(hoisted.mutation).not.toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ language: Languages.ES })
		);
	});

	it("still applies the account language off the diner routes", async () => {
		hoisted.pathname = "/admin/menus";
		await i18n.changeLanguage(Languages.ES);

		renderHook(() => useUserSettings());

		await waitFor(() => expect(i18n.language).toBe(Languages.EN));
		expect(parseLanguageCookie(document.cookie)).toBe(Languages.EN);
	});
});
