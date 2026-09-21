/**
 * The disputes card on the payments page, and the admin recovery control
 * (TAVLI-102).
 *
 * What is pinned here is what a manager or an admin would notice being wrong:
 * a restaurant with no disputes is told nothing at all, a lost dispute says
 * what happens next in terms that match whether money will actually be
 * withheld, the ledger split is admin-only, Stripe's raw status never reaches
 * the screen, and 51 cannot be saved.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { DISPUTE_STATUS } from "convex/constants";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "convex/_generated/dataModel";
import { DisputeRecoveryControl } from "./DisputeRecoveryControl";
import { DisputesSection } from "./DisputesSection";

vi.mock("@tanstack/react-query", () => ({
	useQuery: vi.fn(),
}));

const setPercentMock = vi.fn();

vi.mock("@convex-dev/react-query", () => ({
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	convexQuery: (ref: any, args: unknown) => ({ queryKey: [getFunctionName(ref)], ref, args }),
	useConvexMutation: () => setPercentMock,
}));

vi.mock("react-i18next", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react-i18next")>();
	return {
		...actual,
		useTranslation: () => ({
			// Keys plus their interpolated values, so a test can tell "20% held
			// back" from "some percentage held back".
			t: (key: string, params?: Record<string, unknown>) =>
				params && Object.keys(params).length > 0
					? `${key} ${Object.values(params).join(" ")}`
					: key,
			i18n: { language: "en" },
		}),
	};
});

const RESTAURANT_ID = "restaurants:cocina" as Id<"restaurants">;

const LOST_ROW = {
	_id: "stripeDisputes:1" as Id<"stripeDisputes">,
	stripeDisputeId: "dp_lost_1",
	status: DISPUTE_STATUS.LOST,
	reason: "fraudulent",
	amount: 64_000,
	currency: "MXN",
	openedAt: 1_700_000_000_000,
	closedAt: 1_700_100_000_000,
	reinstatedAt: undefined,
	orderId: "orders:1" as Id<"orders">,
	dailyOrderNumber: 42,
	outstanding: 50_000,
	recovered: 14_000,
	recoveryStatus: "outstanding" as const,
};

const OPEN_ROW = {
	...LOST_ROW,
	_id: "stripeDisputes:2" as Id<"stripeDisputes">,
	stripeDisputeId: "dp_open_1",
	status: DISPUTE_STATUS.NEEDS_RESPONSE,
	closedAt: undefined,
	outstanding: 0,
	recovered: 0,
	recoveryStatus: null,
};

function mockDisputes(data: unknown) {
	vi.mocked(useQuery).mockReturnValue({ data } as ReturnType<typeof useQuery>);
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("DisputesSection", () => {
	it("renders nothing for a restaurant that has never had a dispute", () => {
		mockDisputes({
			rows: [],
			recovery: { percent: 0, totalOutstanding: 0, totalRecovered: 0, currency: "MXN" },
			isAdmin: false,
		});
		const { container } = render(<DisputesSection restaurantId={RESTAURANT_ID} />);
		// A card explaining a thing that has not happened is noise on the busiest
		// page in the product.
		expect(container).toBeEmptyDOMElement();
	});

	it("renders nothing while the query is loading or refused", () => {
		mockDisputes(undefined);
		const { container } = render(<DisputesSection restaurantId={RESTAURANT_ID} />);
		expect(container).toBeEmptyDOMElement();
	});

	it("shows what was disputed, which order, how much and what happens next", () => {
		mockDisputes({
			rows: [LOST_ROW],
			recovery: { percent: 20, totalOutstanding: 50_000, totalRecovered: 14_000, currency: "MXN" },
			isAdmin: false,
		});
		render(<DisputesSection restaurantId={RESTAURANT_ID} />);

		expect(screen.getByTestId("dispute-row-dp_lost_1")).toBeInTheDocument();
		// The amount, and the order in the number staff actually use.
		expect(screen.getByText("$640.00 MXN")).toBeInTheDocument();
		expect(screen.getByText(/disputes\.list\.order 42/)).toBeInTheDocument();
		// "Reversed", not "Lost": nothing was lost by the restaurant.
		expect(screen.getByText("disputes.status.lost")).toBeInTheDocument();
		// The recovery variant of "what happens next", with the real percentage.
		expect(screen.getByText(/disputes\.next\.lostWithRecovery 20/)).toBeInTheDocument();
	});

	it("tells a restaurant with recovery off that nothing is being held back", () => {
		mockDisputes({
			rows: [LOST_ROW],
			recovery: { percent: 0, totalOutstanding: 50_000, totalRecovered: 0, currency: "MXN" },
			isAdmin: false,
		});
		render(<DisputesSection restaurantId={RESTAURANT_ID} />);

		expect(screen.getByText(/disputes\.next\.lostNoRecovery/)).toBeInTheDocument();
		expect(screen.queryByText(/disputes\.next\.lostWithRecovery/)).not.toBeInTheDocument();
		// No ongoing deduction, so no summary card promising one.
		expect(screen.queryByTestId("dispute-recovery-card")).not.toBeInTheDocument();
	});

	it("stops promising deductions once the debt is repaid", () => {
		mockDisputes({
			rows: [{ ...LOST_ROW, outstanding: 0, recovered: 64_000, recoveryStatus: "recovered" }],
			recovery: { percent: 20, totalOutstanding: 0, totalRecovered: 64_000, currency: "MXN" },
			isAdmin: false,
		});
		render(<DisputesSection restaurantId={RESTAURANT_ID} />);
		expect(screen.getByText(/disputes\.next\.lostSettled/)).toBeInTheDocument();
	});

	it("shows the recovery summary only while money is actually being held back", () => {
		mockDisputes({
			rows: [LOST_ROW],
			recovery: { percent: 20, totalOutstanding: 50_000, totalRecovered: 14_000, currency: "MXN" },
			isAdmin: false,
		});
		render(<DisputesSection restaurantId={RESTAURANT_ID} />);

		const card = screen.getByTestId("dispute-recovery-card");
		expect(card).toHaveTextContent("disputes.recovery.outstanding $500.00 MXN");
		expect(card).toHaveTextContent("disputes.recovery.recovered $140.00 MXN");
	});

	it("keeps the ledger split to platform admins", () => {
		mockDisputes({
			rows: [LOST_ROW],
			recovery: { percent: 20, totalOutstanding: 50_000, totalRecovered: 14_000, currency: "MXN" },
			isAdmin: false,
		});
		const { rerender } = render(<DisputesSection restaurantId={RESTAURANT_ID} />);
		expect(screen.queryByTestId("dispute-ledger-dp_lost_1")).not.toBeInTheDocument();

		mockDisputes({
			rows: [LOST_ROW],
			recovery: { percent: 20, totalOutstanding: 50_000, totalRecovered: 14_000, currency: "MXN" },
			isAdmin: true,
		});
		rerender(<DisputesSection restaurantId={RESTAURANT_ID} />);
		expect(screen.getByTestId("dispute-ledger-dp_lost_1")).toBeInTheDocument();
	});

	it("says an open dispute is being handled, and withholds nothing", () => {
		mockDisputes({
			rows: [OPEN_ROW],
			recovery: { percent: 20, totalOutstanding: 0, totalRecovered: 0, currency: "MXN" },
			isAdmin: false,
		});
		render(<DisputesSection restaurantId={RESTAURANT_ID} />);
		expect(screen.getByText(/disputes\.next\.open/)).toBeInTheDocument();
	});

	it("renders a status Stripe has not documented as copy, never as an identifier", () => {
		mockDisputes({
			rows: [{ ...OPEN_ROW, status: DISPUTE_STATUS.UNKNOWN }],
			recovery: { percent: 0, totalOutstanding: 0, totalRecovered: 0, currency: "MXN" },
			isAdmin: false,
		});
		render(<DisputesSection restaurantId={RESTAURANT_ID} />);
		expect(screen.getByText("disputes.status.unknown")).toBeInTheDocument();
	});
});

describe("DisputeRecoveryControl", () => {
	const SETTINGS = { percent: 20, maxPercent: 50, defaultPercent: 0 };

	it("renders nothing when the query is refused — i.e. the viewer is not an admin", () => {
		mockDisputes(undefined);
		const { container } = render(<DisputeRecoveryControl restaurantId={RESTAURANT_ID} />);
		expect(container).toBeEmptyDOMElement();
	});

	it("saves a valid percentage", async () => {
		mockDisputes(SETTINGS);
		setPercentMock.mockResolvedValue([{ percent: 30 }, null]);

		render(<DisputeRecoveryControl restaurantId={RESTAURANT_ID} />);
		fireEvent.change(screen.getByTestId("dispute-recovery-percent-input"), {
			target: { value: "30" },
		});
		fireEvent.click(screen.getByTestId("dispute-recovery-save"));

		await waitFor(() =>
			expect(setPercentMock).toHaveBeenCalledWith({ restaurantId: RESTAURANT_ID, percent: 30 })
		);
		expect(await screen.findByTestId("dispute-recovery-saved")).toBeInTheDocument();
	});

	it("refuses 51 without ever reaching the backend", async () => {
		mockDisputes(SETTINGS);

		render(<DisputeRecoveryControl restaurantId={RESTAURANT_ID} />);
		fireEvent.change(screen.getByTestId("dispute-recovery-percent-input"), {
			target: { value: "51" },
		});
		fireEvent.click(screen.getByTestId("dispute-recovery-save"));

		expect(await screen.findByText(/disputes\.admin\.invalid 50/)).toBeInTheDocument();
		expect(setPercentMock).not.toHaveBeenCalled();
	});

	it("refuses a fraction", async () => {
		mockDisputes(SETTINGS);

		render(<DisputeRecoveryControl restaurantId={RESTAURANT_ID} />);
		fireEvent.change(screen.getByTestId("dispute-recovery-percent-input"), {
			target: { value: "12.5" },
		});
		fireEvent.click(screen.getByTestId("dispute-recovery-save"));

		expect(await screen.findByText(/disputes\.admin\.invalid 50/)).toBeInTheDocument();
		expect(setPercentMock).not.toHaveBeenCalled();
	});

	it("reads 0 as 'recovery is off' rather than as an empty field", async () => {
		mockDisputes({ ...SETTINGS, percent: 0 });
		render(<DisputeRecoveryControl restaurantId={RESTAURANT_ID} />);
		expect(await screen.findByText("disputes.admin.disabledHint")).toBeInTheDocument();
	});
});
