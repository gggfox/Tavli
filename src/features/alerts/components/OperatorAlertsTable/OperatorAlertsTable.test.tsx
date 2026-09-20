/**
 * `/admin/alerts` (TAVLI-109).
 *
 * What is pinned here is what an operator would notice being wrong: the row
 * says which problem it is in words the page translates (never backend prose),
 * only an open alert offers the acknowledge button, clicking it names the row
 * it clears, and the two filters actually narrow the list — including the
 * "no restaurant" case, which only exists when a platform-wide alert is there
 * to match it.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getFunctionName } from "convex/server";
import { useConvexAuth } from "convex/react";
import {
	OPERATOR_ALERT_EXPLANATION_KEY,
	OPERATOR_ALERT_KIND,
	OPERATOR_ALERT_SEVERITY,
	OPERATOR_ALERT_STATUS,
} from "convex/constants";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperatorAlertsTable } from "./OperatorAlertsTable";

vi.mock("@tanstack/react-query", () => ({
	useMutation: vi.fn(),
	useQuery: vi.fn(),
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (ref: unknown, args: unknown) => ({ queryKey: ["alerts"], ref, args }),
	useConvexMutation: (ref: unknown) => ref,
}));

vi.mock("convex/react", () => ({
	useConvexAuth: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	Link: ({ children, ...rest }: any) => <a {...rest}>{children}</a>,
}));

vi.mock("react-i18next", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react-i18next")>();
	return {
		...actual,
		useTranslation: () => ({
			// Keys, plus their interpolation values, so a test can tell
			// "acknowledged by admin-1" from "acknowledged by somebody".
			t: (key: string, params?: Record<string, unknown>) =>
				params && Object.keys(params).length > 0
					? `${key} ${Object.values(params).join(" ")}`
					: key,
			i18n: { language: "en" },
		}),
	};
});

type MutationCall = { name: string; args: unknown };

const calls: MutationCall[] = [];

const OPEN_SEVERE = {
	_id: "alerts:severe",
	_creationTime: 1,
	kind: OPERATOR_ALERT_KIND.CHARGE_UNMATCHED,
	severity: OPERATOR_ALERT_SEVERITY.SEVERE,
	status: OPERATOR_ALERT_STATUS.OPEN,
	messageKey: OPERATOR_ALERT_EXPLANATION_KEY[OPERATOR_ALERT_KIND.CHARGE_UNMATCHED],
	stripeObjectId: "ch_1",
	restaurantId: "restaurants:cocina",
	restaurantName: "La Cocina",
	acknowledgedByName: null,
	createdAt: 1700000000000,
};

const OPEN_WARNING_NO_RESTAURANT = {
	_id: "alerts:warning",
	_creationTime: 2,
	kind: OPERATOR_ALERT_KIND.PAYMENT_STUCK,
	severity: OPERATOR_ALERT_SEVERITY.WARNING,
	status: OPERATOR_ALERT_STATUS.OPEN,
	messageKey: OPERATOR_ALERT_EXPLANATION_KEY[OPERATOR_ALERT_KIND.PAYMENT_STUCK],
	restaurantName: null,
	acknowledgedByName: null,
	createdAt: 1700000001000,
};

const ACKNOWLEDGED = {
	_id: "alerts:done",
	_creationTime: 3,
	kind: OPERATOR_ALERT_KIND.DISPUTE_LOST,
	severity: OPERATOR_ALERT_SEVERITY.WARNING,
	status: OPERATOR_ALERT_STATUS.ACKNOWLEDGED,
	messageKey: OPERATOR_ALERT_EXPLANATION_KEY[OPERATOR_ALERT_KIND.DISPUTE_LOST],
	acknowledgedBy: "user_2abcCLERKSUBJECT",
	acknowledgedByName: "Ada Lovelace",
	acknowledgedAt: 1700000002000,
	restaurantId: "restaurants:otra",
	restaurantName: "La Otra",
	createdAt: 1700000002000,
};

function mockRows(rows: unknown[]) {
	vi.mocked(useQuery).mockReturnValue({
		data: rows,
		isLoading: false,
		error: null,
		isError: false,
		refetch: vi.fn(),
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as any);
}

beforeEach(() => {
	calls.length = 0;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	vi.mocked(useConvexAuth).mockReturnValue({ isLoading: false, isAuthenticated: true } as any);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	vi.mocked(useMutation).mockImplementation((options: any) => {
		const name = getFunctionName(options.mutationFn);
		return {
			mutateAsync: async (args: unknown) => {
				calls.push({ name, args });
				return [args, null];
			},
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any;
	});
});

describe("OperatorAlertsTable", () => {
	it("says what the problem is, in the page's own words", () => {
		mockRows([OPEN_SEVERE]);
		render(<OperatorAlertsTable />);

		expect(screen.getByText("alerts.kind.chargeUnmatched.title")).toBeTruthy();
		expect(screen.getByText("alerts.kind.chargeUnmatched.explanation")).toBeTruthy();
		// Scoped to the table: "Severe" is also an option in the filter select.
		expect(within(screen.getByRole("table")).getByText("alerts.severity.severe")).toBeTruthy();
		const restaurantLink = within(screen.getByRole("table")).getByText("La Cocina");
		expect(restaurantLink.getAttribute("to")).toBe("/admin/restaurants");
	});

	it("offers the acknowledge button only on open alerts", () => {
		mockRows([OPEN_SEVERE, ACKNOWLEDGED]);
		render(<OperatorAlertsTable />);

		expect(screen.getAllByText("alerts.action.acknowledge")).toHaveLength(1);
		expect(screen.getByText("alerts.status.acknowledged")).toBeTruthy();
		// A person, not a Clerk subject — with the subject kept in the tooltip.
		const actor = screen.getByText("alerts.action.acknowledgedBy Ada Lovelace");
		expect(actor.getAttribute("title")).toBe("user_2abcCLERKSUBJECT");
	});

	it("acknowledges the row that was clicked", async () => {
		mockRows([OPEN_SEVERE]);
		render(<OperatorAlertsTable />);

		fireEvent.click(screen.getByText("alerts.action.acknowledge"));

		await waitFor(() => expect(calls).toHaveLength(1));
		expect(calls[0].args).toEqual({ alertId: "alerts:severe" });
	});

	it("narrows the list to one severity", () => {
		mockRows([OPEN_SEVERE, OPEN_WARNING_NO_RESTAURANT]);
		render(<OperatorAlertsTable />);

		expect(screen.getByText("alerts.kind.paymentStuck.title")).toBeTruthy();

		fireEvent.change(screen.getByLabelText("alerts.filter.severity"), {
			target: { value: OPERATOR_ALERT_SEVERITY.SEVERE },
		});

		expect(screen.queryByText("alerts.kind.paymentStuck.title")).toBeNull();
		expect(screen.getByText("alerts.kind.chargeUnmatched.title")).toBeTruthy();
	});

	it("narrows the list to one restaurant, and lists only restaurants that have alerts", () => {
		mockRows([OPEN_SEVERE, ACKNOWLEDGED]);
		render(<OperatorAlertsTable />);

		const select = screen.getByLabelText("alerts.filter.restaurant") as HTMLSelectElement;
		expect([...select.options].map((option) => option.textContent)).toEqual([
			"alerts.filter.allRestaurants",
			"La Cocina",
			"La Otra",
		]);

		fireEvent.change(select, { target: { value: "restaurants:cocina" } });

		expect(screen.getByText("alerts.kind.chargeUnmatched.title")).toBeTruthy();
		expect(screen.queryByText("alerts.kind.disputeLost.title")).toBeNull();
	});

	it("offers the no-restaurant filter only when a platform-wide alert exists", () => {
		mockRows([OPEN_SEVERE]);
		const withRestaurantsOnly = render(<OperatorAlertsTable />);
		expect(screen.queryByText("alerts.filter.noRestaurant")).toBeNull();
		withRestaurantsOnly.unmount();

		mockRows([OPEN_SEVERE, OPEN_WARNING_NO_RESTAURANT]);
		render(<OperatorAlertsTable />);

		const select = screen.getByLabelText("alerts.filter.restaurant") as HTMLSelectElement;
		expect(screen.getByText("alerts.filter.noRestaurant")).toBeTruthy();

		fireEvent.change(select, { target: { value: "none" } });

		expect(screen.getByText("alerts.kind.paymentStuck.title")).toBeTruthy();
		expect(screen.queryByText("alerts.kind.chargeUnmatched.title")).toBeNull();
	});

	it("says nothing needs a human when there are no alerts", () => {
		mockRows([]);
		render(<OperatorAlertsTable />);

		expect(screen.getByText("alerts.page.emptyTitle")).toBeTruthy();
	});
});
