/* eslint-disable boundaries/no-unknown, @typescript-eslint/no-explicit-any -- feature-internal test harness */
import { AdminTable } from "@/global/components";
import { useAdminTable } from "@/global/hooks";
import { useQuery } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { useConvexAuth } from "convex/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePaymentsColumns } from "./Columns";
import type { PaymentsLedgerRow } from "./types";

vi.mock("@tanstack/react-query", () => ({
	useQuery: vi.fn(),
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: vi.fn((ref, args) => ({ ref, args })),
}));

vi.mock("convex/react", () => ({
	useConvexAuth: vi.fn(),
}));

vi.mock("react-i18next", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react-i18next")>();
	return {
		...actual,
		useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
	};
});

function makeRow(overrides: Partial<PaymentsLedgerRow> = {}): PaymentsLedgerRow {
	return {
		id: "ord1",
		rowKind: "order",
		dailyOrderNumber: 7,
		paidAt: Date.UTC(2026, 5, 20, 19, 0),
		tableNumber: 4,
		settledBy: "stripe",
		subtotalCents: 10000,
		serviceFeeCents: 1200,
		tipCents: 0,
		chargedCents: 11200,
		netToRestaurantCents: 10000,
		items: [],
		...overrides,
	};
}

function Harness() {
	const columns = usePaymentsColumns();
	const tableState = useAdminTable<PaymentsLedgerRow>({
		queryOptions: { queryKey: ["payments-columns-test"] } as any,
		columns,
	});
	return <AdminTable tableState={tableState} entityName="payments" />;
}

function mockRows(rows: PaymentsLedgerRow[]) {
	vi.mocked(useQuery).mockReturnValue({
		data: rows,
		isLoading: false,
		error: null,
		isError: false,
		refetch: vi.fn(),
	} as any);
}

/** Cells of the row whose first visible cell matches `orderLabel`. */
function cellsOfRow(orderLabel: string): string[] {
	const row = screen.getAllByRole("row").find((r) => within(r).queryByText(orderLabel));
	if (!row) throw new Error(`no row containing "${orderLabel}"`);
	return within(row)
		.getAllByRole("cell")
		.map((c) => c.textContent ?? "");
}

describe("payments ledger columns", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(useConvexAuth).mockReturnValue({ isLoading: false, isAuthenticated: true } as any);
	});

	it("breaks an order row into subtotal, Tavli fee and net to restaurant", () => {
		mockRows([makeRow()]);
		render(<Harness />);

		const cells = cellsOfRow("#7");
		// The diner paid 112.00; only 100.00 is restaurant revenue.
		expect(cells).toContain("$100.00");
		expect(cells).toContain("$12.00");
		expect(cells.filter((c) => c === "$100.00")).toHaveLength(2); // subtotal + net
		expect(screen.getByText("payments.rowKind.order")).toBeInTheDocument();
	});

	it("labels a tip row distinctly and never counts it as food revenue", () => {
		mockRows([
			makeRow({
				id: "pay1",
				rowKind: "tip",
				dailyOrderNumber: null,
				subtotalCents: 0,
				serviceFeeCents: 0,
				tipCents: 2000,
				chargedCents: 2000,
				netToRestaurantCents: 2000,
			}),
		]);
		render(<Harness />);

		expect(screen.getByText("payments.rowKind.tip")).toBeInTheDocument();
		const cells = cellsOfRow("payments.rowKind.tip");
		expect(cells).toContain("$0.00"); // subtotal — a tip is not a sale
		expect(cells.filter((c) => c === "$20.00")).toHaveLength(2); // tip + net
		expect(cells[0]).toBe("—"); // no daily order number
	});

	it("renders an em dash where a legacy row never recorded the fee split", () => {
		mockRows([
			makeRow({
				id: "legacy1",
				dailyOrderNumber: 2,
				serviceFeeCents: null,
				netToRestaurantCents: null,
			}),
		]);
		render(<Harness />);

		const cells = cellsOfRow("#2");
		expect(cells.filter((c) => c === "—")).toHaveLength(3); // no items, no fee, no net
	});

	it("shows a cash order at full subtotal with no service fee", () => {
		mockRows([
			makeRow({
				id: "cash1",
				dailyOrderNumber: 3,
				settledBy: "staff",
				serviceFeeCents: 0,
				chargedCents: 10000,
				netToRestaurantCents: 10000,
			}),
		]);
		render(<Harness />);

		const cells = cellsOfRow("#3");
		expect(cells).toContain("$0.00"); // no Tavli fee on cash
		expect(cells.filter((c) => c === "$100.00")).toHaveLength(2);
	});
});
