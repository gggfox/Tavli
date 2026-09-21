/**
 * The payouts page and the payments-page banner (TAVLI-103).
 *
 * What is pinned here is what a manager would notice being wrong: the
 * reassurance comes before the problem, the held total is only on screen while
 * money is actually stuck, a failed payout shows a reason and a fix in the
 * page's own words rather than Stripe's, and the banner on the payments page
 * exists only when there is something to say.
 */
import { render, screen } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { PAYOUT_FAILURE_CODE, STRIPE_PAYOUT_STATUS } from "convex/constants";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "convex/_generated/dataModel";
import { PayoutsDashboard } from "./PayoutsDashboard";
import { PayoutsHeldBanner } from "./PayoutsHeldBanner";

vi.mock("@tanstack/react-query", () => ({
	useQuery: vi.fn(),
}));

vi.mock("@convex-dev/react-query", () => ({
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	convexQuery: (ref: any, args: unknown) => ({ queryKey: [getFunctionName(ref)], ref, args }),
	useConvexAction: () => vi.fn(),
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
			// Keys plus their interpolated values, so a test can tell "1,000.00
			// held" from "some amount held".
			t: (key: string, params?: Record<string, unknown>) =>
				params && Object.keys(params).length > 0
					? `${key} ${Object.values(params).join(" ")}`
					: key,
			i18n: { language: "en" },
		}),
	};
});

const RESTAURANT_ID = "restaurants:cocina" as Id<"restaurants">;

const FAILED_ROW = {
	_id: "stripePayouts:1",
	stripePayoutId: "po_failed_1",
	amount: 100_000,
	currency: "MXN",
	status: STRIPE_PAYOUT_STATUS.FAILED,
	createdAt: 1_700_000_000_000,
	arrivalDate: 1_700_086_400_000,
	failureCode: PAYOUT_FAILURE_CODE.INVALID_ACCOUNT_NUMBER,
};

const PAID_ROW = {
	_id: "stripePayouts:2",
	stripePayoutId: "po_paid_1",
	amount: 40_000,
	currency: "MXN",
	status: STRIPE_PAYOUT_STATUS.PAID,
	createdAt: 1_699_000_000_000,
	arrivalDate: 1_699_086_400_000,
	failureCode: undefined,
};

type PageData = {
	rows: unknown[];
	held: { heldCents: number; unresolvedPayoutIds: string[]; currency: string };
	hasStripeAccount: boolean;
};

function mockPage(data: PageData | undefined, opts: { isPending?: boolean; error?: Error } = {}) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	vi.mocked(useQuery).mockImplementation((options: any) => {
		const name = String(options.queryKey[0]);
		if (name.includes("getHeldTotal")) {
			return { data: data?.held, isPending: false, error: null } as never;
		}
		return {
			data: options.select ? options.select([data ?? null, null]) : data,
			isPending: opts.isPending ?? false,
			error: opts.error ?? null,
		} as never;
	});
}

