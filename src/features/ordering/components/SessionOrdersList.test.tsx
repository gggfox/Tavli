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
		// `getOrdersBySession` now returns each order with its lines, so the
		// hover summary card has them without a second round-trip (TAVLI-99).
		items: [
			{
				_id: "orderItems:default",
				menuItemName: "Tacos al pastor",
				quantity: 2,
				lineTotal: 2400,
			},
		],
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
		unservedOrderIds: [],
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
		onContinueCheckout: (id: any) => void;
		onPayTab: () => void;
		onCloseout: () => void;
	}> = {}
) {
	return render(
		<SessionOrdersList
			onBackToMenu={props.onBackToMenu ?? (() => {})}
			onViewOrder={props.onViewOrder ?? (() => {})}
			onContinueCheckout={props.onContinueCheckout ?? (() => {})}
			onPayTab={props.onPayTab ?? (() => {})}
			onCloseout={props.onCloseout ?? (() => {})}
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

	it("shows the legacy tab balance with a pay CTA when the tab still owes", () => {
		mockQueries({
			orders: [baseOrder({})],
			tab: baseTab({ subtotal: 2400 }),
		});

		const onPayTab = vi.fn();
		renderList({ onPayTab });

		const payButton = screen.getByText(/Pay tab/);
		fireEvent.click(payButton);
		expect(onPayTab).toHaveBeenCalled();
	});

	it("hides the legacy pay-tab card entirely for a settled (post-pivot) session", () => {
		// New-model sessions always report subtotal 0 — orders pay at submit
		// (ADR 008), so the whole-tab settlement surface must not render.
		mockQueries({
			orders: [baseOrder({ status: "submitted", paymentState: "paid" })],
			tab: baseTab({ subtotal: 0, payableOrderIds: [] }),
		});

		renderList();

		expect(screen.queryByText(/Pay tab/)).toBeNull();
	});

	it("shows no join code and no join form", () => {
		// Retired by TAVLI-99. Grouping a table's orders is a staff-side concern
		// now (TAVLI-100), not something a diner arranges by reading a code
		// aloud. `sessions.joinByCode` stays on the backend for sessions that
		// were already shared, so this is a UI removal, not a migration.
		mockQueries({ orders: [baseOrder({})], tab: baseTab({ subtotal: 2400 }) });
		renderList();

		expect(screen.queryByText("ABC234")).toBeNull();
		expect(screen.queryByText("Joining a friend's tab?")).toBeNull();
	});

	it("routes a draft row to the per-order checkout with a continue-to-payment CTA", () => {
		mockQueries({
			orders: [baseOrder({ _id: "orders:draft", status: "draft", totalAmount: 2400 })],
			tab: baseTab({ subtotal: 0, payableOrderIds: [] }),
		});

		const onContinueCheckout = vi.fn();
		const onViewOrder = vi.fn();
		renderList({ onContinueCheckout, onViewOrder });

		fireEvent.click(screen.getByText(/Continue to payment/));
		expect(onContinueCheckout).toHaveBeenCalledWith("orders:draft");
		expect(onViewOrder).not.toHaveBeenCalled();
	});

	it("shows a paid badge on settled orders and the awaiting-payment hint on cash orders", () => {
		mockQueries({
			orders: [
				baseOrder({
					_id: "orders:paid",
					status: "submitted",
					paymentState: "paid",
					dailyOrderNumber: 7,
				}),
				baseOrder({
					_id: "orders:cash",
					_creationTime: now - 60_000,
					status: "awaiting_payment",
					paymentState: "unpaid",
					dailyOrderNumber: 8,
				}),
			],
			tab: baseTab({ subtotal: 0, payableOrderIds: [] }),
		});

		renderList();

		expect(screen.getByText("Paid")).toBeTruthy();
		// Order number + pay-with-your-server hint for the cash path.
		expect(screen.getByText("#8")).toBeTruthy();
		expect(screen.getByText("Pay with your server")).toBeTruthy();
	});

	it("disables the pay CTA while an order has not reached the table", () => {
		// The tab is still billed for it — only settlement is held back.
		mockQueries({
			orders: [baseOrder({ _id: "orders:cooking", status: "preparing" })],
			tab: baseTab({ unservedOrderIds: ["orders:cooking"] }),
		});

		renderList();

		const payButton = screen.getByText(/Pay tab/).closest("button");
		expect(payButton?.disabled).toBe(true);
		expect(screen.getByText(/hasn't reached your table yet/)).toBeTruthy();
	});

	it("keeps the locked notice when a payment is in flight, even if orders are unserved", () => {
		// Nothing the diner can do but wait, so "ask your server" would be wrong.
		mockQueries({
			orders: [baseOrder({ _id: "orders:cooking", status: "preparing" })],
			tab: baseTab({ lockedForPayment: true, unservedOrderIds: ["orders:cooking"] }),
		});

		renderList();

		expect(screen.getByText(/A payment is in progress/)).toBeTruthy();
		expect(screen.queryByText(/hasn't reached your table yet/)).toBeNull();
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

	it("shows the close-out CTA while the session is active and routes to the closeout screen", () => {
		mockQueries({
			orders: [baseOrder({ status: "submitted", paymentState: "paid" })],
			tab: baseTab({ subtotal: 0, payableOrderIds: [] }),
		});

		const onCloseout = vi.fn();
		renderList({ onCloseout });

		fireEvent.click(screen.getByText("Close out & tip"));
		expect(onCloseout).toHaveBeenCalled();
	});

	it("hides the close-out CTA when there is no active session (tab summary null)", () => {
		mockQueries({ orders: [baseOrder({})], tab: null });

		renderList();

		expect(screen.queryByText("Close out & tip")).toBeNull();
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
