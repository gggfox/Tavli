/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { useConvexMutation } from "@convex-dev/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionStore } from "../hooks/useSession";
import { VisitCloseoutPage } from "./VisitCloseoutPage";

vi.mock("@tanstack/react-query", () => ({
	useQuery: vi.fn(),
	useMutation: vi.fn(),
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: vi.fn((ref, args) => ({ ref, args })),
	useConvexMutation: vi.fn(),
}));

const closeMock = vi.fn(async () => null);

/** Caller-scoped visit summary as `sessions.getVisitSummary` returns it. */
function baseSummary(overrides: Record<string, any> = {}) {
	return {
		sessionId: "sessions:test",
		restaurantId: "restaurants:test",
		sessionStatus: "active",
		currency: "USD",
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

	it("shows the caller's own visit total and order count", () => {
		// `getVisitSummary` is caller-scoped: two friends on one tab each see
		// only their own spend, and this screen must not leak the other's.
		mockBackend(baseSummary());
		renderPage();

		// The \$ is a sibling text node, so match the number itself.
		expect(screen.getByText(/250\.00/)).toBeTruthy();
		// `/2/` alone matches the total too — scope to the order-count copy.
		expect(screen.getByText(/\b2\b.*order|order.*\b2\b/i)).toBeTruthy();
	});

	it("offers no tip control at all", () => {
		// The tip moved to the per-order payment page (TAVLI-99). A tip control
		// surviving here would charge a diner twice for the same intent.
		mockBackend(baseSummary());
		renderPage();

		expect(screen.queryByRole("slider")).toBeNull();
		expect(screen.queryByTestId("stripe-elements")).toBeNull();
		expect(screen.queryByTestId("payment-element")).toBeNull();
	});

	it("closes the session, clears it locally, and navigates", async () => {
		const onDone = vi.fn();
		mockBackend(baseSummary());
		renderPage({ onDone });

		fireEvent.click(screen.getByRole("button", { name: /done/i }));

		await waitFor(() => expect(closeMock).toHaveBeenCalledWith({ sessionId: "sessions:test" }));
		expect(onDone).toHaveBeenCalled();
		expect(useSessionStore.getState().sessionId).toBeNull();
	});

	it("surfaces a blocked close and does not close or navigate", async () => {
		// An uncollected cash order needs staff, not another tap. Closing anyway
		// would strand money owed with no record that anyone was told.
		const onDone = vi.fn();
		mockBackend(
			baseSummary({
				canClose: false,
				closeBlockedReason: "ERROR_SESSION_AWAITING_PAYMENT_ORDERS",
			})
		);
		renderPage({ onDone });

		fireEvent.click(screen.getByRole("button", { name: /done/i }));

		await waitFor(() => expect(closeMock).not.toHaveBeenCalled());
		expect(onDone).not.toHaveBeenCalled();
	});

	it("still shows tips already given this visit", () => {
		// A diner who tipped per order should see it here rather than a screen
		// that quietly forgot.
		mockBackend(baseSummary({ myTipPayments: [{ amount: 3000 }] }));
		renderPage();
		expect(screen.getByText(/30\.00/)).toBeTruthy();
	});

	it("shows the close path to a member who paid nothing", async () => {
		const onDone = vi.fn();
		mockBackend(baseSummary({ myPaidTotal: 0, myOrderCount: 0 }));
		renderPage({ onDone });

		fireEvent.click(screen.getByRole("button", { name: /done/i }));
		await waitFor(() => expect(onDone).toHaveBeenCalled());
	});

	it("an already-closed session skips the close call but still clears and navigates", async () => {
		const onDone = vi.fn();
		mockBackend(baseSummary({ sessionStatus: "closed" }));
		renderPage({ onDone });

		fireEvent.click(screen.getByRole("button", { name: /done/i }));

		await waitFor(() => expect(onDone).toHaveBeenCalled());
		expect(closeMock).not.toHaveBeenCalled();
	});
});
