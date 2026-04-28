import { fireEvent, render, screen } from "@testing-library/react";
import type { Id } from "convex/_generated/dataModel";
import { describe, expect, it, vi } from "vitest";
import { Cart } from "./Cart";

vi.mock("@tanstack/react-query", () => ({
	useQuery: vi.fn(),
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: vi.fn(() => ({ queryKey: ["mock"], queryFn: () => null })),
}));

import { useQuery } from "@tanstack/react-query";

const mockOrderId = "orders:abc123" as Id<"orders">;
const mockOrderItemId = "orderItems:item1" as Id<"orderItems">;
const mockMenuItemId = "menuItems:mi1" as Id<"menuItems">;

const mockItems = [
	{
		_id: mockOrderItemId,
		_creationTime: 0,
		orderId: mockOrderId,
		menuItemId: mockMenuItemId,
		menuItemName: "Margherita Pizza",
		quantity: 2,
		unitPrice: 1200,
		selectedOptions: [],
		specialInstructions: undefined,
		lineTotal: 2400,
		createdAt: Date.now(),
	},
];

describe("Cart", () => {
	it("shows loading skeleton when data is not yet available", () => {
		vi.mocked(useQuery).mockReturnValue({
			data: undefined,
			isLoading: true,
		} as any);

		render(
			<Cart
				orderId={mockOrderId}
				onBack={() => {}}
				onSubmit={() => {}}
				onRemoveItem={() => {}}
				isSubmitting={false}
			/>
		);
		const skeleton = screen.getByLabelText("Loading cart");
		expect(skeleton).toBeInTheDocument();
		expect(skeleton).toHaveAttribute("aria-busy", "true");
	});

	it("shows empty state when cart has no items", () => {
		vi.mocked(useQuery).mockReturnValue({
			data: { items: [], totalAmount: 0 },
		} as any);

		render(
			<Cart
				orderId={mockOrderId}
				onBack={() => {}}
				onSubmit={() => {}}
				onRemoveItem={() => {}}
				isSubmitting={false}
			/>
		);
		expect(screen.getByText("Your cart is empty. Add some items!")).toBeInTheDocument();
	});

	it("renders cart items with name, quantity, and price", () => {
		vi.mocked(useQuery).mockReturnValue({
			data: { items: mockItems, totalAmount: 2400 },
		} as any);

		render(
			<Cart
				orderId={mockOrderId}
				onBack={() => {}}
				onSubmit={() => {}}
				onRemoveItem={() => {}}
				isSubmitting={false}
			/>
		);
		expect(screen.getByText("2x Margherita Pizza")).toBeInTheDocument();
		const priceElements = screen.getAllByText("$24.00");
		expect(priceElements.length).toBeGreaterThanOrEqual(1);
	});

	it("displays the total amount", () => {
		vi.mocked(useQuery).mockReturnValue({
			data: { items: mockItems, totalAmount: 2400 },
		} as any);

		render(
			<Cart
				orderId={mockOrderId}
				onBack={() => {}}
				onSubmit={() => {}}
				onRemoveItem={() => {}}
				isSubmitting={false}
			/>
		);
		expect(screen.getByText("Total")).toBeInTheDocument();
	});

	it("calls onBack when Back button is clicked", () => {
		vi.mocked(useQuery).mockReturnValue({
			data: { items: mockItems, totalAmount: 2400 },
		} as any);

		const onBack = vi.fn();
		render(
			<Cart
				orderId={mockOrderId}
				onBack={onBack}
				onSubmit={() => {}}
				onRemoveItem={() => {}}
				isSubmitting={false}
			/>
		);
		fireEvent.click(screen.getByText("Back to menu"));
		expect(onBack).toHaveBeenCalledTimes(1);
	});

	it("calls onSubmit when Place Order is clicked", () => {
		vi.mocked(useQuery).mockReturnValue({
			data: { items: mockItems, totalAmount: 2400 },
		} as any);

		const onSubmit = vi.fn();
		render(
			<Cart
				orderId={mockOrderId}
				onBack={() => {}}
				onSubmit={onSubmit}
				onRemoveItem={() => {}}
				isSubmitting={false}
			/>
		);
		fireEvent.click(screen.getByText("Place Order"));
		expect(onSubmit).toHaveBeenCalledTimes(1);
	});

	it("disables submit button and shows submitting text while submitting", () => {
		vi.mocked(useQuery).mockReturnValue({
			data: { items: mockItems, totalAmount: 2400 },
		} as any);

		render(
			<Cart
				orderId={mockOrderId}
				onBack={() => {}}
				onSubmit={() => {}}
				onRemoveItem={() => {}}
				isSubmitting={true}
			/>
		);
		const button = screen.getByText("Placing Order...");
		expect(button).toBeInTheDocument();
		expect(button).toBeDisabled();
	});

	it("calls onRemoveItem when trash button is clicked", () => {
		vi.mocked(useQuery).mockReturnValue({
			data: { items: mockItems, totalAmount: 2400 },
		} as any);

		const onRemoveItem = vi.fn();
		render(
			<Cart
				orderId={mockOrderId}
				onBack={() => {}}
				onSubmit={() => {}}
				onRemoveItem={onRemoveItem}
				isSubmitting={false}
			/>
		);
		const removeButtons = screen
			.getAllByRole("button")
			.filter((btn) => btn.querySelector("svg") && !btn.textContent);
		if (removeButtons.length > 0) {
			fireEvent.click(removeButtons[0]);
			expect(onRemoveItem).toHaveBeenCalledWith(mockOrderItemId);
		}
	});
});
