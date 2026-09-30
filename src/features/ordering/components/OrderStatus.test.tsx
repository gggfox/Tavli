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

function renderPage(
	props: Partial<{
		onBackToMenu: () => void;
		onViewOrders: () => void;
		onContinueToPayment: () => void;
	}> = {}
) {
	return render(
		<OrderStatus
			orderId={"orders:status" as any}
			onBackToMenu={props.onBackToMenu ?? (() => {})}
			onViewOrders={props.onViewOrders ?? (() => {})}
			onContinueToPayment={props.onContinueToPayment ?? (() => {})}
		/>
	);
}

describe("OrderStatus loading vs not found", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("shows the loading copy while the subscription has not answered", () => {
		mockBackend(undefined);

		renderPage();

		expect(screen.getByText("Loading order...")).toBeTruthy();
		expect(screen.queryByText("We can't find this order")).toBeNull();
	});

	it("shows not-found, with a way to the orders list and the menu, when the query answers null", () => {
		// `getOrderWithItems` answers null for a missing order AND for someone
		// else's. That used to be an infinite "Loading order...".
		mockBackend(null);
		const onViewOrders = vi.fn();
		const onBackToMenu = vi.fn();

		renderPage({ onViewOrders, onBackToMenu });

		expect(screen.getByText("We can't find this order")).toBeTruthy();
		expect(screen.queryByText("Loading order...")).toBeNull();
		fireEvent.click(screen.getByText("View my orders"));
		fireEvent.click(screen.getByText("Back to menu"));
		expect(onViewOrders).toHaveBeenCalledTimes(1);
		expect(onBackToMenu).toHaveBeenCalledTimes(1);
	});

	it("shows not-found when the query errors (an id the validator rejects), without retrying", () => {
		vi.mocked(useQuery).mockReturnValue({ data: undefined, isError: true } as any);

		renderPage();

		expect(screen.getByText("We can't find this order")).toBeTruthy();
		expect(vi.mocked(useQuery).mock.calls[0][0]).toMatchObject({ retry: false });
	});
});

describe("OrderStatus for a round that is not placed yet", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("offers Continue to payment on an unpaid draft instead of an all-grey stepper", () => {
		mockBackend(baseOrder({ status: "draft", paymentState: "unpaid", paidPayment: null }));
		const onContinueToPayment = vi.fn();

		renderPage({ onContinueToPayment });

		expect(
			screen.getByText("This order hasn't been paid yet, so the kitchen hasn't received it.")
		).toBeTruthy();
		expect(screen.queryByText("Order Placed")).toBeNull();
		fireEvent.click(screen.getByText("Continue to payment"));
		expect(onContinueToPayment).toHaveBeenCalledTimes(1);
		// "Order more" is still there beside it.
		expect(screen.getByText("Order More")).toBeTruthy();
	});

	it("offers Continue to payment on a round committed to pay at the table", () => {
		mockBackend(
			baseOrder({ status: "awaiting_payment", paymentState: "unpaid", paidPayment: null })
		);

		renderPage();

		expect(
			screen.getByText("Your order will go to the kitchen once the staff confirms your payment.")
		).toBeTruthy();
		expect(screen.getByText("Continue to payment")).toBeTruthy();
	});

	it("does not offer payment once the order is placed", () => {
		mockBackend(baseOrder());

		renderPage();

		expect(screen.getByText("Order Placed")).toBeTruthy();
		expect(screen.queryByText("Continue to payment")).toBeNull();
	});
});

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

	/**
	 * TAVLI-110 / ADR 013: a dish the restaurant cannot make after payment is
	 * removed and refunded — there is no swap to negotiate. The line must NOT
	 * vanish: the diner paid for it, so they get to see what happened to it and
	 * that the money came back.
	 */
	describe("a line removed from a paid order (ADR 013)", () => {
		function orderWithRefundedLine() {
			return baseOrder({
				items: [
					{
						_id: "orderItems:agua",
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
			});
		}

		it("keeps the line visible, marked unavailable and refunded", () => {
			mockBackend(orderWithRefundedLine());

			renderPage();

			expect(screen.getByText("1x Agua de horchata")).toBeTruthy();
			expect(screen.getByText("Unavailable · refunded")).toBeTruthy();
			// "Unavailable" alone is the unpaid case — money never moved there.
			expect(screen.queryByText("Unavailable")).toBeNull();
		});

		it("shows the amount paid with the refund as its own line", () => {
			mockBackend(orderWithRefundedLine());

			renderPage();

			// The total stays what the card was charged (11200); the refund is a
			// separate line, so both reconcile against the card statement.
			expect(screen.getByText("Total")).toBeTruthy();
			expect(screen.getByText("$112.00")).toBeTruthy();
			expect(screen.getByText("Refunded")).toBeTruthy();
			expect(screen.getByText("-$28.00")).toBeTruthy();
		});

		/**
		 * The last live line's removal refunds the WHOLE charge and cancels the
		 * order, so `paymentState` becomes "refunded" rather than "paid". Gating
		 * the breakdown on that state hid the money from the one diner who most
		 * needs to see it.
		 */
		it("still shows the total and the refund once the whole charge came back", () => {
			mockBackend(
				baseOrder({
					status: "cancelled",
					paymentState: "refunded",
					totalAmount: 0,
					paidPayment: { subtotalAmount: 2800, feeAmount: 336, amount: 3136, paidAt: now },
					items: [
						{
							_id: "orderItems:agua",
							_creationTime: now,
							orderId: "orders:status",
							menuItemId: "menuItems:agua",
							menuItemName: "Agua de horchata",
							quantity: 1,
							unitPrice: 2800,
							selectedOptions: [],
							lineTotal: 2800,
							cancelledAt: now,
							refundedAt: now,
							refundAmount: 3136,
							createdAt: now,
						},
					],
				})
			);

			renderPage();

			expect(screen.getByText("Order Cancelled")).toBeTruthy();
			expect(screen.getByText("Unavailable · refunded")).toBeTruthy();
			expect(screen.getByText("Total")).toBeTruthy();
			expect(screen.getByText("$31.36")).toBeTruthy();
			expect(screen.getByText("Refunded")).toBeTruthy();
			expect(screen.getByText("-$31.36")).toBeTruthy();
		});

		it("has no refund line when nothing was refunded", () => {
			mockBackend(baseOrder());

			renderPage();

			expect(screen.queryByText("Refunded")).toBeNull();
		});
	});
});
