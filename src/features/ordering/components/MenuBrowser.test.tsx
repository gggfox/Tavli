/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
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
	beforeEach(() => {
		vi.clearAllMocks();
		let callCount = 0;
		vi.mocked(useQuery).mockImplementation(() => {
			callCount += 1;
			const phase = (callCount - 1) % 5;
			if (phase === 0) {
				return { data: false } as any;
			}
			if (phase === 1) {
				return {
					data: [
						{
							_id: "menus:test",
							name: "Main",
							isActive: true,
							displayOrder: 0,
						},
					],
				} as any;
			}
			if (phase === 2) {
				return {
					data: [
						{
							_id: "tables:test",
							tableNumber: 1,
						},
					],
				} as any;
			}
			if (phase === 3) {
				return {
					data: [
						{
							_id: "menuCategories:test",
							name: "Starters",
							displayOrder: 0,
						},
					],
				} as any;
			}

			return {
				data: [
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
			} as any;
		});
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
			expect(screen.getByText("Online ordering is not available at this restaurant yet.")).toBeTruthy();
		});

		const proceedButtons = screen.getAllByText("Proceed to Payment");
		const paymentButton = proceedButtons.at(-1) as HTMLButtonElement;
		expect(paymentButton.disabled).toBe(true);
	});
});
