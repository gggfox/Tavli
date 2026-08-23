/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { useConvexAction, useConvexMutation } from "@convex-dev/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionStore } from "../hooks/useSession";
import { VisitCloseoutPage } from "./VisitCloseoutPage";

vi.mock("@tanstack/react-query", () => ({
	useQuery: vi.fn(),
	useMutation: vi.fn(),
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: vi.fn((ref, args) => ({ ref, args })),
	useConvexAction: vi.fn(),
	useConvexMutation: vi.fn(),
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

const createTipChargeMock = vi.fn<
	() => Promise<{ clientSecret: string | null; paymentId: string }>
>(async () => ({ clientSecret: null, paymentId: "payments:tip1" }));
const closeMock = vi.fn(async () => null);

/** Caller-scoped visit summary as `sessions.getVisitSummary` returns it. */
function baseSummary(overrides: Record<string, any> = {}) {
	return {
		sessionId: "sessions:test",
		restaurantId: "restaurants:test",
		sessionStatus: "active",
		currency: "USD",
		// 25000 → presets 2500 / 3750 / 5000 (the spec's math case).
		myPaidTotal: 25000,
		myOrderCount: 2,
		myTipPayments: [],
		myActiveTipPayment: null,
		hasSavedCard: true,
		canClose: true,
		closeBlockedReason: null,
		...overrides,
	};
}

function mockBackend(summary: Record<string, any> | null | undefined) {
	vi.mocked(useQuery).mockReturnValue({ data: summary, isLoading: false } as any);
	vi.mocked(useConvexAction).mockReturnValue(createTipChargeMock as any);
	vi.mocked(useConvexMutation).mockReturnValue(closeMock as any);
}

function renderPage(props: Partial<{ onBackToOrders: () => void; onDone: () => void }> = {}) {
	return render(
		<VisitCloseoutPage
			onBackToOrders={props.onBackToOrders ?? (() => {})}
			onDone={props.onDone ?? (() => {})}
		/>
	);
}

describe("VisitCloseoutPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		useSessionStore.setState({
			sessionId: "sessions:test" as any,
			restaurantId: "restaurants:test" as any,
		});
	});

	it("shows the caller's visit total, order count, and preset amounts computed on it", () => {
		mockBackend(baseSummary());
		renderPage();

		expect(screen.getByText("$250.00")).toBeTruthy();
		expect(screen.getByText("2 orders")).toBeTruthy();
		// 25000 → 10% = 2500, 15% = 3750, 20% = 5000.
		expect(screen.getByText("$25.00")).toBeTruthy();
		expect(screen.getByText("$37.50")).toBeTruthy();
		expect(screen.getByText("$50.00")).toBeTruthy();
		// Default selection is 10%, reflected in the CTA amount.
		expect(screen.getByText(/Add tip · \$25\.00/)).toBeTruthy();
		// No 0% preset — Skip / custom 0 cover it.
		expect(screen.queryByText("0%")).toBeNull();
	});

	it("recomputes the CTA when another preset is selected", () => {
		mockBackend(baseSummary());
		renderPage();

		fireEvent.click(screen.getByLabelText("Tip 20%"));
		expect(screen.getByText(/Add tip · \$50\.00/)).toBeTruthy();
	});

	it("one-taps the saved card and shows the thank-you card with the tip amount", async () => {
		mockBackend(baseSummary());
		createTipChargeMock.mockResolvedValueOnce({ clientSecret: null, paymentId: "payments:tip1" });
		renderPage();

		fireEvent.click(screen.getByText(/Add tip · \$25\.00/));

		await waitFor(() => {
			expect(createTipChargeMock).toHaveBeenCalledWith({
				sessionId: "sessions:test",
				tipAmount: 2500,
			});
			expect(screen.getByText("Thank you!")).toBeTruthy();
			expect(screen.getByText(/\$25\.00 tip goes straight to the team/)).toBeTruthy();
		});
		// The tip never closes the session by itself.
		expect(closeMock).not.toHaveBeenCalled();
	});

	it("mounts the Elements fallback when the charge needs the payment sheet", async () => {
		mockBackend(baseSummary({ hasSavedCard: false }));
		createTipChargeMock.mockResolvedValueOnce({
			clientSecret: "cs_tip_test",
			paymentId: "payments:tip1",
		});
		renderPage();

		fireEvent.click(screen.getByText(/Add tip · \$25\.00/));

		await waitFor(() => {
			expect(screen.getByTestId("payment-element")).toBeTruthy();
			expect(screen.getByText("Confirm your tip")).toBeTruthy();
		});
	});

	it("skip closes the session, clears the local session, and navigates without charging", async () => {
		mockBackend(baseSummary());
		const onDone = vi.fn();
		renderPage({ onDone });

		fireEvent.click(screen.getByText("Skip"));

		await waitFor(() => {
			expect(closeMock).toHaveBeenCalledWith({ sessionId: "sessions:test" });
			expect(onDone).toHaveBeenCalled();
		});
		expect(createTipChargeMock).not.toHaveBeenCalled();
		expect(useSessionStore.getState().sessionId).toBeNull();
	});

	it("a custom tip of 0 is allowed and behaves as skip (never charges)", async () => {
		mockBackend(baseSummary());
		const onDone = vi.fn();
		renderPage({ onDone });

		fireEvent.click(screen.getByText("Custom"));
		fireEvent.change(screen.getByPlaceholderText("Tip amount"), { target: { value: "0" } });
		fireEvent.click(screen.getByText(/Add tip · \$0\.00/));

		await waitFor(() => {
			expect(closeMock).toHaveBeenCalledWith({ sessionId: "sessions:test" });
			expect(onDone).toHaveBeenCalled();
		});
		expect(createTipChargeMock).not.toHaveBeenCalled();
	});

	it("a blocked close surfaces the reason and does not close or navigate", async () => {
		mockBackend(
			baseSummary({
				canClose: false,
				closeBlockedReason: "ERROR_SESSION_AWAITING_PAYMENT_ORDERS",
			})
		);
		const onDone = vi.fn();
		renderPage({ onDone });

		// The reason is explained proactively…
		expect(screen.getAllByText(/waiting to be paid in person/).length).toBeGreaterThan(0);

		// …and the walk-away path refuses to close while blocked.
		fireEvent.click(screen.getByText("Skip"));
		await waitFor(() => {
			expect(closeMock).not.toHaveBeenCalled();
		});
		expect(onDone).not.toHaveBeenCalled();
		expect(useSessionStore.getState().sessionId).toBe("sessions:test");
	});

	it("a member who paid nothing sees no tip UI, just the close path", async () => {
		mockBackend(baseSummary({ myPaidTotal: 0, myOrderCount: 0 }));
		const onDone = vi.fn();
		renderPage({ onDone });

		expect(screen.queryByText("Add a tip for the team")).toBeNull();
		expect(screen.queryByText(/Add tip ·/)).toBeNull();
		expect(screen.getByText(/didn't pay for any orders/)).toBeTruthy();

		fireEvent.click(screen.getByText("Done"));
		await waitFor(() => {
			expect(closeMock).toHaveBeenCalledWith({ sessionId: "sessions:test" });
			expect(onDone).toHaveBeenCalled();
		});
	});

	it("shows tips already given and still allows adding another", () => {
		mockBackend(
			baseSummary({
				myTipPayments: [
					{ paymentId: "payments:tipA", amount: 1500 },
					{ paymentId: "payments:tipB", amount: 500 },
				],
			})
		);
		renderPage();

		expect(screen.getByText(/Tip added · \$20\.00/)).toBeTruthy();
		// The selector stays available for a re-tip.
		expect(screen.getByText(/Add tip · \$25\.00/)).toBeTruthy();
	});

	it("an already-closed session skips the close call but still clears and navigates", async () => {
		mockBackend(baseSummary({ sessionStatus: "closed", canClose: false }));
		const onDone = vi.fn();
		renderPage({ onDone });

		fireEvent.click(screen.getByText("Skip"));
		await waitFor(() => {
			expect(onDone).toHaveBeenCalled();
		});
		expect(closeMock).not.toHaveBeenCalled();
		expect(useSessionStore.getState().sessionId).toBeNull();
	});
});
