import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StationTicketCard } from "./StationTicketCard";
import type { StationTicket } from "./stationTickets";
import type { DashboardOrder, DashboardOrderItem } from "./statusConfig";

vi.mock("react-i18next", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react-i18next")>();
	return {
		...actual,
		useTranslation: () => ({
			t: (key: string, vars?: Record<string, unknown>) =>
				vars ? `${key}:${JSON.stringify(vars)}` : key,
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
		menuItemName: "Margarita",
		quantity: 1,
		unitPrice: 600,
		selectedOptions: [],
		lineTotal: 600,
		createdAt: 0,
		prepStation: "bar",
		...overrides,
	} as DashboardOrderItem;
}

function makeTicket(
	orderOverrides: Partial<DashboardOrder> = {},
	items?: DashboardOrderItem[]
): StationTicket {
	const ticketItems = items ?? [makeItem()];
	const order = {
		_id: "ord1" as DashboardOrder["_id"],
		_creationTime: 0,
		sessionId: "s1" as DashboardOrder["sessionId"],
		restaurantId: "r1" as DashboardOrder["restaurantId"],
		tableId: "t1" as DashboardOrder["tableId"],
		status: "preparing",
		totalAmount: 600,
		dailyOrderNumber: 12,
		paymentState: "paid",
		createdAt: 0,
		updatedAt: 0,
		tableNumber: 4,
		items: ticketItems,
		...orderOverrides,
	} as DashboardOrder;

	return { order, station: "bar", items: ticketItems };
}

function renderCard(
	ticket: StationTicket,
	handlers: Record<string, ReturnType<typeof vi.fn>> = {}
) {
	const props = {
		onSelectFullOrder: vi.fn(),
		onUpdateStatus: vi.fn(),
		onMarkStationReady: vi.fn(),
		onCancelItem: vi.fn(),
		...handlers,
	};
	render(
		<StationTicketCard
			ticket={ticket}
			now={0}
			cancelItemPendingId={null}
			cancelItemError={null}
			onSelectFullOrder={props.onSelectFullOrder}
			onUpdateStatus={props.onUpdateStatus}
			onMarkStationReady={props.onMarkStationReady}
			onCancelItem={props.onCancelItem}
		/>
	);
	return props;
}

describe("StationTicketCard", () => {
	it("renders every item, with no 'more items' cap", () => {
		const items = Array.from({ length: 9 }, (_, i) =>
			makeItem({
				_id: `oi${i}` as DashboardOrderItem["_id"],
				menuItemName: `Drink ${i}`,
			})
		);
		renderCard(makeTicket({}, items));

		for (let i = 0; i < 9; i++) {
			expect(screen.getByText(new RegExp(`Drink ${i}`))).toBeTruthy();
		}
		expect(screen.queryByText(/moreItems/)).toBeNull();
	});

	it("leaves money and whole-order cancellation to the overview", () => {
		renderCard(makeTicket());

		expect(screen.queryByText(/\$/)).toBeNull();
		expect(screen.queryByText(/orders.card.paid/)).toBeNull();
		expect(screen.queryByText(/^orders.actions.cancel$/)).toBeNull();
	});

	it("surfaces the order-level note", () => {
		renderCard(makeTicket({ specialInstructions: "Peanut allergy at the table" }));

		expect(screen.getByText(/Peanut allergy at the table/)).toBeTruthy();
	});

	it("accepts the whole round when the order is still submitted", () => {
		const { onUpdateStatus, onMarkStationReady } = renderCard(makeTicket({ status: "submitted" }));

		fireEvent.click(screen.getByText(/orders.actions.accept/));
		expect(onUpdateStatus).toHaveBeenCalledWith({ orderId: "ord1", newStatus: "preparing" });
		expect(onMarkStationReady).not.toHaveBeenCalled();
	});

	it("marks only its own station ready while preparing", () => {
		const { onMarkStationReady } = renderCard(makeTicket({ status: "preparing" }));

		fireEvent.click(screen.getByText(/orders.actions.markBarReady/));
		expect(onMarkStationReady).toHaveBeenCalledWith({ orderId: "ord1", station: "bar" });
	});

	it("requires a confirmation before 86'ing an item", () => {
		const { onCancelItem } = renderCard(makeTicket());

		fireEvent.click(screen.getByText(/orders.ticket.cancelItem/));
		expect(onCancelItem).not.toHaveBeenCalled();

		fireEvent.click(screen.getByText(/orders.ticket.confirmCancelItem/));
		expect(onCancelItem).toHaveBeenCalledWith("oi1");
	});

	it("abandons the 86 when the confirmation is dismissed", () => {
		const { onCancelItem } = renderCard(makeTicket());

		fireEvent.click(screen.getByText(/orders.ticket.cancelItem/));
		fireEvent.click(screen.getByText(/orders.ticket.keepItem/));
		expect(onCancelItem).not.toHaveBeenCalled();
		expect(screen.getByText(/orders.ticket.cancelItem/)).toBeTruthy();
	});
});
