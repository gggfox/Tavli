/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useConvexAction } from "@convex-dev/react-query";
import { getFunctionName } from "convex/server";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { StripeConnectSetup } from "./StripeConnectSetup";

vi.mock("@convex-dev/react-query", () => ({
	useConvexAction: vi.fn(),
}));

const mockCreateAccount = vi.fn();
const mockCreateLink = vi.fn();
const mockCheckStatus = vi.fn();
const mockResetConnection = vi.fn();

const fullySetUpStatus = {
	connected: true,
	readyToReceivePayments: true,
	onboardingComplete: true,
	requirementsStatus: null,
};

const pastDueStatus = {
	connected: true,
	readyToReceivePayments: false,
	onboardingComplete: false,
	requirementsStatus: "past_due",
};

const disconnectedStatus = {
	connected: false,
	readyToReceivePayments: false,
	onboardingComplete: false,
	requirementsStatus: null,
};

describe("StripeConnectSetup", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockCheckStatus.mockReset();
		mockResetConnection.mockReset();
		vi.mocked(useConvexAction).mockImplementation((ref: any) => {
			const name = getFunctionName(ref);
			if (name === "stripe:createConnectAccount") return mockCreateAccount;
			if (name === "stripe:createAccountLink") return mockCreateLink;
			if (name === "stripe:resetStripeConnection") return mockResetConnection;
			return mockCheckStatus;
		});
		mockCheckStatus.mockResolvedValue(fullySetUpStatus);
		globalThis.history.replaceState(
			{},
			"",
			"/admin/restaurants?stripe_return=true&accountId=acct_returned"
		);
	});

	it("refreshes Stripe status when returning from onboarding and clears return params", async () => {
		render(<StripeConnectSetup restaurantId={"restaurants:test" as any} />);

		await waitFor(() => {
			expect(mockCheckStatus).toHaveBeenCalledTimes(2);
		});
		expect(screen.getByText("Payments Enabled")).toBeTruthy();
		expect(globalThis.location.search).toBe("");
	});

	it("shows a reset control once a Stripe account exists so the user can restart onboarding", async () => {
		globalThis.history.replaceState({}, "", "/admin/restaurants");
		mockCheckStatus.mockReset();
		mockCheckStatus.mockResolvedValue(pastDueStatus);

		render(<StripeConnectSetup restaurantId={"restaurants:test" as any} />);

		const resetButton = await screen.findByTestId("stripe-reset-button");
		expect(resetButton).toBeTruthy();
	});

	it("confirms, calls resetStripeConnection, and surfaces success notice", async () => {
		globalThis.history.replaceState({}, "", "/admin/restaurants");
		mockCheckStatus.mockReset();
		mockCheckStatus.mockResolvedValue(pastDueStatus);
		mockResetConnection.mockImplementation(async () => {
			mockCheckStatus.mockResolvedValue(disconnectedStatus);
			return { closedStripeAccount: true, closedStripeAccountId: "acct_closed_123" };
		});

		render(<StripeConnectSetup restaurantId={"restaurants:test" as any} />);

		const resetButton = await screen.findByTestId("stripe-reset-button");
		fireEvent.click(resetButton);

		const confirmButton = await screen.findByTestId("stripe-reset-confirm-button");
		fireEvent.click(confirmButton);

		await waitFor(() => {
			expect(mockResetConnection).toHaveBeenCalledWith({ restaurantId: "restaurants:test" });
		});
		await waitFor(() => {
			expect(
				screen.getByText(/Disconnected and closed Stripe account acct_closed_123/)
			).toBeTruthy();
		});
		await waitFor(() => {
			expect(screen.getByText("Onboard to collect payments")).toBeTruthy();
		});
	});

	it("still unlinks locally with a fallback notice when Stripe could not close the account", async () => {
		globalThis.history.replaceState({}, "", "/admin/restaurants");
		mockCheckStatus.mockReset();
		mockCheckStatus.mockResolvedValue(pastDueStatus);
		mockResetConnection.mockImplementation(async () => {
			mockCheckStatus.mockResolvedValue(disconnectedStatus);
			return { closedStripeAccount: false, closedStripeAccountId: "acct_stuck_456" };
		});

		render(<StripeConnectSetup restaurantId={"restaurants:test" as any} />);

		fireEvent.click(await screen.findByTestId("stripe-reset-button"));
		fireEvent.click(await screen.findByTestId("stripe-reset-confirm-button"));

		await waitFor(() => {
			expect(screen.getByText(/Disconnected from Stripe/)).toBeTruthy();
		});
	});
});
