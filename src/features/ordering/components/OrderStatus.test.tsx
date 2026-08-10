/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { useConvexAction } from "@convex-dev/react-query";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { OrderStatus } from "./OrderStatus";

vi.mock("@tanstack/react-query", () => ({
	useQuery: vi.fn(),
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: vi.fn((ref, args) => ({ ref, args })),
	useConvexAction: vi.fn(),
}));

const now = 1_745_000_000_000;

function baseOrder(overrides: Record<string, any> = {}) {
	return {
		_id: "orders:status",
		_creationTime: now,
		sessionId: "sessions:test",
		restaurantId: "restaurants:test",
		tableId: "tables:test",
		status: "submitted",
		totalAmount: 10000,
		paymentState: "paid",
		dailyOrderNumber: 42,
		activePayment: null,
		// The ADR 008 charged split — what the breakdown must display.
		paidPayment: { subtotalAmount: 10000, feeAmount: 1200, amount: 11200, paidAt: now },
		items: [
			{
				_id: "orderItems:pozole",
				_creationTime: now,
				orderId: "orders:status",
				menuItemId: "menuItems:pozole",
				menuItemName: "Pozole",
				quantity: 2,
				unitPrice: 5000,
				selectedOptions: [],
				lineTotal: 10000,
				createdAt: now,
			},
		],
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

const sendReceiptMock = vi.fn(async () => ({ sentTo: "diner@example.com" }));

function mockBackend(order: Record<string, any> | null | undefined) {
	vi.mocked(useQuery).mockReturnValue({ data: order, isLoading: false } as any);
	vi.mocked(useConvexAction).mockReturnValue(sendReceiptMock as any);
}

function renderPage() {
	return render(<OrderStatus orderId={"orders:status" as any} onBackToMenu={() => {}} />);
}

describe("OrderStatus receipt breakdown (TAVLI-71 Phase 3C)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		sendReceiptMock.mockResolvedValue({ sentTo: "diner@example.com" });
	});

	it("shows the CHARGED fee from the payment row, never recomputed from the rate", () => {
		// 1234 is 12% of nothing here — if the UI recomputed subtotal * rate it
		// would show $12.00, so seeing $12.34 proves the row's amounts are used.
		mockBackend(
			baseOrder({
				paidPayment: { subtotalAmount: 10000, feeAmount: 1234, amount: 11234, paidAt: now },
			})
		);

		renderPage();

		expect(screen.getByText("Subtotal")).toBeTruthy();
		expect(screen.getByText("Tavli service fee (12%)")).toBeTruthy();
		expect(screen.getByText("$12.34")).toBeTruthy();
		expect(screen.getByText("Total")).toBeTruthy();
		expect(screen.getByText("$112.34")).toBeTruthy();
	});

	it("cash order (no payment row): subtotal and total only, no fee line", () => {
		mockBackend(baseOrder({ paidPayment: null, settledBy: "staff" }));

		renderPage();

		expect(screen.getByText("Subtotal")).toBeTruthy();
		expect(screen.queryByText("Tavli service fee (12%)")).toBeNull();
		expect(screen.getByText("Total")).toBeTruthy();
		// Both subtotal and total resolve to the order total (no fee on cash).
		expect(screen.getAllByText("$100.00").length).toBeGreaterThanOrEqual(2);
	});

	it("hides the breakdown and the email button while the order is unpaid", () => {
		mockBackend(baseOrder({ status: "draft", paymentState: "unpaid", paidPayment: null }));

		renderPage();

		expect(screen.queryByText("Subtotal")).toBeNull();
		expect(screen.queryByText("Email me a receipt")).toBeNull();
	});

	it("emails the receipt in the active locale and confirms the recipient inline", async () => {
		mockBackend(baseOrder());

		renderPage();
		fireEvent.click(screen.getByText("Email me a receipt"));

		await waitFor(() => {
			expect(sendReceiptMock).toHaveBeenCalledWith({ orderId: "orders:status", locale: "en" });
			expect(screen.getByText("Sent to diner@example.com")).toBeTruthy();
		});
		// Still enabled — re-sends are allowed until the rate limit trips.
		expect(
			(screen.getByText("Email me a receipt").closest("button") as HTMLButtonElement).disabled
		).toBe(false);
	});

	it("disables the button with a friendly message when the rate limit trips", async () => {
		mockBackend(baseOrder());
		sendReceiptMock.mockRejectedValueOnce(new Error("Uncaught Error: ERROR_RECEIPT_RATE_LIMITED"));

		renderPage();
		fireEvent.click(screen.getByText("Email me a receipt"));

		await waitFor(() => {
			expect(
				screen.getByText(
					"This receipt was already emailed a few times. Please wait a bit before requesting it again."
				)
			).toBeTruthy();
		});
		expect(
			(screen.getByText("Email me a receipt").closest("button") as HTMLButtonElement).disabled
		).toBe(true);
	});

	it("keeps the button enabled after a non-rate-limit failure", async () => {
		mockBackend(baseOrder());
		sendReceiptMock.mockRejectedValueOnce(new Error("Uncaught Error: ERROR_RECEIPT_SEND_FAILED"));

		renderPage();
		fireEvent.click(screen.getByText("Email me a receipt"));

		await waitFor(() => {
			expect(
				screen.getByText("We couldn't send the receipt email. Please try again in a moment.")
			).toBeTruthy();
		});
		expect(
			(screen.getByText("Email me a receipt").closest("button") as HTMLButtonElement).disabled
		).toBe(false);
	});

	it("labels a refunded line as refunded rather than unavailable", () => {
		mockBackend(
			baseOrder({
				items: [
					{
						_id: "orderItems:refunded",
						_creationTime: now,
						orderId: "orders:status",
						menuItemId: "menuItems:agua",
						menuItemName: "Agua de horchata",
						quantity: 1,
						unitPrice: 2500,
						selectedOptions: [],
						lineTotal: 2500,
						cancelledAt: now,
						refundedAt: now,
						refundAmount: 2800,
						createdAt: now,
					},
				],
			})
		);

		renderPage();

		expect(screen.getByText("Refunded")).toBeTruthy();
		expect(screen.queryByText("Unavailable")).toBeNull();
	});
});
