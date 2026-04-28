/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen } from "@testing-library/react";
import { useConvexAction } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { ProductManager } from "./ProductManager";

vi.mock("@tanstack/react-query", () => ({
	useQuery: vi.fn(),
}));

vi.mock("@convex-dev/react-query", () => ({
	useConvexAction: vi.fn(),
	convexQuery: vi.fn((ref, args) => ({ ref, args })),
}));

describe("ProductManager", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(useConvexAction).mockReturnValue(vi.fn());
		let callCount = 0;
		vi.mocked(useQuery).mockImplementation(() => {
			callCount += 1;
			if (callCount === 2) {
				return {
					data: [
						[
							{
								_id: "restaurants:ready",
								name: "Ready Restaurant",
								isActive: true,
								stripeAccountId: "acct_ready",
								stripeOnboardingComplete: true,
							},
							{
								_id: "restaurants:not-ready",
								name: "Not Ready Restaurant",
								isActive: true,
								stripeAccountId: "acct_not_ready",
								stripeOnboardingComplete: false,
							},
							{
								_id: "restaurants:inactive",
								name: "Inactive Restaurant",
								isActive: false,
								stripeAccountId: "acct_inactive",
								stripeOnboardingComplete: true,
							},
						],
						null,
					],
					isLoading: false,
				} as any;
			}

			return {
				data: [],
				isLoading: false,
			} as any;
		});
	});

	it("only offers payout-ready manageable restaurants in the create-product form", () => {
		render(<ProductManager />);

		fireEvent.click(screen.getByText("New Product"));

		expect(screen.getByText("Create New Product")).toBeTruthy();
		const select = screen.getByLabelText("Restaurant (Connected Account)") as HTMLSelectElement;
		expect(select.textContent).toContain("Ready Restaurant");
		expect(select.textContent).not.toContain("Not Ready Restaurant");
		expect(select.textContent).not.toContain("Inactive Restaurant");
	});
});
