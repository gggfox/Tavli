/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { getFunctionName } from "convex/server";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { MenuBrowser } from "./MenuBrowser";

vi.mock("@tanstack/react-query", () => ({
	useQuery: vi.fn(),
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: vi.fn((ref, args) => ({ ref, args })),
}));

vi.mock("./ItemDetailSheet", () => ({
	ItemDetailSheet: ({ item, onAddToCart }: any) => (
		<div>
			<p>{item.name}</p>
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
		</div>
	),
}));

describe("MenuBrowser", () => {
	// Keyed on the Convex function *name* rather than call order, so the mock
	// survives the component changing how many queries it issues. That matters
	// here: the per-category `menuItems.getByCategory` fan-out was replaced by
	// a single batched `menuItems.getByMenu` subscription. (`api` is a proxy —
	// `api.x.y !== api.x.y` — so references cannot be compared by identity.)
	const QUERY_DATA: Record<string, unknown> = {
		"restaurants:getPaymentsEnabled": false,
		"menus:getMenusByRestaurant": [
			{ _id: "menus:test", name: "Main", isActive: true, displayOrder: 0 },
		],
		// TAVLI-83: the picker reads the occupancy-aware sibling query. Table 2 is
		// held by someone else's visit; table 3 is the caller's own tab.
		"tables:getActiveWithOccupancy": [
			{ _id: "tables:free", tableNumber: 1, hasOpenSession: false, isOwnSession: false },
			{ _id: "tables:taken", tableNumber: 2, hasOpenSession: true, isOwnSession: false },
			{ _id: "tables:mine", tableNumber: 3, hasOpenSession: true, isOwnSession: true },
		],
		"menus:getCategoriesByMenu": [
			{ _id: "menuCategories:test", name: "Starters", displayOrder: 0 },
		],
		"menuItems:getByMenu": [
			{
				_id: "menuItems:test",
				categoryId: "menuCategories:test",
				restaurantId: "restaurants:test",
				name: "Bruschetta",
				basePrice: 1200,
				isAvailable: true,
				displayOrder: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			},
		],
	};

	function queriedFunctionNames(): string[] {
		return vi
			.mocked(useQuery)
			.mock.calls.map(([options]: any[]) => options?.ref)
			.filter(Boolean)
			.map((ref: any) => getFunctionName(ref));
	}

	/** Per-test query answers, layered over QUERY_DATA and cleared between tests. */
	let overrides: Record<string, unknown> = {};

	beforeEach(() => {
		vi.clearAllMocks();
		overrides = {};
		vi.mocked(useQuery).mockImplementation((options: any) => {
			const name = options?.ref ? getFunctionName(options.ref) : "";
			return { data: name in overrides ? overrides[name] : QUERY_DATA[name] } as any;
		});
	});

	/** Adds one item and opens the review/pay panel that holds the table picker. */
	async function openPayFlow() {
		fireEvent.click(screen.getByText("Bruschetta"));
		fireEvent.click(screen.getByText("Add mocked item"));
		const cta = await screen.findAllByText("Proceed to Payment");
		fireEvent.click(cta.at(-1) as HTMLElement);
		return (await screen.findByRole("combobox")) as HTMLSelectElement;
	}

	it("issues exactly one item subscription for the whole menu", () => {
		render(
			<MenuBrowser
				restaurantId={"restaurants:test" as any}
				onSubmitOrder={() => {}}
				isSubmitting={false}
			/>
		);

		// Counted per render pass (React may render more than once), so the
		// assertions are on ratios rather than absolute call counts.
		const names = queriedFunctionNames();
		const count = (name: string) => names.filter((n) => n === name).length;

		// The per-category fan-out is gone: items come from one batched query.
		expect(names).not.toContain("menuItems:getByCategory");
		expect(count("menuItems:getByMenu")).toBeGreaterThan(0);
		// Exactly one items subscription per render, no matter how many
		// categories the menu has.
		expect(count("menuItems:getByMenu")).toBe(count("menus:getMenusByRestaurant"));
		// And the parent no longer duplicates the child's categories query.
		expect(count("menus:getCategoriesByMenu")).toBe(count("menus:getMenusByRestaurant"));
	});

	it("blocks the payment CTA when restaurant payments are disabled", async () => {
		render(
			<MenuBrowser
				restaurantId={"restaurants:test" as any}
				onSubmitOrder={() => {}}
				isSubmitting={false}
			/>
		);

		fireEvent.click(screen.getByText("Bruschetta"));
		fireEvent.click(screen.getByText("Add mocked item"));

		await waitFor(() => {
			expect(
				screen.getByText("Online ordering is not available at this restaurant yet.")
			).toBeTruthy();
		});

		const proceedButtons = screen.getAllByText("Proceed to Payment");
		const paymentButton = proceedButtons.at(-1) as HTMLButtonElement;
		expect(paymentButton.disabled).toBe(true);
	});

	it("shows blocked notice instead of order controls when ordering is blocked", async () => {
		render(
			<MenuBrowser
				restaurantId={"restaurants:test" as any}
				onSubmitOrder={() => {}}
				isSubmitting={false}
				orderingBlocked
				blockedNotice={<p>Ordering unavailable</p>}
			/>
		);

		fireEvent.click(screen.getByText("Bruschetta"));
		fireEvent.click(screen.getByText("Add mocked item"));

		await waitFor(() => {
			expect(screen.getByText("Ordering unavailable")).toBeTruthy();
		});
		expect(screen.queryByText("Proceed to Payment")).toBeNull();
	});

	it("renders no footer while ordering is blocked without a notice (checking)", async () => {
		render(
			<MenuBrowser
				restaurantId={"restaurants:test" as any}
				onSubmitOrder={() => {}}
				isSubmitting={false}
				orderingBlocked
			/>
		);

		fireEvent.click(screen.getByText("Bruschetta"));
		fireEvent.click(screen.getByText("Add mocked item"));

		await waitFor(() => {
			expect(screen.queryByText("Proceed to Payment")).toBeNull();
		});
		expect(screen.queryByText("Tap items to start your order")).toBeNull();
	});

	describe("table occupancy (TAVLI-83)", () => {
		it("disables a table held by someone else's visit and points at the join code", async () => {
			overrides["restaurants:getPaymentsEnabled"] = true;
			render(
				<MenuBrowser
					restaurantId={"restaurants:test" as any}
					onSubmitOrder={() => {}}
					isSubmitting={false}
				/>
			);

			const select = await openPayFlow();
			const options = within(select).getAllByRole("option") as HTMLOptionElement[];
			const byLabel = (needle: string) => options.find((o) => o.textContent?.includes(needle))!;

			expect(byLabel("Table 2").disabled).toBe(true);
			expect(byLabel("Table 2").textContent).toContain("(taken)");
			// The diner's own tab sits at table 3 — their second round must not be
			// locked out of their own table.
			expect(byLabel("Table 3").disabled).toBe(false);
			expect(byLabel("Table 3").textContent).not.toContain("(taken)");
			expect(byLabel("Table 1").disabled).toBe(false);

			expect(screen.getByText(/Ask whoever is sitting there for their join code/)).toBeTruthy();
		});

		it("blocks the order when the picked table is taken between picking and paying", async () => {
			overrides["restaurants:getPaymentsEnabled"] = true;
			overrides["tables:getActiveWithOccupancy"] = [
				{ _id: "tables:free", tableNumber: 1, hasOpenSession: false, isOwnSession: false },
			];
			const onSubmitOrder = vi.fn();
			const { rerender } = render(
				<MenuBrowser
					restaurantId={"restaurants:test" as any}
					onSubmitOrder={onSubmitOrder}
					isSubmitting={false}
				/>
			);

			const select = await openPayFlow();
			fireEvent.change(select, { target: { value: "tables:free" } });

			// Someone else claims it while the diner is still reviewing.
			overrides["tables:getActiveWithOccupancy"] = [
				{ _id: "tables:free", tableNumber: 1, hasOpenSession: true, isOwnSession: false },
			];
			rerender(
				<MenuBrowser
					restaurantId={"restaurants:test" as any}
					onSubmitOrder={onSubmitOrder}
					isSubmitting={false}
				/>
			);

			await waitFor(() => {
				expect(screen.getByText(/That table was just taken/)).toBeTruthy();
			});
			const confirm = screen.getAllByText("Proceed to Payment").at(-1) as HTMLButtonElement;
			expect(confirm.disabled).toBe(true);
			fireEvent.click(confirm);
			expect(onSubmitOrder).not.toHaveBeenCalled();
		});
	});
});
