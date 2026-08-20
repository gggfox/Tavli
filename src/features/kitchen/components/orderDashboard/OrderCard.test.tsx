import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OrderCard } from "./OrderCard";
import type { DashboardOrder, DashboardOrderItem } from "./statusConfig";

vi.mock("react-i18next", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react-i18next")>();
	return {
		...actual,
		useTranslation: () => ({
			t: (key: string) => key,
			i18n: { language: "en" },
		}),
	};
});

vi.mock("@/global/i18n", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/global/i18n")>();
	return {
		...actual,
		localizeName: (fallback: string) => fallback,
		useLocalizedName: (fallback: string) => fallback,
	};
});

function makeItem(overrides: Partial<DashboardOrderItem> = {}): DashboardOrderItem {
	return {
		_id: "oi1" as DashboardOrderItem["_id"],
		_creationTime: 0,
		orderId: "ord1" as DashboardOrderItem["orderId"],
		menuItemId: "mi1" as DashboardOrderItem["menuItemId"],
		menuItemName: "Tacos",
		quantity: 1,
		unitPrice: 600,
		selectedOptions: [],
		lineTotal: 600,
		createdAt: 0,
		prepStation: "kitchen",
		...overrides,
	} as DashboardOrderItem;
}

function makeOrder(overrides: Partial<DashboardOrder> = {}): DashboardOrder {
	return {
		_id: "ord1" as DashboardOrder["_id"],
		_creationTime: 0,
		sessionId: "s1" as DashboardOrder["sessionId"],
		restaurantId: "r1" as DashboardOrder["restaurantId"],
		tableId: "t1" as DashboardOrder["tableId"],
		status: "awaiting_payment",
		totalAmount: 1400,
		dailyOrderNumber: 7,
		createdAt: 0,
		awaitingPaymentAt: 1_000,
		updatedAt: 0,
		tableNumber: 4,
		items: [makeItem()],
		...overrides,
	} as DashboardOrder;
}

function renderCard(
	order: DashboardOrder,
	overrides: Partial<Parameters<typeof OrderCard>[0]> = {}
) {
	const handlers = {
		onSelectFullOrder: vi.fn(),
		onRequestCancel: vi.fn(),
		onDismissCancel: vi.fn(),
		onCancelOrder: vi.fn(),
		onRequestMarkPaid: vi.fn(),
		onDismissMarkPaid: vi.fn(),
		onMarkPaidInPerson: vi.fn(),
		onUpdateStatus: vi.fn(),
		onMarkStationReady: vi.fn(),
	};
	const view = render(
		<OrderCard
			order={order}
			now={61_000}
			cancelConfirm={null}
			cancelPendingId={null}
			markPaidConfirm={null}
			markPaidPendingId={null}
			markPaidError={null}
			activeStationFilters={new Set()}
			{...handlers}
			{...overrides}
		/>
	);
	return { handlers, view };
}

describe("OrderCard awaiting-payment variant (ADR 008)", () => {
	it("shows amount due, the day number, and the mark-paid-in-person action", () => {
		renderCard(makeOrder());

		expect(screen.getByText("orders.markPaid.amountDue")).toBeInTheDocument();
		expect(screen.getByText("orders.markPaid.action")).toBeInTheDocument();
		// Cancel stays available: awaiting_payment → cancelled is a valid
		// transition and, being unpaid, needs no refund.
		expect(screen.getByText("orders.actions.cancel")).toBeInTheDocument();
		// No next-status workflow action for money-owed orders.
		expect(screen.queryByText("orders.actions.accept")).not.toBeInTheDocument();
	});

	it("asks the dashboard to open the confirmation instead of mutating directly", () => {
		const { handlers } = renderCard(makeOrder());

		fireEvent.click(screen.getByText("orders.markPaid.action"));
		expect(handlers.onRequestMarkPaid).toHaveBeenCalledWith("ord1");
		expect(handlers.onMarkPaidInPerson).not.toHaveBeenCalled();
	});

	it("calls the mark-paid mutation only from the confirmation dialog", () => {
		const order = makeOrder();
		const { handlers } = renderCard(order, { markPaidConfirm: order._id });

		expect(screen.getByText("orders.markPaid.promptTitle")).toBeInTheDocument();
		expect(screen.getByText("orders.markPaid.promptBody")).toBeInTheDocument();

		fireEvent.click(screen.getByText("orders.markPaid.confirm"));
		expect(handlers.onMarkPaidInPerson).toHaveBeenCalledWith("ord1");
	});

	it("lets staff back out of the confirmation", () => {
		const order = makeOrder();
		const { handlers } = renderCard(order, { markPaidConfirm: order._id });

		fireEvent.click(screen.getByText("orders.markPaid.dismiss"));
		expect(handlers.onDismissMarkPaid).toHaveBeenCalled();
		expect(handlers.onMarkPaidInPerson).not.toHaveBeenCalled();
	});

	it("surfaces a failed mark-paid attempt inside the confirmation", () => {
		const order = makeOrder();
		renderCard(order, { markPaidConfirm: order._id, markPaidError: "boom" });

		expect(screen.getByRole("alert")).toHaveTextContent("boom");
	});

	it("does not offer mark-paid on ordinary workflow statuses", () => {
		renderCard(makeOrder({ status: "submitted", awaitingPaymentAt: undefined }));

		expect(screen.queryByText("orders.markPaid.action")).not.toBeInTheDocument();
		expect(screen.queryByText("orders.markPaid.amountDue")).not.toBeInTheDocument();
		// The normal queue action is still there.
		expect(screen.getByText("orders.actions.accept")).toBeInTheDocument();
	});
});

describe("OrderCard table prominence (TAVLI-80)", () => {
	it("gives the table the loudest type on a served card, ahead of the order number", () => {
		renderCard(makeOrder({ status: "served", awaitingPaymentAt: undefined }));

		const table = screen.getByText("orders.card.table");
		expect(table.className).toContain("text-xl");
		expect(table.className).toContain("font-bold");
		expect(screen.getByText("orders.card.dayNumber").className).toContain("text-sm");
	});

	it("keeps the table the loudest line on a ready card", () => {
		renderCard(makeOrder({ status: "ready", awaitingPaymentAt: undefined }));

		expect(screen.getByText("orders.card.table").className).toContain("text-xl");
	});

	it("leads the awaiting-payment panel with the table, not the order number", () => {
		renderCard(makeOrder());

		// Header + money panel both name the table, and both at the top scale.
		const tables = screen.getAllByText("orders.card.table");
		expect(tables).toHaveLength(2);
		for (const node of tables) expect(node.className).toContain("text-xl");
		// The order number is now the secondary line inside the panel — nothing
		// on the card shouts it louder than the table.
		const dayNumbers = screen.getAllByText("orders.card.dayNumber");
		expect(dayNumbers.some((node) => node.className.includes("text-xs"))).toBe(true);
		expect(dayNumbers.every((node) => !node.className.includes("text-xl"))).toBe(true);
	});

	it("says 'no table' instead of inventing a table when the join came back null", () => {
		renderCard(makeOrder({ tableNumber: null }));

		expect(screen.getAllByText("orders.card.tableNone")).toHaveLength(2);
		expect(screen.queryByText("orders.card.table")).not.toBeInTheDocument();
	});
});
