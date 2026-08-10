import { describe, expect, it } from "vitest";
import { deriveStationTickets } from "./stationTickets";
import type { DashboardOrder, DashboardOrderItem } from "./statusConfig";

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

function makeOrder(overrides: Partial<DashboardOrder> = {}): DashboardOrder {
	return {
		_id: "ord1" as DashboardOrder["_id"],
		_creationTime: 0,
		sessionId: "s1" as DashboardOrder["sessionId"],
		restaurantId: "r1" as DashboardOrder["restaurantId"],
		tableId: "t1" as DashboardOrder["tableId"],
		status: "preparing",
		totalAmount: 1400,
		createdAt: 0,
		updatedAt: 0,
		tableNumber: 4,
		items: [
			makeItem({ _id: "bar1" as DashboardOrderItem["_id"], prepStation: "bar" }),
			makeItem({
				_id: "kitchen1" as DashboardOrderItem["_id"],
				prepStation: "kitchen",
				menuItemName: "Tacos",
			}),
		],
		...overrides,
	} as DashboardOrder;
}

describe("deriveStationTickets", () => {
	it("keeps only the station's own live items", () => {
		const tickets = deriveStationTickets([makeOrder()], "bar");

		expect(tickets).toHaveLength(1);
		expect(tickets[0]?.items.map((i) => i.menuItemName)).toEqual(["Margarita"]);
		expect(tickets[0]?.station).toBe("bar");
	});

	it("bumps the ticket once that station has stamped ready", () => {
		const order = makeOrder({ barReadyAt: 1_000 });

		expect(deriveStationTickets([order], "bar")).toHaveLength(0);
		// The kitchen is still working, so its ticket stays.
		expect(deriveStationTickets([order], "kitchen")).toHaveLength(1);
	});

	it("drops the ticket when every one of the station's items was 86'd", () => {
		const order = makeOrder({
			items: [
				makeItem({ _id: "bar1" as DashboardOrderItem["_id"], prepStation: "bar", cancelledAt: 5 }),
				makeItem({
					_id: "kitchen1" as DashboardOrderItem["_id"],
					prepStation: "kitchen",
					menuItemName: "Tacos",
				}),
			],
		});

		expect(deriveStationTickets([order], "bar")).toHaveLength(0);
		expect(deriveStationTickets([order], "kitchen")).toHaveLength(1);
	});

	it("hides cancelled lines from a ticket that still has live work", () => {
		const order = makeOrder({
			items: [
				makeItem({ _id: "bar1" as DashboardOrderItem["_id"], prepStation: "bar" }),
				makeItem({
					_id: "bar2" as DashboardOrderItem["_id"],
					prepStation: "bar",
					menuItemName: "Mojito",
					cancelledAt: 5,
				}),
			],
		});

		const tickets = deriveStationTickets([order], "bar");
		expect(tickets[0]?.items.map((i) => i.menuItemName)).toEqual(["Margarita"]);
	});

	it("only projects orders that a station can still act on", () => {
		for (const status of ["ready", "served", "cancelled"] as const) {
			expect(deriveStationTickets([makeOrder({ status })], "bar")).toHaveLength(0);
		}
		for (const status of ["submitted", "preparing"] as const) {
			expect(deriveStationTickets([makeOrder({ status })], "bar")).toHaveLength(1);
		}
	});

	it("never lets an awaiting_payment order reach a station rail (ADR 008)", () => {
		// Uncollected cash: staff-visible, but the kitchen must not start
		// cooking, so neither station gets a ticket regardless of items.
		const order = makeOrder({ status: "awaiting_payment", awaitingPaymentAt: 1_000 });

		expect(deriveStationTickets([order], "bar")).toHaveLength(0);
		expect(deriveStationTickets([order], "kitchen")).toHaveLength(0);
	});

	it("preserves the order of the list it was given", () => {
		const first = makeOrder({ _id: "a" as DashboardOrder["_id"] });
		const second = makeOrder({ _id: "b" as DashboardOrder["_id"] });

		const tickets = deriveStationTickets([second, first], "bar");
		expect(tickets.map((ticket) => ticket.order._id)).toEqual(["b", "a"]);
	});
});
