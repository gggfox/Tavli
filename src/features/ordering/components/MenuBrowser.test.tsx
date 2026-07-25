/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
		"tables:getActiveByRestaurant": [{ _id: "tables:test", tableNumber: 1 }],
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

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(useQuery).mockImplementation((options: any) => {
			const name = options?.ref ? getFunctionName(options.ref) : "";
			return { data: QUERY_DATA[name] } as any;
		});
	});

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

		const proceedButtons = screen.getAllByText("Send order to kitchen");
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
		expect(screen.queryByText("Send order to kitchen")).toBeNull();
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
			expect(screen.queryByText("Send order to kitchen")).toBeNull();
		});
		expect(screen.queryByText("Tap items to start your order")).toBeNull();
	});
});
