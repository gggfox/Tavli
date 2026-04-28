/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useConvexAction } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { Storefront } from "./Storefront";

vi.mock("@tanstack/react-query", () => ({
	useQuery: vi.fn(),
}));

vi.mock("@convex-dev/react-query", () => ({
	useConvexAction: vi.fn(),
	convexQuery: vi.fn(() => ({ queryKey: ["mock"], queryFn: () => null })),
}));

const mockCreateCheckout = vi.fn();

describe("Storefront", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(useConvexAction).mockReturnValue(mockCreateCheckout);
	});

	it("creates a hosted checkout session when Buy Now is clicked", async () => {
		mockCreateCheckout.mockResolvedValue({ url: null, paymentId: "payments:test" });
		vi.mocked(useQuery).mockReturnValue({
			data: [
				{
					_id: "products:test",
					name: "Storefront Pizza",
					description: "A storefront purchase",
					priceInCents: 2400,
					currency: "usd",
					restaurantId: "restaurants:test",
					restaurantName: "Pizza Place",
					restaurantSlug: "pizza-place",
				},
			],
			isLoading: false,
		} as any);

		render(<Storefront />);

		fireEvent.click(screen.getByText("Buy Now"));

		await waitFor(() => {
			expect(mockCreateCheckout).toHaveBeenCalledWith({
				productId: "products:test",
				quantity: 1,
				successUrl: "http://localhost:3000/success",
				cancelUrl: "http://localhost:3000/storefront",
			});
		});
	});
});
