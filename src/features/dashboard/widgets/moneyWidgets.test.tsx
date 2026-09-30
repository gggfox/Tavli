/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Dashboard analytics return money in minor units (centavos), like every other
 * amount in the app. These widgets used to hand the raw number to
 * `Intl.NumberFormat` as if it were pesos, so every figure read 100× too large
 * (a $26,972.97 category showed as 2.697.297 MXN). Each case feeds a known
 * centavo amount and expects the peso figure.
 */
const hoisted = vi.hoisted(() => ({ data: undefined as unknown }));

vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: hoisted.data, isPending: false, error: null }),
}));
vi.mock("@convex-dev/react-query", () => ({ convexQuery: () => ({}) }));
vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key, i18n: { language: "es" } }),
	initReactI18next: { type: "3rdParty", init: () => {} },
}));

import { activeOrdersDescriptor } from "./ActiveOrders";
import { NumberWithDeltaWidget } from "./NumberWithDelta/Widget";
import { tipsTotalDescriptor } from "./TipsTotal";

const context = {
	scopeKind: "restaurant",
	restaurantId: "restaurants:1",
	currency: "MXN",
	range: { start: 0, end: 1 },
	compareToPrev: false,
} as any;

describe("dashboard money widgets", () => {
	beforeEach(() => {
		hoisted.data = undefined;
	});

	it("Active orders shows the order value in pesos, not centavos", () => {
		hoisted.data = { seatedTables: 2, activeOrderCount: 3, activeOrderValue: 269729700 };
		const ActiveOrders = activeOrdersDescriptor.Component;
		render(<ActiveOrders options={{}} context={context} />);

		expect(screen.getByText("$2,697,297.00")).toBeInTheDocument();
	});

	it.each(["payments.revenueTotal", "orders.avgCheck", "orders.avgDishValue"] as const)(
		"Number with change shows %s in pesos, including the change",
		(metric) => {
			hoisted.data = { current: 12345, previous: null, deltaPct: null, deltaAbs: 500 };
			render(<NumberWithDeltaWidget options={{ metric }} context={context} />);

			expect(screen.getByText("$123.45")).toBeInTheDocument();
			expect(screen.getByText(/\$5\.00/)).toBeInTheDocument();
		}
	);

	it("Number with change leaves count metrics as plain numbers", () => {
		hoisted.data = { current: 22, previous: null, deltaPct: null, deltaAbs: null };
		render(<NumberWithDeltaWidget options={{ metric: "reservations.count" }} context={context} />);

		expect(screen.getByText("22")).toBeInTheDocument();
	});

	it("Tips total keeps the same format as the rest of the dashboard", () => {
		hoisted.data = { totalCents: 150000, previousTotalCents: null, buckets: [] };
		const TipsTotal = tipsTotalDescriptor.Component;
		render(<TipsTotal options={{}} context={context} />);

		// Was es-ES via the bare "es" language: "1500,00 $" — now the es-MX
		// convention every other amount in the app uses.
		expect(screen.getByText("$1,500.00")).toBeInTheDocument();
	});

	it("falls back to pesos, not dollars, when the scope has no currency", () => {
		hoisted.data = { seatedTables: 0, activeOrderCount: 1, activeOrderValue: 1000 };
		const ActiveOrders = activeOrdersDescriptor.Component;
		render(<ActiveOrders options={{}} context={{ ...context, currency: null }} />);

		expect(screen.getByText("$10.00")).toBeInTheDocument();
	});
});
