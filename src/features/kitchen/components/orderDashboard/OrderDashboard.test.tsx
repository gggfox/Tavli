import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SERVED_VISIBLE_WINDOW_MS } from "convex/constants";
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
const useOrderStatusCountsMock = vi.fn();
vi.mock("../../hooks/useOrders", () => ({
	useOrders: (...args: unknown[]) => useOrdersMock(...args),
	useOrderStatusCounts: (...args: unknown[]) => useOrderStatusCountsMock(...args),
}));

// OrderDashboard now subscribes to pending substitution proposals and wires
// the propose/withdraw mutations directly (TAVLI-71 Phase 3A); stub the
// react-query layer so the dashboard renders without a QueryClientProvider.
vi.mock("@tanstack/react-query", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-query")>();
	return {
		...actual,
		useQuery: vi.fn(() => ({ data: [], isLoading: false })),
		useMutation: vi.fn(() => ({
			mutateAsync: vi.fn(async () => [null, null]),
			isPending: false,
		})),
	};
});

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: vi.fn((ref: unknown, args: unknown) => ({ ref, args })),
	useConvexMutation: vi.fn(() => vi.fn()),
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
const updateOrderDashboardPrepStationFilters = vi.fn(() => Promise.resolve("settings1"));
const updateOrderDashboardServiceDateFilter = vi.fn(() => Promise.resolve("settings1"));

function settingsWith(overrides: Record<string, unknown> = {}) {
	return {
		orderDashboardStatusFilter: "preparing",
		orderDashboardStatusFilters: null,
		updateOrderDashboardStatusFilter,
		orderDashboardPrepStationFilters: null,
		updateOrderDashboardPrepStationFilters,
		orderDashboardServiceDateFilter: null,
		updateOrderDashboardServiceDateFilter,
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
	// Counts are decoration; default to "not loaded yet" so the existing
	// assertions keep matching bare labels.
	useOrderStatusCountsMock.mockReturnValue(undefined);
	useUserSettingsMock.mockReturnValue(settingsWith());
});

