/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useConvexAction } from "@convex-dev/react-query";
import { getFunctionName } from "convex/server";
import { DEFAULT_TIP_PERCENT, PLATFORM_APPLICATION_FEE_RATE } from "convex/constants";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { OrderCheckoutPage } from "./OrderCheckoutPage";

vi.mock("@tanstack/react-query", () => ({
	useQuery: vi.fn(),
	useMutation: vi.fn(),
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: vi.fn((ref, args) => ({ ref, args })),
	useConvexAction: vi.fn(),
	useConvexMutation: vi.fn(() => vi.fn()),
}));

vi.mock("@stripe/stripe-js", () => ({
	loadStripe: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("@stripe/react-stripe-js", () => ({
	Elements: ({ children }: any) => <div data-testid="stripe-elements">{children}</div>,
	PaymentElement: () => <div data-testid="payment-element" />,
	useStripe: () => null,
	useElements: () => null,
}));

const now = 1_745_000_000_000;

function baseOrder(overrides: Record<string, any> = {}) {
	return {
		_id: "orders:checkout",
		_creationTime: now,
		sessionId: "sessions:test",
		restaurantId: "restaurants:test",
		tableId: "tables:test",
		status: "draft",
		totalAmount: 10000,
		paymentState: "unpaid",
		activePayment: null,
		items: [
			{
				_id: "orderItems:pozole",
				_creationTime: now,
				orderId: "orders:checkout",
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

/** Records the relative ordering of the cancel action vs. the cash mutation. */
const callLog: string[] = [];
const createIntentMock = vi.fn(async () => {
	callLog.push("createIntent");
	return { clientSecret: "cs_test", paymentId: "payments:1" };
});
const cancelIntentMock = vi.fn(async () => {
	callLog.push("cancel");
	return { cancelled: true, settled: false };
});
const requestPayInPersonMock = vi.fn(async () => {
	callLog.push("requestPayInPerson");
	return null;
});

function mockBackend(order: Record<string, any> | null | undefined) {
	vi.mocked(useQuery).mockReturnValue({ data: order, isLoading: false } as any);
	vi.mocked(useConvexAction).mockImplementation(
		(ref: any) =>
			(getFunctionName(ref) === "stripe:cancelOrderPaymentIntent"
				? cancelIntentMock
				: createIntentMock) as any
	);
	vi.mocked(useMutation).mockReturnValue({
		mutateAsync: requestPayInPersonMock,
		isPending: false,
	} as any);
}

function renderPage(props: Partial<{ onBackToMenu: () => void; onViewOrders: () => void }> = {}) {
	return render(
		<OrderCheckoutPage
			orderId={"orders:checkout" as any}
			onBackToMenu={props.onBackToMenu ?? (() => {})}
			onViewOrders={props.onViewOrders ?? (() => {})}
		/>
	);
}

describe("OrderCheckoutPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		callLog.length = 0;
	});

	it("itemizes the draft: subtotal, fee, and the pre-applied tip (10000 → 1200 → 1000 → 12200)", () => {
		mockBackend(baseOrder({ totalAmount: 10000 }));

		renderPage();

		expect(screen.getByText("2x Pozole")).toBeTruthy();
		expect(screen.getByText("Subtotal")).toBeTruthy();
		// The rate comes from PLATFORM_APPLICATION_FEE_RATE — never hardcoded.
		expect(
			screen.getByText(`Tavli service fee (${PLATFORM_APPLICATION_FEE_RATE * 100}%)`)
		).toBeTruthy();
		expect(screen.getByText("$12.00")).toBeTruthy();
		// The tip is 10% of the SUBTOTAL, not of the fee-inclusive total: 10% of
		// $112 would be $11.20, which quietly tips on Tavli's service fee.
		expect(screen.getByText(`Tip (${DEFAULT_TIP_PERCENT}%)`)).toBeTruthy();
		expect(screen.getByText("$10.00")).toBeTruthy();
		expect(screen.getByText("$122.00")).toBeTruthy();
		expect(screen.getByText("Continue to payment")).toBeTruthy();
		expect(screen.getByText("Pay in person")).toBeTruthy();
	});

	it("lets the diner reach a zero tip, and charges what the slider says", async () => {
		// A pre-applied tip with no visible way to remove it is the pattern that
		// generates chargebacks from diners who did not notice.
		mockBackend(baseOrder({ totalAmount: 10000 }));
		renderPage();

		fireEvent.click(screen.getByRole("button", { name: /change/i }));
		const slider = screen.getByRole("slider");
		fireEvent.change(slider, { target: { value: "0" } });

		expect(screen.getByText("$112.00")).toBeTruthy();

		fireEvent.click(screen.getByText("Continue to payment"));
		await waitFor(() =>
			expect(createIntentMock).toHaveBeenCalledWith({
				orderId: "orders:checkout",
				tipPercent: 0,
			})
		);
	});

	it("announces the tip in words as well as emoji", async () => {
		// A slider whose only feedback is a picture says nothing to a screen
		// reader, or to anyone whose font stack renders the emoji as a box.
		mockBackend(baseOrder({ totalAmount: 10000 }));
		renderPage();

		fireEvent.click(screen.getByRole("button", { name: /change/i }));
		expect(screen.getByRole("slider").getAttribute("aria-valuetext")).toBe("10% — $10.00");
	});

	it("locks the tip once a payment sheet is mounted", async () => {
		// Stripe fixes the amount when the intent is created. A tip changed
		// after that point would be displayed but not charged — the diner told
		// one number and billed another.
		mockBackend(baseOrder({ totalAmount: 10000 }));
		renderPage();

		fireEvent.click(screen.getByRole("button", { name: /change/i }));
		fireEvent.click(screen.getByText("Continue to payment"));

		await waitFor(() => expect(screen.getByTestId("payment-element")).toBeTruthy());
		expect((screen.getByRole("slider") as HTMLInputElement).disabled).toBe(true);
	});

	it("starts the card flow via createPaymentIntent and mounts the payment element", async () => {
		mockBackend(baseOrder());

		renderPage();
		fireEvent.click(screen.getByText("Continue to payment"));

		await waitFor(() => {
			expect(createIntentMock).toHaveBeenCalledWith({
				orderId: "orders:checkout",
				tipPercent: DEFAULT_TIP_PERCENT,
			});
			expect(screen.getByTestId("payment-element")).toBeTruthy();
		});
		// The cash switch stays available while the card form is mounted.
		expect(screen.getByText("Pay in person")).toBeTruthy();
	});

	it("pay in person cancels the active card intent BEFORE committing to cash", async () => {
		mockBackend(baseOrder({ activePayment: { status: "processing" } }));

		renderPage();
		fireEvent.click(screen.getByText("Pay in person"));

		await waitFor(() => {
			expect(requestPayInPersonMock).toHaveBeenCalledWith({ orderId: "orders:checkout" });
		});
		expect(cancelIntentMock).toHaveBeenCalledWith({ orderId: "orders:checkout" });
		expect(callLog).toEqual(["cancel", "requestPayInPerson"]);
	});

	it("skips the cancel when no card intent is in flight", async () => {
		mockBackend(baseOrder({ activePayment: null }));

		renderPage();
		fireEvent.click(screen.getByText("Pay in person"));

		await waitFor(() => {
			expect(requestPayInPersonMock).toHaveBeenCalled();
		});
		expect(cancelIntentMock).not.toHaveBeenCalled();
	});

	it("abandoning a cash→card switch only cancels the intent — no double cash request", async () => {
		mockBackend(baseOrder({ status: "awaiting_payment", dailyOrderNumber: 9 }));

		renderPage();
		// Switch to card: the payment sheet mounts over the cash confirmation.
		fireEvent.click(screen.getByText("Pay by card instead"));
		await waitFor(() => {
			expect(screen.getByTestId("payment-element")).toBeTruthy();
		});

		// Change of heart: back to cash. The order is already awaiting_payment,
		// so only the card intent is cancelled.
		fireEvent.click(screen.getByText("Pay in person"));
		await waitFor(() => {
			expect(cancelIntentMock).toHaveBeenCalledWith({ orderId: "orders:checkout" });
		});
		expect(requestPayInPersonMock).not.toHaveBeenCalled();
		// Back on the cash confirmation.
		expect(screen.getByText("Pay at the table")).toBeTruthy();
	});

	it("shows the cash confirmation once the order is awaiting_payment", () => {
		mockBackend(baseOrder({ status: "awaiting_payment", dailyOrderNumber: 9, totalAmount: 10000 }));

		renderPage();

		expect(screen.getByText("Pay at the table")).toBeTruthy();
		// Prominent callable number + the amount staff collect (no card fee).
		expect(screen.getByText("Order #9")).toBeTruthy();
		expect(screen.getByText("$100.00")).toBeTruthy();
		expect(screen.getByText("Show this to your server to pay at the table.")).toBeTruthy();
		expect(
			screen.getByText("Your order will go to the kitchen once the staff confirms your payment.")
		).toBeTruthy();
		expect(screen.getByText("Pay by card instead")).toBeTruthy();
	});

	it("flips to the success screen when the subscription reports the order paid", () => {
		mockBackend(baseOrder({ status: "submitted", paymentState: "paid", dailyOrderNumber: 42 }));

		const onViewOrders = vi.fn();
		renderPage({ onViewOrders });

		expect(screen.getByText("Payment complete!")).toBeTruthy();
		expect(screen.getByText("Order #42 was sent to the kitchen.")).toBeTruthy();

		fireEvent.click(screen.getByText("View my orders"));
		expect(onViewOrders).toHaveBeenCalled();
	});

	it("stands down when the card charge won the race instead of firing a doomed cash request", async () => {
		mockBackend(baseOrder({ activePayment: { status: "processing" } }));
		// The intent already succeeded at Stripe; the webhook is settling the
		// order. `requestPayInPerson` would only surface
		// ERROR_ORDER_PAYMENT_IN_FLIGHT one tick before the paid screen.
		cancelIntentMock.mockImplementationOnce(async () => {
			callLog.push("cancel");
			return { cancelled: false, settled: true };
		});

		renderPage();
		fireEvent.click(screen.getByText("Pay in person"));

		await waitFor(() => {
			expect(cancelIntentMock).toHaveBeenCalledWith({ orderId: "orders:checkout" });
		});
		expect(requestPayInPersonMock).not.toHaveBeenCalled();
		expect(callLog).toEqual(["cancel"]);
	});

	it("surfaces a webhook-reported decline and drops back to the summary", () => {
		mockBackend(
			baseOrder({
				paymentState: "failed",
				activePayment: { status: "failed", failureMessage: "Your card was declined." },
			})
		);

		renderPage();

		expect(screen.getByText("Your card was declined.")).toBeTruthy();
		// Order stays a draft: the diner can retry either path.
		expect(screen.getByText("Continue to payment")).toBeTruthy();
		expect(screen.getByText("Pay in person")).toBeTruthy();
	});
});
