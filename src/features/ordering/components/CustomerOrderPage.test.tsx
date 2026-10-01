/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
import { render, screen } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CustomerOrderPage } from "./CustomerOrderPage";

vi.mock("@tanstack/react-query", () => ({
	useQuery: vi.fn(),
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: vi.fn((ref, args) => ({ ref, args })),
	useConvexAction: vi.fn(),
}));

function renderPage(orderId: string) {
	return render(
		<CustomerOrderPage
			orderId={orderId}
			onBackToMenu={() => {}}
			onViewOrders={() => {}}
			onContinueToPayment={() => {}}
		/>
	);
}

describe("CustomerOrderPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(useQuery).mockReturnValue({ data: undefined, isError: false } as any);
	});

	it.each(["abc", "not-an-order-id", "ORDERS%20LIST", ""])(
		"lands a malformed id (%j) on not-found without asking the backend",
		(orderId) => {
			renderPage(orderId);

			expect(screen.getByText("We can't find this order")).toBeTruthy();
			expect(useQuery).not.toHaveBeenCalled();
		}
	);

	it("hands a plausible id to the order status subscription", () => {
		renderPage("k57bq0a3xh4n6ckm0p5s5v3h1n6x2wkq");

		expect(useQuery).toHaveBeenCalled();
		expect(screen.getByText("Loading order...")).toBeTruthy();
	});
});
