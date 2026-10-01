/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadStoredPicks, storedPicksKey } from "../utils/storedPicks";
import { CustomerMenuPage } from "./CustomerMenuPage";

const hoisted = vi.hoisted(() => ({
	auth: { isLoaded: true, isSignedIn: false } as { isLoaded: boolean; isSignedIn: boolean },
	session: { sessionId: null, restaurantId: null } as {
		sessionId: string | null;
		restaurantId: string | null;
	},
}));

vi.mock("@tanstack/react-query", () => ({ useQuery: vi.fn(), useQueries: () => [] }));
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: vi.fn((ref, args) => ({ ref, args })),
}));
vi.mock("@clerk/tanstack-react-start", () => ({
	useAuth: () => hoisted.auth,
	// A real <button> child is what the diner taps; the wrapper is Clerk's.
	SignInButton: ({ children }: any) => <>{children}</>,
}));
vi.mock("../hooks/useSession", () => ({ useSessionStore: () => hoisted.session }));
vi.mock("../hooks/useCart", () => ({
	useCart: () => ({ saveDraftFromMenu: vi.fn() }),
}));
vi.mock("@/features/whatsapp", () => ({ WhatsappAssistantLink: () => null }));

/**
 * A restaurant *with* a geofence, so "ordering unavailable" is not what the
 * bar says for an unrelated reason. jsdom has no geolocation, which leaves
 * the geofence at "unavailable" — i.e. not "inside", like a diner who has
 * not been located yet.
 */
const RESTAURANT = {
	_id: "restaurants:test",
	name: "Vernáculo",
	slug: "vernaculo-spgg",
	currency: "MXN",
	isActive: true,
	latitude: 25.65,
	longitude: -100.36,
};

const QUERY_DATA: Record<string, unknown> = {
	"restaurants:getBySlug": RESTAURANT,
	"restaurants:getPaymentsEnabled": true,
	"menus:getMenusByRestaurant": [
		{ _id: "menus:test", name: "Main", isActive: true, displayOrder: 0 },
	],
	"tables:getActiveWithOccupancy": [],
	// Signed in, the menu waits for the session's orders (it seeds picks from
	// the draft); no draft here, so it opens empty.
	"orders:getOrdersBySession": [],
	"menus:getCategoriesByMenu": [{ _id: "menuCategories:test", name: "Starters", displayOrder: 0 }],
	"menuItems:getByMenu": [
		{
			_id: "menuItems:test",
			categoryId: "menuCategories:test",
			restaurantId: "restaurants:test",
			name: "Bruschetta",
			basePrice: 1200,
			isAvailable: true,
			displayOrder: 0,
			createdAt: 0,
			updatedAt: 0,
		},
	],
};

let overrides: Record<string, unknown> = {};

function queriedArgs(name: string): unknown[] {
	return vi
		.mocked(useQuery)
		.mock.calls.map(([options]: any[]) => options)
		.filter((options: any) => options?.ref && getFunctionName(options.ref) === name)
		.map((options: any) => options.args);
}

function renderPage() {
	return render(<CustomerMenuPage slug="vernaculo-spgg" lang="en" onProceedToCheckout={vi.fn()} />);
}

describe("CustomerMenuPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		overrides = {};
		hoisted.auth = { isLoaded: true, isSignedIn: false };
		hoisted.session = { sessionId: null, restaurantId: null };
		vi.mocked(useQuery).mockImplementation((options: any) => {
			const name = options?.ref ? getFunctionName(options.ref) : "";
			return { data: name in overrides ? overrides[name] : QUERY_DATA[name] } as any;
		});
		sessionStorage.clear();
	});

	describe("signed out (browse mode)", () => {
		it("renders the real menu without a Session", () => {
			renderPage();

			expect(screen.getByText("Bruschetta")).toBeInTheDocument();
			// No Session to borrow a restaurant id from: it comes from the slug.
			expect(queriedArgs("menus:getMenusByRestaurant")).toContainEqual({
				restaurantId: "restaurants:test",
			});
		});

		it("puts a sign-in call to action where the order bar would be", () => {
			renderPage();

			expect(screen.getByRole("button", { name: /sign in to order/i })).toBeInTheDocument();
			expect(screen.queryByText(/proceed to payment/i)).toBeNull();
		});

		it("keeps the picks in the browser, so they survive the sign-in redirect", () => {
			renderPage();

			fireEvent.click(screen.getByText("Bruschetta"));
			fireEvent.click(screen.getByText(/add to cart/i));

			expect(loadStoredPicks("vernaculo-spgg")).toEqual([
				{ menuItemId: "menuItems:test", quantity: 1, unitPrice: 1200, selectedOptions: [] },
			]);
		});

		it("holds on to stored picks across a signed-out reload instead of wiping them", () => {
			// Reopened signed out (a reload, or Clerk's "back"): the menu opens
			// holding the picks and writes them straight back for the sign-in.
			const stored = [
				{ menuItemId: "menuItems:test", quantity: 3, unitPrice: 1200, selectedOptions: [] },
			];
			overrides["menuItems:getByRestaurant"] = QUERY_DATA["menuItems:getByMenu"];
			sessionStorage.setItem(
				storedPicksKey("vernaculo-spgg"),
				JSON.stringify({ version: 1, savedAt: Date.now(), lines: stored })
			);

			renderPage();

			expect(loadStoredPicks("vernaculo-spgg")).toEqual(stored);
		});

		it("says ordering is unavailable, not 'sign in', when the restaurant takes no online orders", () => {
			// Signing in would unlock nothing here; asking for an account first
			// would be a promise the restaurant cannot keep.
			overrides["restaurants:getBySlug"] = {
				...RESTAURANT,
				latitude: undefined,
				longitude: undefined,
			};

			renderPage();

			expect(screen.queryByRole("button", { name: /sign in to order/i })).toBeNull();
			expect(screen.getByText("Bruschetta")).toBeInTheDocument();
		});
	});

	describe("signed in", () => {
		it("holds the skeleton until the Session exists", () => {
			hoisted.auth = { isLoaded: true, isSignedIn: true };

			renderPage();

			expect(screen.queryByText("Bruschetta")).toBeNull();
		});

		it("does not keep picks in the browser — the draft is where they live", () => {
			hoisted.auth = { isLoaded: true, isSignedIn: true };
			hoisted.session = { sessionId: "sessions:1", restaurantId: "restaurants:test" };
			renderPage();

			fireEvent.click(screen.getByText("Bruschetta"));
			fireEvent.click(screen.getByText(/add to cart/i));

			expect(loadStoredPicks("vernaculo-spgg")).toBeNull();
		});

		it("never shows the sign-in call to action", () => {
			hoisted.auth = { isLoaded: true, isSignedIn: true };
			hoisted.session = { sessionId: "sessions:1", restaurantId: "restaurants:test" };

			renderPage();

			expect(screen.getByText("Bruschetta")).toBeInTheDocument();
			expect(screen.queryByRole("button", { name: /sign in to order/i })).toBeNull();
		});
	});
});
