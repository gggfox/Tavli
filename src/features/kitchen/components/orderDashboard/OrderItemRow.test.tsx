import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OrderItemRow } from "./OrderItemRow";
import type { DashboardOrderItem } from "./statusConfig";

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

function makeItem(overrides: Partial<DashboardOrderItem>): DashboardOrderItem {
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

describe("OrderItemRow station highlight", () => {
	it("renders without station styling when no filter is active", () => {
		const item = makeItem({ menuItemName: "Steak", prepStation: "kitchen" });
		render(<OrderItemRow item={item} />);
		const row = screen.getByText(/Steak/).closest("div");
		expect(row?.style.opacity).toBe("");
		expect(row?.style.borderLeft).toBe("");
	});

	it("renders with station accent when item matches the active filter", () => {
		const item = makeItem({ menuItemName: "Margarita", prepStation: "bar" });
		render(
			<OrderItemRow item={item} activeStationFilters={new Set(["bar"])} />
		);
		const row = screen.getByText(/Margarita/).closest("div");
		expect(row?.style.borderLeft).toContain("var(--station-bar)");
		expect(row?.style.backgroundColor).toBe("var(--station-bar-light)");
	});

	it("renders with reduced opacity when item is outside the active filter", () => {
		const item = makeItem({ menuItemName: "Steak", prepStation: "kitchen" });
		render(
			<OrderItemRow item={item} activeStationFilters={new Set(["bar"])} />
		);
		const row = screen.getByText(/Steak/).closest("div");
		expect(row?.style.opacity).toBe("0.45");
	});

	it("treats an empty filter set as 'no filter active'", () => {
		const item = makeItem({ prepStation: "kitchen" });
		render(<OrderItemRow item={item} activeStationFilters={new Set()} />);
		const row = screen.getByText(/Margarita/).closest("div");
		expect(row?.style.opacity).toBe("");
		expect(row?.style.borderLeft).toBe("");
	});
});
