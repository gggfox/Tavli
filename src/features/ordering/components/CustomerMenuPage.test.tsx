/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionStore } from "../hooks/useSession";
import { storedPicksKey } from "../utils/storedPicks";
import { CustomerMenuPage } from "./CustomerMenuPage";

const saveDraftFromMenu = vi.fn();

vi.mock("@tanstack/react-query", () => ({
	useQuery: vi.fn(),
	useQueries: vi.fn(),
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: vi.fn((ref, args) => ({ ref, args })),
}));

// Every case here is a signed-in diner ordering; browse mode (signed out) has
// its own file, CustomerMenuPage.browse.test.tsx.
vi.mock("@clerk/tanstack-react-start", () => ({
	useAuth: () => ({ isLoaded: true, isSignedIn: true }),
}));

vi.mock("../hooks/useCart", () => ({
	useCart: () => ({ saveDraftFromMenu }),
}));

vi.mock("../hooks/useGeofence", () => ({
	useGeofence: () => ({ status: "inside", retry: () => {}, bypass: () => {} }),
	showsGeofenceNotice: () => false,
}));

vi.mock("../hooks/useBranding", () => ({
	useBranding: () => null,
}));

vi.mock("./MenuHero", () => ({ MenuHero: () => null }));
vi.mock("./RestaurantContactBar", () => ({ RestaurantContactBar: () => null }));
vi.mock("@/features/whatsapp", () => ({ WhatsappAssistantLink: () => null }));

vi.mock("./ItemDetailSheet", () => ({
	ItemDetailSheet: ({ item, onAddToCart }: any) => (
		<button
			onClick={() =>
				onAddToCart({
					menuItemId: item._id,
					quantity: 1,
					basePrice: item.basePrice,
					selectedOptions: new Map(),
				})
			}
		>
			Add mocked item
		</button>
	),
}));

const verde = {
	optionGroupId: "optionGroups:salsa",
	optionGroupName: "Salsa",
	optionId: "options:verde",
	optionName: "Verde",
	priceModifier: 150,
};
const roja = { ...verde, optionId: "options:roja", optionName: "Roja" };

/** A draft the old append path duplicated: tacos twice, two different ways. */
const DRAFT = {
	_id: "orders:draft",
	status: "draft",
	tableId: "tables:two",
	specialInstructions: "No onion",
	totalAmount: 2300,
	items: [
		{ menuItemId: "menuItems:tacos", quantity: 1, unitPrice: 1000, selectedOptions: [verde] },
		{ menuItemId: "menuItems:tacos", quantity: 1, unitPrice: 1000, selectedOptions: [roja] },
	],
};

const QUERY_DATA: Record<string, unknown> = {
	"restaurants:getBySlug": null,
	"restaurants:getPaymentsEnabled": true,
	"menus:getMenusByRestaurant": [
		{ _id: "menus:main", name: "Main", isActive: true, displayOrder: 0 },
	],
	"tables:getActiveWithOccupancy": [
		{ _id: "tables:one", tableNumber: 1, hasOpenSession: false, isOwnSession: false },
		{ _id: "tables:two", tableNumber: 2, hasOpenSession: true, isOwnSession: true },
	],
	"menus:getCategoriesByMenu": [{ _id: "menuCategories:mains", name: "Mains", displayOrder: 0 }],
	"menuItems:getByMenu": [
		{
			_id: "menuItems:soup",
			categoryId: "menuCategories:mains",
			restaurantId: "restaurants:casa",
			name: "Soup",
			basePrice: 600,
			isAvailable: true,
			displayOrder: 0,
		},
	],
	"menuItemPopularity:getPopularItemIds": [],
	"orders:getOrdersBySession": [DRAFT],
	// What restored picks are checked against: every public dish, any menu.
	"menuItems:getByRestaurant": [
		{ _id: "menuItems:tacos", basePrice: 1000, isAvailable: true },
		{ _id: "menuItems:soup", basePrice: 600, isAvailable: true },
	],
};

