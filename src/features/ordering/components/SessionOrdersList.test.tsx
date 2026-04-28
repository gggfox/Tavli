/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { SessionOrdersList } from "./SessionOrdersList";

vi.mock("@tanstack/react-query", () => ({
	useQuery: vi.fn(),
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: vi.fn((ref, args) => ({ ref, args })),
}));

vi.mock("../hooks/useSession", () => ({
	useSessionStore: () => ({ sessionId: "sessions:test" }),
}));

const now = 1_745_000_000_000;

function baseOrder(overrides: Record<string, any>) {
	return {
		_id: "orders:default",
		_creationTime: now,
		sessionId: "sessions:test",
		restaurantId: "restaurants:test",
		tableId: "tables:test",
		status: "submitted",
		totalAmount: 2400,
		paymentState: "paid",
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

describe("SessionOrdersList", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders an empty state when the session has no orders", () => {
		vi.mocked(useQuery).mockReturnValue({ data: [], isLoading: false } as any);

		render(
			<SessionOrdersList
				onBackToMenu={() => {}}
				onViewOrder={() => {}}
				onResumeCheckout={() => {}}
			/>
		);

		expect(screen.getByText("No orders yet")).toBeTruthy();
		expect(screen.getByText("Browse menu")).toBeTruthy();
	});

	it("hides empty draft orders (placeholder drafts with no items)", () => {
		vi.mocked(useQuery).mockReturnValue({
			data: [baseOrder({ _id: "orders:empty-draft", status: "draft", totalAmount: 0 })],
			isLoading: false,
		} as any);

		render(
			<SessionOrdersList
				onBackToMenu={() => {}}
				onViewOrder={() => {}}
				onResumeCheckout={() => {}}
			/>
		);

		expect(screen.getByText("No orders yet")).toBeTruthy();
	});

	it("shows unpaid drafts with a 'Finish checkout' affordance", () => {
		vi.mocked(useQuery).mockReturnValue({
			data: [
				baseOrder({
					_id: "orders:unpaid-draft",
					status: "draft",
					paymentState: "unpaid",
					totalAmount: 1800,
				}),
			],
			isLoading: false,
		} as any);

		const onResumeCheckout = vi.fn();

		render(
			<SessionOrdersList
				onBackToMenu={() => {}}
				onViewOrder={() => {}}
				onResumeCheckout={onResumeCheckout}
			/>
		);

		expect(screen.getByText("Unpaid")).toBeTruthy();
		expect(screen.getByText("Finish checkout →")).toBeTruthy();

		fireEvent.click(screen.getByText("Finish checkout →"));
		expect(onResumeCheckout).toHaveBeenCalledWith("orders:unpaid-draft");
	});

	it("routes submitted orders to the order status page", () => {
		vi.mocked(useQuery).mockReturnValue({
			data: [baseOrder({ _id: "orders:submitted", status: "submitted" })],
			isLoading: false,
		} as any);

		const onViewOrder = vi.fn();

		render(
			<SessionOrdersList
				onBackToMenu={() => {}}
				onViewOrder={onViewOrder}
				onResumeCheckout={() => {}}
			/>
		);

		expect(screen.getByText("Order placed")).toBeTruthy();

		fireEvent.click(screen.getByText("View →"));
		expect(onViewOrder).toHaveBeenCalledWith("orders:submitted");
	});

	it("sorts the list by creation time, newest first", () => {
		vi.mocked(useQuery).mockReturnValue({
			data: [
				baseOrder({ _id: "orders:older", _creationTime: now - 2 * 60 * 60 * 1000, totalAmount: 1000 }),
				baseOrder({ _id: "orders:newer", _creationTime: now, totalAmount: 2000 }),
			],
			isLoading: false,
		} as any);

		render(
			<SessionOrdersList
				onBackToMenu={() => {}}
				onViewOrder={() => {}}
				onResumeCheckout={() => {}}
			/>
		);

		const amounts = screen.getAllByText(/\$\d/).map((el) => el.textContent);
		expect(amounts[0]).toBe("$20.00");
		expect(amounts[1]).toBe("$10.00");
	});
});
