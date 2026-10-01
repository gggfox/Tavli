/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useConvexAction } from "@convex-dev/react-query";
import { getFunctionName } from "convex/server";
import { DEFAULT_TIP_PERCENT, PLATFORM_APPLICATION_FEE_RATE } from "convex/constants";
import { afterEach, describe, expect, it, beforeEach, vi } from "vitest";
import { track } from "@/global/utils/telemetry";
import {
	PAYMENT_CONFIRMATION_ESCALATE_AFTER_MS,
	readPaymentConfirmation,
	rememberPaymentConfirmation,
} from "../utils/paymentConfirmation";
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

/** Null by default (Stripe.js not loaded); a test can hand the form a stripe. */
const stripeJs = vi.hoisted(() => ({ stripe: null as any, elements: null as any }));

vi.mock("@stripe/react-stripe-js", () => ({
	Elements: ({ children }: any) => <div data-testid="stripe-elements">{children}</div>,
	PaymentElement: () => <div data-testid="payment-element" />,
	useStripe: () => stripeJs.stripe,
	useElements: () => stripeJs.elements,
}));

vi.mock("@/global/utils/telemetry", () => ({
	track: vi.fn(),
	reportError: vi.fn(),
	initTelemetry: vi.fn(),
	identifyUser: vi.fn(),
	resetUser: vi.fn(),
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
		sessionStorage.clear();
		stripeJs.stripe = null;
		stripeJs.elements = null;
	});

	describe("order_placed", () => {
		const placedCalls = () =>
			vi.mocked(track).mock.calls.filter(([event]) => event === "order_placed");
		const page = () => (
			<OrderCheckoutPage
				orderId={"orders:checkout" as any}
				onBackToMenu={() => {}}
				onViewOrders={() => {}}
			/>
		);
		const paid = () =>
			baseOrder({ status: "submitted", paymentState: "paid", dailyOrderNumber: 42 });

		it("fires once, as cash, when the draft is committed to pay in person", () => {
			mockBackend(baseOrder());
			const { rerender } = render(page());

			mockBackend(baseOrder({ status: "awaiting_payment" }));
			rerender(page());

			expect(placedCalls()).toEqual([
				["order_placed", { order_id: "orders:checkout", payment_method: "cash" }],
			]);
		});

		it("fires once, as card, when the webhook marks the draft paid", () => {
			mockBackend(baseOrder());
			const { rerender } = render(page());

			mockBackend(paid());
			rerender(page());

			expect(placedCalls()).toEqual([
				["order_placed", { order_id: "orders:checkout", payment_method: "card" }],
			]);
		});

		it("stays silent when the page mounts on an order that is already placed", () => {
			// A reload of the receipt is not a placement.
			mockBackend(paid());
			const { rerender } = render(page());
			rerender(page());

			expect(placedCalls()).toEqual([]);
		});

		it("does not count a cash→card switch as a second placement", () => {
			mockBackend(baseOrder());
			const { rerender } = render(page());
			mockBackend(baseOrder({ status: "awaiting_payment" }));
			rerender(page());
			mockBackend(paid());
			rerender(page());

			expect(placedCalls()).toHaveLength(1);
			expect(placedCalls()[0][1]).toMatchObject({ payment_method: "cash" });
		});

		it("does not fire when a draft is cancelled", () => {
			mockBackend(baseOrder());
			const { rerender } = render(page());
			mockBackend(baseOrder({ status: "cancelled" }));
			rerender(page());

			expect(placedCalls()).toEqual([]);
		});
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

	describe("back to menu", () => {
		// TAVLI-104. Plain navigation left the prepared intent live at Stripe with
		// its client secret in a page the diner could come back to — or leave open
		// in another tab — and confirming it later charged a card for an order
		// that had moved on.
		it("cancels the prepared charge before navigating away", async () => {
			mockBackend(baseOrder());
			const onBackToMenu = vi.fn(() => {
				callLog.push("navigate");
			});
			renderPage({ onBackToMenu });

			fireEvent.click(screen.getByText("Continue to payment"));
			await waitFor(() => expect(screen.getByTestId("payment-element")).toBeTruthy());

			fireEvent.click(screen.getByLabelText("Back to menu"));

			await waitFor(() => expect(onBackToMenu).toHaveBeenCalled());
			expect(cancelIntentMock).toHaveBeenCalledWith({ orderId: "orders:checkout" });
			expect(callLog).toEqual(["createIntent", "cancel", "navigate"]);
		});

		it("cancels an intent prepared before a reload, without a payment sheet on screen", async () => {
			mockBackend(baseOrder({ activePayment: { status: "processing" } }));
			const onBackToMenu = vi.fn();
			renderPage({ onBackToMenu });

			fireEvent.click(screen.getByLabelText("Back to menu"));

			await waitFor(() => expect(cancelIntentMock).toHaveBeenCalled());
			expect(onBackToMenu).toHaveBeenCalled();
		});

		it("navigates without a round trip when nothing was prepared", async () => {
			mockBackend(baseOrder({ activePayment: null }));
			const onBackToMenu = vi.fn();
			renderPage({ onBackToMenu });

			fireEvent.click(screen.getByLabelText("Back to menu"));

			await waitFor(() => expect(onBackToMenu).toHaveBeenCalled());
			expect(cancelIntentMock).not.toHaveBeenCalled();
		});

		it("still leaves when the cancel fails — getting out must always work", async () => {
			mockBackend(baseOrder({ activePayment: { status: "processing" } }));
			cancelIntentMock.mockRejectedValueOnce(new Error("stripe is down"));
			const onBackToMenu = vi.fn();
			renderPage({ onBackToMenu });

			fireEvent.click(screen.getByLabelText("Back to menu"));

			// The supersede path stands the intent down on the next attempt.
			await waitFor(() => expect(onBackToMenu).toHaveBeenCalled());
		});
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

	/**
	 * Between `confirmPayment` succeeding and the webhook settling, the diner
	 * must see "confirming" and nothing they can pay with — across a reload
	 * and a 3-D Secure redirect too. A `processing` payment row alone does not
	 * mean that: rows are `processing` from the moment the intent exists.
	 */
	describe("confirming a payment", () => {
		const confirmingOrder = (overrides: Record<string, any> = {}) =>
			baseOrder({
				paymentState: "processing",
				stripePaymentIntentId: "pi_live",
				activePayment: { status: "processing" },
				...overrides,
			});

		const expectNoWayToPay = () => {
			expect(screen.queryByText("Continue to payment")).toBeNull();
			expect(screen.queryByText("Pay in person")).toBeNull();
			expect(screen.queryByText("Pay Now")).toBeNull();
			expect(screen.queryByTestId("payment-element")).toBeNull();
		};

		it("renders the confirming state, with no pay button, after a reload of a confirmed payment", () => {
			rememberPaymentConfirmation("orders:checkout", {
				paymentIntentId: "pi_live",
				confirmedAt: Date.now(),
			});
			mockBackend(confirmingOrder());

			renderPage();

			expect(screen.getByText("Confirming your payment")).toBeTruthy();
			expect(screen.getByText("Order reference #eckout")).toBeTruthy();
			expectNoWayToPay();
		});

		it("keeps the pay button for a processing row the diner never confirmed", () => {
			// Reload of an untouched checkout: the intent exists, no card was
			// typed. Locking this diner out would be the bug in the other
			// direction.
			mockBackend(confirmingOrder());

			renderPage();

			expect(screen.queryByText("Confirming your payment")).toBeNull();
			expect(screen.getByText("Continue to payment")).toBeTruthy();
		});

		it("ignores a confirmation recorded for an earlier, superseded intent", () => {
			rememberPaymentConfirmation("orders:checkout", {
				paymentIntentId: "pi_old",
				confirmedAt: Date.now(),
			});
			mockBackend(confirmingOrder());

			renderPage();

			expect(screen.getByText("Continue to payment")).toBeTruthy();
		});

		it("swaps the sheet for the confirming state as soon as confirmPayment succeeds", async () => {
			stripeJs.elements = { submit: vi.fn(async () => ({})) };
			stripeJs.stripe = {
				confirmPayment: vi.fn(async () => ({
					paymentIntent: { id: "pi_live", status: "processing" },
				})),
			};
			mockBackend(confirmingOrder());
			renderPage();

			fireEvent.click(screen.getByText("Continue to payment"));
			await waitFor(() => expect(screen.getByTestId("payment-element")).toBeTruthy());
			fireEvent.click(screen.getByText("Pay Now"));

			await waitFor(() => expect(screen.getByText("Confirming your payment")).toBeTruthy());
			expectNoWayToPay();
			// Remembered for a reload.
			expect(readPaymentConfirmation("orders:checkout")?.paymentIntentId).toBe("pi_live");
		});

		describe("escalation", () => {
			beforeEach(() => {
				vi.useFakeTimers();
			});
			afterEach(() => {
				vi.useRealTimers();
			});

			it("tells the diner not to pay again and to show staff once the wait runs long", () => {
				rememberPaymentConfirmation("orders:checkout", {
					paymentIntentId: "pi_live",
					confirmedAt: Date.now(),
				});
				mockBackend(confirmingOrder());
				renderPage();

				expect(screen.getByText("Confirming your payment")).toBeTruthy();
				act(() => {
					vi.advanceTimersByTime(PAYMENT_CONFIRMATION_ESCALATE_AFTER_MS - 1);
				});
				expect(screen.queryByText("Still confirming your payment")).toBeNull();

				act(() => {
					vi.advanceTimersByTime(1);
				});
				expect(screen.getByText("Still confirming your payment")).toBeTruthy();
				expect(screen.getByText(/Please don't pay again/)).toBeTruthy();
				expect(screen.getByText(/show this screen to a staff member/)).toBeTruthy();
				expect(screen.getByText("Order reference #eckout")).toBeTruthy();
				expectNoWayToPay();
			});

			it("resumes the clock from the original confirmation after a reload", () => {
				rememberPaymentConfirmation("orders:checkout", {
					paymentIntentId: "pi_live",
					confirmedAt: Date.now() - PAYMENT_CONFIRMATION_ESCALATE_AFTER_MS - 5_000,
				});
				mockBackend(confirmingOrder());
				renderPage();

				act(() => {
					vi.advanceTimersByTime(0);
				});
				expect(screen.getByText("Still confirming your payment")).toBeTruthy();
			});
		});

		it("moves on to the paid screen when the webhook lands, and forgets the confirmation", () => {
			rememberPaymentConfirmation("orders:checkout", {
				paymentIntentId: "pi_live",
				confirmedAt: Date.now(),
			});
			mockBackend(confirmingOrder());
			const { rerender } = renderPage();
			expect(screen.getByText("Confirming your payment")).toBeTruthy();

			mockBackend(
				confirmingOrder({
					status: "submitted",
					paymentState: "paid",
					activePayment: { status: "succeeded" },
					dailyOrderNumber: 42,
				})
			);
			rerender(
				<OrderCheckoutPage
					orderId={"orders:checkout" as any}
					onBackToMenu={() => {}}
					onViewOrders={() => {}}
				/>
			);

			expect(screen.getByText("Payment complete!")).toBeTruthy();
			expect(readPaymentConfirmation("orders:checkout")).toBeNull();
		});

		it("drops back to a retry with the decline when the webhook reports a failure", () => {
			rememberPaymentConfirmation("orders:checkout", {
				paymentIntentId: "pi_live",
				confirmedAt: Date.now(),
			});
			mockBackend(
				confirmingOrder({
					paymentState: "failed",
					activePayment: { status: "failed", failureMessage: "Your card was declined." },
				})
			);

			renderPage();

			expect(screen.getByText("Your card was declined.")).toBeTruthy();
			expect(screen.getByText("Continue to payment")).toBeTruthy();
			expect(readPaymentConfirmation("orders:checkout")).toBeNull();
		});

		describe("back from a 3-D Secure redirect", () => {
			const renderWithRedirect = (status: string, paymentIntentId = "pi_live") =>
				render(
					<OrderCheckoutPage
						orderId={"orders:checkout" as any}
						onBackToMenu={() => {}}
						onViewOrders={() => {}}
						stripeRedirect={{ paymentIntentId, status }}
					/>
				);

			it("shows the confirming state on a successful redirect, and remembers it", async () => {
				mockBackend(confirmingOrder());

				renderWithRedirect("succeeded");

				expect(screen.getByText("Confirming your payment")).toBeTruthy();
				expectNoWayToPay();
				await waitFor(() =>
					expect(readPaymentConfirmation("orders:checkout")?.paymentIntentId).toBe("pi_live")
				);
			});

			it("says nothing was charged and offers a retry on a failed redirect", () => {
				mockBackend(confirmingOrder());

				renderWithRedirect("failed");

				expect(
					screen.getByText(
						"Your bank didn't approve the payment, so you weren't charged. Please try again or choose another way to pay."
					)
				).toBeTruthy();
				expect(screen.getByText("Continue to payment")).toBeTruthy();
			});

			it("ignores redirect params for an intent the order no longer points at", () => {
				mockBackend(confirmingOrder());

				renderWithRedirect("succeeded", "pi_old");

				expect(screen.queryByText("Confirming your payment")).toBeNull();
				expect(screen.getByText("Continue to payment")).toBeTruthy();
			});
		});
	});

	it("falls back to not-found instead of spinning when the order query errors", () => {
		vi.mocked(useQuery).mockReturnValue({ data: undefined, isError: true } as any);

		renderPage();

		expect(
			screen.getByText("We couldn't load this order. It may have already been sent or cancelled.")
		).toBeTruthy();
	});
});
