/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { getFunctionName } from "convex/server";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { SessionOrdersList } from "./SessionOrdersList";

vi.mock("@tanstack/react-query", () => ({
	useQuery: vi.fn(),
	useMutation: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: vi.fn((ref, args) => ({ ref, args })),
	useConvexMutation: vi.fn(() => vi.fn()),
}));

vi.mock("../hooks/useSession", () => ({
	useSessionStore: () => ({ sessionId: "sessions:test", setSession: vi.fn() }),
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
		paymentState: "unpaid",
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

function baseTab(overrides: Record<string, any> = {}) {
	return {
		sessionId: "sessions:test",
		restaurantId: "restaurants:test",
		joinCode: "ABC234",
		memberCount: 1,
		lockedForPayment: false,
		paymentState: "unpaid",
		tipAmount: 0,
		paidAt: null,
		subtotal: 2400,
		payableOrderIds: ["orders:default"],
		activePayment: null,
		...overrides,
	};
}

/** Routes the shared useQuery mock by the convexQuery ref it was built with. */
function mockQueries({ orders, tab }: { orders: any[]; tab: Record<string, any> | null }) {
	vi.mocked(useQuery).mockImplementation(
		(options: any) =>
			({
				data: getFunctionName(options?.ref) === "sessions:getTabSummary" ? tab : orders,
				isLoading: false,
			}) as any
	);
}

function renderList(
	props: Partial<{
		onBackToMenu: () => void;
		onViewOrder: (id: any) => void;
		onPayTab: () => void;
	}> = {}
) {
	return render(
		<SessionOrdersList
			slug="test-restaurant"
			onBackToMenu={props.onBackToMenu ?? (() => {})}
			onViewOrder={props.onViewOrder ?? (() => {})}
			onPayTab={props.onPayTab ?? (() => {})}
		/>
	);
}

describe("SessionOrdersList", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders an empty state when the session has no orders", () => {
		mockQueries({ orders: [], tab: baseTab({ subtotal: 0, payableOrderIds: [] }) });

		renderList();

		expect(screen.getByText("No orders yet")).toBeTruthy();
		expect(screen.getByText("Browse menu")).toBeTruthy();
	});

	it("hides empty draft orders (placeholder drafts with no items)", () => {
		mockQueries({
			orders: [baseOrder({ _id: "orders:empty-draft", status: "draft", totalAmount: 0 })],
			tab: baseTab({ subtotal: 0, payableOrderIds: [] }),
		});

		renderList();

		expect(screen.getByText("No orders yet")).toBeTruthy();
	});

	it("shows the tab balance with a pay CTA and the share code", () => {
		mockQueries({
			orders: [baseOrder({})],
			tab: baseTab({ subtotal: 2400 }),
		});

		const onPayTab = vi.fn();
		renderList({ onPayTab });

		expect(screen.getByText("ABC234")).toBeTruthy();

		const payButton = screen.getByText(/Pay tab/);
		fireEvent.click(payButton);
		expect(onPayTab).toHaveBeenCalled();
	});

	it("disables the pay CTA when the tab has no balance", () => {
		mockQueries({
			orders: [],
			tab: baseTab({ subtotal: 0, payableOrderIds: [] }),
		});

		renderList();

		const payButton = screen.getByText(/Pay tab/).closest("button");
		expect(payButton?.disabled).toBe(true);
	});

	it("routes submitted orders to the order status page", () => {
		mockQueries({
			orders: [baseOrder({ _id: "orders:submitted", status: "submitted" })],
			tab: baseTab(),
		});

		const onViewOrder = vi.fn();
		renderList({ onViewOrder });

		expect(screen.getByText("Order placed")).toBeTruthy();

		fireEvent.click(screen.getByText("View →"));
		expect(onViewOrder).toHaveBeenCalledWith("orders:submitted");
	});

	it("sorts the list by creation time, newest first", () => {
		mockQueries({
			orders: [
				baseOrder({
					_id: "orders:older",
					_creationTime: now - 2 * 60 * 60 * 1000,
					totalAmount: 1000,
				}),
				baseOrder({ _id: "orders:newer", _creationTime: now, totalAmount: 2000 }),
			],
			tab: baseTab({ subtotal: 3000 }),
		});

		renderList();

		const amounts = screen
			.getAllByText(/^\$\d/)
			.map((el) => el.textContent)
			.filter((text) => text === "$20.00" || text === "$10.00");
		expect(amounts[0]).toBe("$20.00");
		expect(amounts[1]).toBe("$10.00");
	});
});