/** `optionGroups.getGroupsForMenuItem`, by dish. */
const OPTION_GROUPS: Record<string, unknown> = {
	"menuItems:tacos": [
		{
			_id: "optionGroups:salsa",
			name: "Salsa",
			options: [
				{ _id: "options:verde", name: "Verde", isAvailable: true, priceModifier: 150 },
				{ _id: "options:roja", name: "Roja", isAvailable: true, priceModifier: 150 },
			],
		},
	],
};

/** What a signed-out diner left in the browser before the sign-in redirect. */
function storePicks(lines: unknown[], savedAt = Date.now()) {
	sessionStorage.setItem(storedPicksKey("casa"), JSON.stringify({ version: 1, savedAt, lines }));
}

let overrides: Record<string, unknown> = {};

function renderPage(onProceedToCheckout = vi.fn()) {
	render(<CustomerMenuPage slug="casa" lang="en" onProceedToCheckout={onProceedToCheckout} />);
	return onProceedToCheckout;
}

/** Opens the review panel (table, notes, confirm) from the collapsed order bar. */
function openPayFlow() {
	fireEvent.click(screen.getByText("Proceed to Payment"));
	return screen.getByRole("combobox") as HTMLSelectElement;
}

function confirmOrder() {
	fireEvent.click(screen.getAllByText("Proceed to Payment").at(-1) as HTMLElement);
}