describe("OrderDashboard strict single-select status filter (ADR 008)", () => {
	it("renders one radiogroup segment per status with exactly one selected", () => {
		render(<OrderDashboard restaurantId={RESTAURANT_ID} />);

		const group = screen.getByRole("radiogroup", { name: "orders.aria.statusSegments" });
		expect(group).toBeInTheDocument();

		// Scoped to the status group: the station filter is a radiogroup too.
		const radios = within(group).getAllByRole("radio");
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
		// Every segment carries its status glyph.
		expect(radios.every((radio) => radio.querySelector("svg") !== null)).toBe(true);
	});

	it("queries only the selected status", () => {
		render(<OrderDashboard restaurantId={RESTAURANT_ID} />);

		expect(useOrdersMock).toHaveBeenLastCalledWith(RESTAURANT_ID, ["preparing"], undefined, "all");
	});

	it("persists the single value and narrows the query when a segment is picked", () => {
		render(<OrderDashboard restaurantId={RESTAURANT_ID} />);

		fireEvent.click(screen.getByRole("radio", { name: "orders.status.awaitingPayment" }));

		expect(updateOrderDashboardStatusFilter).toHaveBeenCalledTimes(1);
		expect(updateOrderDashboardStatusFilter).toHaveBeenCalledWith("awaiting_payment");
		expect(useOrdersMock).toHaveBeenLastCalledWith(
			RESTAURANT_ID,
			["awaiting_payment"],
			undefined,
			"all"
		);
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
		expect(useOrdersMock).toHaveBeenLastCalledWith(RESTAURANT_ID, ["ready"], undefined, "all");
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

describe("OrderDashboard service-day filter", () => {
	function serviceDateGroup() {
		return within(screen.getByRole("radiogroup", { name: "orders.aria.serviceDateFilter" }));
	}

	it("offers today / all, defaulting to all so no open ticket disappears", () => {
		render(<OrderDashboard restaurantId={RESTAURANT_ID} />);

		expect(
			serviceDateGroup()
				.getAllByRole("radio")
				.map((radio) => radio.textContent)
		).toEqual(["orders.serviceDate.today", "orders.serviceDate.all"]);
		expect(
			serviceDateGroup().getByRole("radio", { name: "orders.serviceDate.all" })
		).toHaveAttribute("aria-checked", "true");
	});

	it("persists the window and narrows both queries when today is picked", () => {
		render(<OrderDashboard restaurantId={RESTAURANT_ID} />);

		fireEvent.click(serviceDateGroup().getByRole("radio", { name: "orders.serviceDate.today" }));

		expect(updateOrderDashboardServiceDateFilter).toHaveBeenCalledWith("today");
		expect(useOrdersMock).toHaveBeenLastCalledWith(
			RESTAURANT_ID,
			["preparing"],
			undefined,
			"today"
		);
		// Counts follow the same window, or the numbers would contradict the board.
		expect(useOrderStatusCountsMock).toHaveBeenLastCalledWith(RESTAURANT_ID, undefined, "today");
	});

	it("restores a persisted today selection", () => {
		useUserSettingsMock.mockReturnValue(settingsWith({ orderDashboardServiceDateFilter: "today" }));
		render(<OrderDashboard restaurantId={RESTAURANT_ID} />);

		expect(
			serviceDateGroup().getByRole("radio", { name: "orders.serviceDate.today" })
		).toHaveAttribute("aria-checked", "true");
	});
});

describe("OrderDashboard segment counts", () => {
	it("appends the card count to each status label", () => {
		useOrderStatusCountsMock.mockReturnValue({
			awaiting_payment: { count: 2, capped: false },
			submitted: { count: 0, capped: false },
			preparing: { count: 13, capped: false },
			ready: { count: 1, capped: false },
			served: { count: 7, capped: false },
			cancelled: { count: 4, capped: false },
		});
		render(<OrderDashboard restaurantId={RESTAURANT_ID} />);

		const group = screen.getByRole("radiogroup", { name: "orders.aria.statusSegments" });
		expect(
			within(group)
				.getAllByRole("radio")
				.map((radio) => radio.textContent)
		).toEqual([
			"orders.status.awaitingPayment (2)",
			"orders.status.submitted (0)",
			"orders.status.preparing (13)",
			"orders.status.ready (1)",
			"orders.status.served (7)",
			"orders.status.cancelled (4)",
		]);
	});

	it("marks a capped count so a truncated scan never reads as exact", () => {
		useOrderStatusCountsMock.mockReturnValue({
			served: { count: 200, capped: true },
		});
		render(<OrderDashboard restaurantId={RESTAURANT_ID} />);

		expect(screen.getByRole("radio", { name: "orders.status.served (200+)" })).toBeInTheDocument();
	});

	it("renders bare labels until the counts arrive", () => {
		useOrderStatusCountsMock.mockReturnValue(undefined);
		render(<OrderDashboard restaurantId={RESTAURANT_ID} />);

		// A flash of "(0)" on a segment that has work would be worse than no
		// number at all.
		expect(screen.getByRole("radio", { name: "orders.status.preparing" })).toBeInTheDocument();
	});

	it("counts under the active station filter, matching what the board shows", () => {
		useUserSettingsMock.mockReturnValue(
			settingsWith({ orderDashboardPrepStationFilters: ["kitchen"] })
		);
		render(<OrderDashboard restaurantId={RESTAURANT_ID} />);

		expect(useOrderStatusCountsMock).toHaveBeenLastCalledWith(RESTAURANT_ID, ["kitchen"], "all");
	});
});

describe("OrderDashboard station filter control", () => {
	function stationGroup() {
		return within(screen.getByRole("radiogroup", { name: "orders.aria.stationFilter" }));
	}

	it("offers all / kitchen / bar, defaulting to all when nothing is filtered", () => {
		render(<OrderDashboard restaurantId={RESTAURANT_ID} />);

		expect(
			stationGroup()
				.getAllByRole("radio")
				.map((radio) => radio.textContent)
		).toEqual(["orders.station.all", "orders.station.kitchen", "orders.station.bar"]);
		expect(stationGroup().getByRole("radio", { name: "orders.station.all" })).toHaveAttribute(
			"aria-checked",
			"true"
		);
		expect(
			stationGroup()
				.getAllByRole("radio")
				.every((radio) => radio.querySelector("svg") !== null)
		).toBe(true);
	});

	it("persists a single station and narrows the query when one is picked", () => {
		render(<OrderDashboard restaurantId={RESTAURANT_ID} />);

		fireEvent.click(stationGroup().getByRole("radio", { name: "orders.station.kitchen" }));

		expect(updateOrderDashboardPrepStationFilters).toHaveBeenCalledWith(["kitchen"]);
		expect(useOrdersMock).toHaveBeenLastCalledWith(
			RESTAURANT_ID,
			["preparing"],
			["kitchen"],
			"all"
		);
	});

	it("clears the station filter when all is picked", () => {
		useUserSettingsMock.mockReturnValue(
			settingsWith({ orderDashboardPrepStationFilters: ["bar"] })
		);
		render(<OrderDashboard restaurantId={RESTAURANT_ID} />);

		fireEvent.click(stationGroup().getByRole("radio", { name: "orders.station.all" }));

		expect(updateOrderDashboardPrepStationFilters).toHaveBeenCalledWith([]);
		// `undefined`, not `[]` — the query short-circuits its per-order check.
		expect(useOrdersMock).toHaveBeenLastCalledWith(RESTAURANT_ID, ["preparing"], undefined, "all");
	});

	it("shows a legacy both-stations array as all, since it filters nothing out", () => {
		useUserSettingsMock.mockReturnValue(
			settingsWith({ orderDashboardPrepStationFilters: ["kitchen", "bar"] })
		);
		render(<OrderDashboard restaurantId={RESTAURANT_ID} />);

		expect(stationGroup().getByRole("radio", { name: "orders.station.all" })).toHaveAttribute(
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

describe("OrderDashboard served visibility window (TAVLI-84)", () => {
	function servedSettings() {
		return settingsWith({ orderDashboardStatusFilter: "served" });
	}

	function cardCount() {
		return screen.queryByTestId("virtual-grid")?.children.length ?? 0;
	}

	it("keeps a recently served order and drops one past the window", () => {
		const now = Date.now();
		useUserSettingsMock.mockReturnValue(servedSettings());
		useOrdersMock.mockReturnValue(
			ordersWith([
				makeOrder({
					_id: "recent" as DashboardOrder["_id"],
					status: "served",
					servedAt: now - 60_000,
					updatedAt: now,
				}),
				makeOrder({
					_id: "stale" as DashboardOrder["_id"],
					status: "served",
					// `updatedAt` is fresh on purpose: a later write (a refund
					// outcome, a session sweep) must not revive an aged-out card.
					servedAt: now - 2 * SERVED_VISIBLE_WINDOW_MS,
					updatedAt: now,
				}),
			])
		);
		render(<OrderDashboard restaurantId={RESTAURANT_ID} />);

		expect(cardCount()).toBe(1);
	});

	it("ages the last card off on the clock, with no new server push", () => {
		vi.useFakeTimers();
		try {
			const now = Date.now();
			useUserSettingsMock.mockReturnValue(servedSettings());
			// The server keeps stale rows off the wire, but a Convex query only
			// re-runs when the data it read changes — never merely because time
			// passed. On an idle board after close, the client half is the only
			// thing that clears this card.
			useOrdersMock.mockReturnValue(
				ordersWith([
					makeOrder({
						status: "served",
						servedAt: now - (SERVED_VISIBLE_WINDOW_MS - 60_000),
						updatedAt: now,
					}),
				])
			);
			render(<OrderDashboard restaurantId={RESTAURANT_ID} />);
			expect(cardCount()).toBe(1);

			act(() => {
				vi.advanceTimersByTime(5 * 60_000);
			});

			expect(cardCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it("leaves other statuses alone however long they sit there", () => {
		useUserSettingsMock.mockReturnValue(settingsWith({ orderDashboardStatusFilter: "preparing" }));
		useOrdersMock.mockReturnValue(
			ordersWith([makeOrder({ status: "preparing", createdAt: 0, updatedAt: 0 })])
		);
		render(<OrderDashboard restaurantId={RESTAURANT_ID} />);

		expect(cardCount()).toBe(1);
	});

	it("explains the window on the Served segment and nowhere else", () => {
		useUserSettingsMock.mockReturnValue(servedSettings());
		const { unmount } = render(<OrderDashboard restaurantId={RESTAURANT_ID} />);
		expect(screen.getByText("orders.servedWindow.hint")).toBeInTheDocument();
		unmount();

		useUserSettingsMock.mockReturnValue(settingsWith({ orderDashboardStatusFilter: "preparing" }));
		render(<OrderDashboard restaurantId={RESTAURANT_ID} />);
		expect(screen.queryByText("orders.servedWindow.hint")).not.toBeInTheDocument();
	});

	it("says nothing was served recently rather than nothing matches the filters", () => {
		useUserSettingsMock.mockReturnValue(servedSettings());
		useOrdersMock.mockReturnValue(ordersWith([]));
		render(<OrderDashboard restaurantId={RESTAURANT_ID} />);

		// "No orders match the selected filters" would send staff hunting
		// through the filter bar for a segment that is working as designed.
		expect(screen.getByText("orders.empty.noRecentServed")).toBeInTheDocument();
	});
});
