import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrderDashboard } from "./OrderDashboard";
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

// Virtualization measures nothing in jsdom, so render the grid flat.
vi.mock("@/global/components", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/global/components")>();
	return {
		...actual,
		VirtualGrid: <T,>({
			items,
			getKey,
			renderItem,
		}: {
			items: ReadonlyArray<T>;
			getKey: (item: T) => string;
			renderItem: (item: T) => ReactNode;
		}) => (
			<div data-testid="virtual-grid">
				{items.map((item) => (
					<div key={getKey(item)}>{renderItem(item)}</div>
				))}
			</div>
		),
	};
});

const useOrdersMock = vi.fn();
vi.mock("../../hooks/useOrders", () => ({
	useOrders: (...args: unknown[]) => useOrdersMock(...args),
}));

const useUserSettingsMock = vi.fn();
vi.mock("@/features/users/hooks/useUserSettings", () => ({
	useUserSettings: () => useUserSettingsMock(),
}));

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
		status: "submitted",
		totalAmount: 1400,
		dailyOrderNumber: 7,
		createdAt: 0,
		updatedAt: 0,
		tableNumber: 4,
		items: [makeItem()],
		...overrides,
	} as DashboardOrder;
}

const updateOrderDashboardStatusFilter = vi.fn(() => Promise.resolve("settings1"));

function settingsWith(overrides: Record<string, unknown> = {}) {
	return {
		orderDashboardStatusFilter: "preparing",
		orderDashboardStatusFilters: null,
		updateOrderDashboardStatusFilter,
		orderDashboardPrepStationFilters: null,
		updateOrderDashboardPrepStationFilters: vi.fn(() => Promise.resolve("settings1")),
		...overrides,
	};
}

function ordersWith(orders: DashboardOrder[] = []) {
	return {
		orders,
		isLoading: false,
		error: null,
		updateStatus: vi.fn(),
		markStationReady: vi.fn(),
		unmarkStationReady: vi.fn(),
		cancelOrderItem: vi.fn(),
		cancelOrderAndRefund: vi.fn(),
		markOrderPaidInPerson: vi.fn(() => Promise.resolve([null, null])),
	};
}

const RESTAURANT_ID = "r1" as Parameters<typeof OrderDashboard>[0]["restaurantId"];

beforeEach(() => {
	vi.clearAllMocks();
	useOrdersMock.mockReturnValue(ordersWith());
	useUserSettingsMock.mockReturnValue(settingsWith());
});

describe("OrderDashboard strict single-select status filter (ADR 008)", () => {
	it("renders one radiogroup segment per status with exactly one selected", () => {
		render(<OrderDashboard restaurantId={RESTAURANT_ID} />);

		const group = screen.getByRole("radiogroup", { name: "orders.aria.statusSegments" });
		expect(group).toBeInTheDocument();

		const radios = screen.getAllByRole("radio");
		expect(radios.map((radio) => radio.textContent)).toEqual([
			"orders.status.awaitingPayment",
			"orders.status.submitted",
			"orders.status.preparing",
			"orders.status.ready",
			"orders.status.served",
			"orders.status.cancelled",
		]);
		expect(radios.filter((radio) => radio.getAttribute("aria-checked") === "true")).toHaveLength(1);
		expect(screen.getByRole("radio", { name: "orders.status.preparing" })).toHaveAttribute(
			"aria-checked",
			"true"
		);
	});

	it("queries only the selected status", () => {
		render(<OrderDashboard restaurantId={RESTAURANT_ID} />);

		expect(useOrdersMock).toHaveBeenLastCalledWith(RESTAURANT_ID, ["preparing"], undefined);
	});

	it("persists the single value and narrows the query when a segment is picked", () => {
		render(<OrderDashboard restaurantId={RESTAURANT_ID} />);

		fireEvent.click(screen.getByRole("radio", { name: "orders.status.awaitingPayment" }));

		expect(updateOrderDashboardStatusFilter).toHaveBeenCalledTimes(1);
		expect(updateOrderDashboardStatusFilter).toHaveBeenCalledWith("awaiting_payment");
		expect(useOrdersMock).toHaveBeenLastCalledWith(RESTAURANT_ID, ["awaiting_payment"], undefined);
		expect(screen.getByRole("radio", { name: "orders.status.awaitingPayment" })).toHaveAttribute(
			"aria-checked",
			"true"
		);
	});

	it("collapses the legacy multi-select array with the backfill priority rule", () => {
		useUserSettingsMock.mockReturnValue(
			settingsWith({
				orderDashboardStatusFilter: null,
				orderDashboardStatusFilters: ["served", "ready", "cancelled"],
			})
		);
		render(<OrderDashboard restaurantId={RESTAURANT_ID} />);

		expect(screen.getByRole("radio", { name: "orders.status.ready" })).toHaveAttribute(
			"aria-checked",
			"true"
		);
		expect(useOrdersMock).toHaveBeenLastCalledWith(RESTAURANT_ID, ["ready"], undefined);
	});

	it("defaults to the submitted queue when nothing was ever persisted", () => {
		useUserSettingsMock.mockReturnValue(
			settingsWith({ orderDashboardStatusFilter: null, orderDashboardStatusFilters: null })
		);
		render(<OrderDashboard restaurantId={RESTAURANT_ID} />);

		expect(screen.getByRole("radio", { name: "orders.status.submitted" })).toHaveAttribute(
			"aria-checked",
			"true"
		);
	});
});

describe("OrderDashboard awaiting-payment rail safety (ADR 008)", () => {
	it("keeps the ordinary card grid when awaiting_payment is active with one station", () => {
		useUserSettingsMock.mockReturnValue(
			settingsWith({
				orderDashboardStatusFilter: "awaiting_payment",
				orderDashboardPrepStationFilters: ["kitchen"],
			})
		);
		useOrdersMock.mockReturnValue(
			ordersWith([makeOrder({ status: "awaiting_payment", awaitingPaymentAt: 1_000 })])
		);
		render(<OrderDashboard restaurantId={RESTAURANT_ID} />);

		// The card variant with the money action renders — never a station
		// ticket, and never the station's "all done" empty state.
		expect(screen.getByText("orders.markPaid.action")).toBeInTheDocument();
		expect(screen.queryByText("orders.ticket.emptyAllDone")).not.toBeInTheDocument();
	});

	it("still enters rail mode for workflow statuses with one station selected", () => {
		useUserSettingsMock.mockReturnValue(
			settingsWith({
				orderDashboardStatusFilter: "preparing",
				orderDashboardPrepStationFilters: ["kitchen"],
			})
		);
		useOrdersMock.mockReturnValue(ordersWith([makeOrder({ status: "preparing" })]));
		render(<OrderDashboard restaurantId={RESTAURANT_ID} />);

		// Station tickets carry the station-scoped ready action instead of the
		// whole-order card actions.
		expect(screen.getByText("orders.actions.markKitchenReady")).toBeInTheDocument();
	});
});