describe("CustomerMenuPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		overrides = {};
		useSessionStore.setState({
			sessionId: "sessions:visit" as any,
			restaurantId: "restaurants:casa" as any,
		});
		vi.mocked(useQuery).mockImplementation((options: any) => {
			const name = options?.ref ? getFunctionName(options.ref) : "";
			return { data: name in overrides ? overrides[name] : QUERY_DATA[name] } as any;
		});
		vi.mocked(useQueries).mockImplementation(
			({ queries }: any) =>
				queries.map((q: any) => ({ data: OPTION_GROUPS[q.args.menuItemId] })) as any
		);
		sessionStorage.clear();
	});

	it("waits for the session's orders before showing the menu, since it seeds from them", () => {
		overrides["orders:getOrdersBySession"] = undefined;
		renderPage();
		expect(screen.queryByText("Proceed to Payment")).not.toBeInTheDocument();
	});

	it("opens holding the draft's picks, table and notes, and resends all of them", async () => {
		saveDraftFromMenu.mockResolvedValue(["orders:draft", null]);
		const onProceed = renderPage();

		// Both ways of ordering the tacos survive the seed.
		expect(screen.getByText("Total (2 items)")).toBeInTheDocument();
		expect(openPayFlow().value).toBe("tables:two");
		expect(screen.getByDisplayValue("No onion")).toBeInTheDocument();

		confirmOrder();

		await waitFor(() => expect(onProceed).toHaveBeenCalledWith("orders:draft"));
		expect(saveDraftFromMenu).toHaveBeenCalledTimes(1);
		const args = saveDraftFromMenu.mock.calls[0][0];
		expect(args).toMatchObject({
			sessionId: "sessions:visit",
			tableId: "tables:two",
			specialInstructions: "No onion",
			lang: "en",
		});
		expect(args.items).toEqual([
			{ menuItemId: "menuItems:tacos", quantity: 1, selectedOptions: [verde] },
			{ menuItemId: "menuItems:tacos", quantity: 1, selectedOptions: [roja] },
		]);
	});

	it("shows why a refused submit failed, and offers to take off the dish that was refused", async () => {
		// The dish was switched off after it was picked: it has left the menu
		// listing, so the error is the only place it can still be removed.
		saveDraftFromMenu.mockResolvedValue([
			null,
			{ name: "VALIDATION_ERROR", message: "items.0: ERROR_MENU_ITEM_UNAVAILABLE" },
		]);
		const onProceed = renderPage();
		openPayFlow();

		confirmOrder();

		const alert = await screen.findByRole("alert");
		expect(alert).toHaveTextContent(
			"One of your dishes is no longer available. Remove it and try again."
		);
		expect(onProceed).not.toHaveBeenCalled();

		fireEvent.click(screen.getByText("Remove it from my order"));

		// Every way the tacos were ordered goes, and the error goes with them.
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
		expect(screen.getByText("Tap on items to start your order")).toBeInTheDocument();
	});

	it("shows a generic retry message when the call itself fails, and lets the diner retry", async () => {
		saveDraftFromMenu.mockRejectedValueOnce(new Error("Failed to fetch"));
		saveDraftFromMenu.mockResolvedValueOnce(["orders:draft", null]);
		const onProceed = renderPage();
		openPayFlow();

		confirmOrder();

		const alert = await screen.findByRole("alert");
		expect(alert).toHaveTextContent(
			"We couldn't save your order. Check your connection and try again."
		);
		// Nothing about the refusal names a dish, so nothing is offered for removal.
		expect(screen.queryByText("Remove it from my order")).not.toBeInTheDocument();

		confirmOrder();
		await waitFor(() => expect(onProceed).toHaveBeenCalledWith("orders:draft"));
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});

	it("maps an ended visit to its own message", async () => {
		saveDraftFromMenu.mockResolvedValue([
			null,
			{ name: "NOT_FOUND", message: "ERROR_ORDER_SESSION_ENDED" },
		]);
		renderPage();
		openPayFlow();

		confirmOrder();

		expect(await screen.findByRole("alert")).toHaveTextContent("This visit has ended.");
	});

	it("starts empty when the session has no draft", () => {
		overrides["orders:getOrdersBySession"] = [];
		renderPage();
		expect(screen.getByText("Tap on items to start your order")).toBeInTheDocument();
	});

	describe("picks kept across sign-in", () => {
		const STORED = [
			{ menuItemId: "menuItems:tacos", quantity: 2, unitPrice: 1000, selectedOptions: [verde] },
			{ menuItemId: "menuItems:soup", quantity: 1, unitPrice: 600, selectedOptions: [] },
		];

		it("opens holding the picks made signed out when the session has no draft", async () => {
			overrides["orders:getOrdersBySession"] = [];
			storePicks(STORED);
			saveDraftFromMenu.mockResolvedValue(["orders:new", null]);
			const onProceed = renderPage();

			expect(screen.getByText("Total (2 items)")).toBeInTheDocument();
			// Consumed: a reload must not bring them back a second time.
			expect(sessionStorage.getItem(storedPicksKey("casa"))).toBeNull();
			// Restoring is not ordering — nothing is saved until the diner submits.
			expect(saveDraftFromMenu).not.toHaveBeenCalled();
			expect(screen.queryByRole("status")).not.toBeInTheDocument();

			fireEvent.change(openPayFlow(), { target: { value: "tables:one" } });
			confirmOrder();

			await waitFor(() => expect(onProceed).toHaveBeenCalledWith("orders:new"));
			expect(saveDraftFromMenu.mock.calls[0][0].items).toEqual([
				{ menuItemId: "menuItems:tacos", quantity: 2, selectedOptions: [verde] },
				{ menuItemId: "menuItems:soup", quantity: 1, selectedOptions: [] },
			]);
		});

		it("lets an existing draft win, and discards the stored picks", () => {
			storePicks([STORED[1]]);
			renderPage();

			// The draft's two ways of ordering the tacos — not the stored soup.
			expect(screen.getByText("Total (2 items)")).toBeInTheDocument();
			expect(openPayFlow().value).toBe("tables:two");
			expect(sessionStorage.getItem(storedPicksKey("casa"))).toBeNull();
		});

		it("says when stored picks had to be dropped, and lets the diner dismiss it", () => {
			overrides["orders:getOrdersBySession"] = [];
			overrides["menuItems:getByRestaurant"] = [
				{ _id: "menuItems:tacos", basePrice: 1000, isAvailable: true },
			];
			storePicks(STORED);
			renderPage();

			expect(screen.getByText("Total (1 item)")).toBeInTheDocument();
			expect(screen.getByRole("status")).toHaveTextContent(
				"Some dishes you picked are no longer available, so we removed them."
			);

			fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
			expect(screen.queryByRole("status")).not.toBeInTheDocument();
		});

		it("ignores expired picks", () => {
			overrides["orders:getOrdersBySession"] = [];
			storePicks(STORED, Date.now() - 3 * 60 * 60 * 1000);
			renderPage();

			expect(screen.getByText("Tap on items to start your order")).toBeInTheDocument();
		});
	});
});
