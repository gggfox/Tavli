/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useConvexAction } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { CheckoutPage } from "./CheckoutPage";

vi.mock("@tanstack/react-query", () => ({
	useQuery: vi.fn(),
}));

vi.mock("@convex-dev/react-query", () => ({
	useConvexAction: vi.fn(),
	convexQuery: vi.fn(() => ({ queryKey: ["mock"], queryFn: () => null })),
}));

vi.mock("@stripe/stripe-js", () => ({
	loadStripe: vi.fn(() => Promise.resolve({})),
}));

vi.mock("@stripe/react-stripe-js", () => ({
	Elements: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	PaymentElement: () => <div>Payment element</div>,
	useStripe: vi.fn(() => null),
	useElements: vi.fn(() => null),
}));

const mockCreatePaymentIntent = vi.fn();

const baseOrder = {
	_id: "orders:checkout-test",
	_creationTime: 0,
	sessionId: "sessions:test",
	restaurantId: "restaurants:test",
	tableId: "tables:test",
	status: "draft",
	totalAmount: 2400,
	paymentState: "unpaid",
	activePaymentId: undefined,
	stripePaymentIntentId: undefined,
	specialInstructions: undefined,
	submittedAt: undefined,
	paidAt: undefined,
	createdAt: Date.now(),
	updatedAt: Date.now(),
	items: [
		{
			_id: "orderItems:test",
			_creationTime: 0,
			orderId: "orders:checkout-test",
			menuItemId: "menuItems:test",
			menuItemName: "Margherita Pizza",
			quantity: 2,
			unitPrice: 1200,
			selectedOptions: [],
			lineTotal: 2400,
			createdAt: Date.now(),
		},
	],
};

describe("CheckoutPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(useConvexAction).mockReturnValue(mockCreatePaymentIntent);
	});

	it("does not auto-create a new payment intent after a failed attempt", async () => {
		vi.mocked(useQuery).mockReturnValue({
			data: {
				...baseOrder,
				paymentState: "failed",
				activePayment: {
					_id: "payments:failed",
					failureMessage: "Card was declined",
				},
			},
		} as any);

		render(
			<CheckoutPage
				orderId={baseOrder._id}
				onBackToMenu={() => {}}
				onOrderPlaced={() => {}}
			/>
		);

		await waitFor(() => {
			expect(mockCreatePaymentIntent).not.toHaveBeenCalled();
		});
		expect(screen.getByText("Card was declined")).toBeTruthy();
		expect(screen.getByText("Retry")).toBeTruthy();
	});

	it("retries payment intent creation only when the customer clicks retry", async () => {
		mockCreatePaymentIntent.mockResolvedValue({
			clientSecret: "pi_secret_retry",
		});
		vi.mocked(useQuery).mockReturnValue({
			data: {
				...baseOrder,
				paymentState: "failed",
				activePayment: {
					_id: "payments:failed",
					failureMessage: "Card was declined",
				},
			},
		} as any);

		render(
			<CheckoutPage
				orderId={baseOrder._id}
				onBackToMenu={() => {}}
				onOrderPlaced={() => {}}
			/>
		);

		fireEvent.click(screen.getByText("Retry"));

		await waitFor(() => {
			expect(mockCreatePaymentIntent).toHaveBeenCalledWith({
				orderId: baseOrder._id,
			});
		});
	});
});