/** The banner reads only `getHeldTotal`, so it gets its own, smaller stub. */
function mockHeldTotal(
	held: { heldCents: number; unresolvedPayoutIds: string[]; currency: string } | undefined,
	error?: Error
) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	vi.mocked(useQuery).mockImplementation((options: any) => {
		return {
			data: options.select ? options.select([held ?? null, null]) : held,
			isPending: false,
			error: error ?? null,
		} as never;
	});
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("PayoutsDashboard", () => {
	it("leads with the reassurance, then the held amount, then the fix", () => {
		mockPage({
			rows: [FAILED_ROW, PAID_ROW],
			held: { heldCents: 100_000, unresolvedPayoutIds: ["po_failed_1"], currency: "MXN" },
			hasStripeAccount: true,
		});

		render(<PayoutsDashboard restaurantId={RESTAURANT_ID} />);

		const card = screen.getByTestId("held-total-card");
		expect(card.textContent).toContain("payouts.safeLine");
		expect(card.textContent).toContain("payouts.held.title 1,000.00 MXN");
		expect(card.textContent).toContain("payouts.held.fixCta");

		// The promise of the ticket, as an ordering assertion: the manager reads
		// "your money is safe" before they read that anything went wrong.
		const text = card.textContent ?? "";
		expect(text.indexOf("payouts.safeLine")).toBeLessThan(text.indexOf("payouts.held.title"));
		expect(text.indexOf("payouts.held.title")).toBeLessThan(text.indexOf("payouts.held.fixCta"));
	});

	it("shows no held card when nothing is stuck", () => {
		mockPage({
			rows: [PAID_ROW],
			held: { heldCents: 0, unresolvedPayoutIds: [], currency: "MXN" },
			hasStripeAccount: true,
		});

		render(<PayoutsDashboard restaurantId={RESTAURANT_ID} />);

		expect(screen.queryByTestId("held-total-card")).toBeNull();
		expect(screen.getByTestId("payout-row-po_paid_1")).toBeTruthy();
	});

	it("gives a failed payout a reason and a fix, and never a raw Stripe string", () => {
		mockPage({
			rows: [FAILED_ROW],
			held: { heldCents: 100_000, unresolvedPayoutIds: ["po_failed_1"], currency: "MXN" },
			hasStripeAccount: true,
		});

		render(<PayoutsDashboard restaurantId={RESTAURANT_ID} />);

		const row = screen.getByTestId("payout-row-po_failed_1");
		expect(row.textContent).toContain("payouts.failure.invalidAccountNumber.reason");
		expect(row.textContent).toContain("payouts.failure.invalidAccountNumber.fix");
		// The status reads in the restaurant's terms, from a key, never "failed".
		expect(row.textContent).toContain("payouts.status.failed");
		// A failed payout has no arrival date to promise: Stripe replaces it with
		// a new payout rather than retrying this one.
		expect(row.textContent).not.toContain("payouts.list.arrivesOn");
	});

	it("falls back to the unknown copy for a payout whose code did not survive", () => {
		mockPage({
			rows: [{ ...FAILED_ROW, failureCode: undefined }],
			held: { heldCents: 100_000, unresolvedPayoutIds: ["po_failed_1"], currency: "MXN" },
			hasStripeAccount: true,
		});

		render(<PayoutsDashboard restaurantId={RESTAURANT_ID} />);

		expect(screen.getByTestId("payout-row-po_failed_1").textContent).toContain(
			"payouts.failure.unknown.reason"
		);
	});

	it("tells an arrived payout apart from one on the way", () => {
		mockPage({
			rows: [
				PAID_ROW,
				{ ...PAID_ROW, _id: "stripePayouts:3", stripePayoutId: "po_transit", status: "in_transit" },
			],
			held: { heldCents: 0, unresolvedPayoutIds: [], currency: "MXN" },
			hasStripeAccount: true,
		});

		render(<PayoutsDashboard restaurantId={RESTAURANT_ID} />);

		expect(screen.getByTestId("payout-row-po_paid_1").textContent).toContain(
			"payouts.list.arrivedOn"
		);
		expect(screen.getByTestId("payout-row-po_transit").textContent).toContain(
			"payouts.list.arrivesOn"
		);
	});

	it("says there are no payouts yet when the account exists but has paid out nothing", () => {
		mockPage({
			rows: [],
			held: { heldCents: 0, unresolvedPayoutIds: [], currency: "MXN" },
			hasStripeAccount: true,
		});

		render(<PayoutsDashboard restaurantId={RESTAURANT_ID} />);

		expect(screen.getByText("payouts.empty.title")).toBeTruthy();
	});

	it("says no bank account is connected when the restaurant has no Stripe account", () => {
		mockPage({
			rows: [],
			held: { heldCents: 0, unresolvedPayoutIds: [], currency: "MXN" },
			hasStripeAccount: false,
		});

		render(<PayoutsDashboard restaurantId={RESTAURANT_ID} />);

		expect(screen.getByText("payouts.notConnected.title")).toBeTruthy();
	});
});

describe("PayoutsHeldBanner", () => {
	it("says how much has not arrived and links to the payouts page", () => {
		mockHeldTotal({ heldCents: 250_000, unresolvedPayoutIds: ["po_1", "po_2"], currency: "MXN" });

		render(<PayoutsHeldBanner restaurantId={RESTAURANT_ID} />);

		const banner = screen.getByTestId("payouts-held-banner");
		expect(banner.textContent).toContain("payouts.banner.title 2,500.00 MXN");
		expect(banner.textContent).toContain("payouts.banner.body");
		expect(screen.getByText("payouts.banner.cta").getAttribute("to")).toBe("/admin/payouts");
	});

	it("renders nothing while nothing is held", () => {
		mockHeldTotal({ heldCents: 0, unresolvedPayoutIds: [], currency: "MXN" });

		render(<PayoutsHeldBanner restaurantId={RESTAURANT_ID} />);

		expect(screen.queryByTestId("payouts-held-banner")).toBeNull();
	});

	it("renders nothing when the query was refused, rather than an empty banner", () => {
		mockHeldTotal(undefined, new Error("NOT_AUTHORIZED"));

		render(<PayoutsHeldBanner restaurantId={RESTAURANT_ID} />);

		expect(screen.queryByTestId("payouts-held-banner")).toBeNull();
	});
});
