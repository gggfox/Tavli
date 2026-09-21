/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown */
/**
 * The admin Payment Setup panel's three account states (TAVLI-65).
 *
 * The state that mattered was the one the component could not render: a
 * connected account Stripe had CLOSED fell through to the "not connected"
 * branch, so the operator saw "Onboard to collect payments" — a button that
 * cannot work on a dead account — and no hint that anything had happened. The
 * Reset control has to stay reachable in that state, because unlinking is the
 * only route to a working account.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StripeStatusSection, type AccountStatus } from "./StripeStatusSection";

const noop = vi.fn();

function renderSection(status: AccountStatus | null, isFullySetUp = false) {
	return render(
		<StripeStatusSection
			status={status}
			isFullySetUp={isFullySetUp}
			actionLoading={false}
			resetLoading={false}
			confirmingReset={false}
			onSetup={noop}
			onRefresh={noop}
			onRequestReset={noop}
			onCancelReset={noop}
			onConfirmReset={noop}
		/>
	);
}

describe("StripeStatusSection", () => {
	it("explains a closed account and keeps the reset control reachable", () => {
		renderSection({
			connected: true,
			readyToReceivePayments: false,
			onboardingComplete: false,
			requirementsStatus: null,
			accountStatus: "closed",
		});

		expect(screen.getByTestId("stripe-account-closed").textContent).toContain(
			"Stripe has closed this connected account"
		);
		expect(screen.getByTestId("stripe-reset-button")).toBeTruthy();
		// Never the never-onboarded copy, and never a setup button that cannot work.
		expect(screen.queryByText("Onboard to collect payments")).toBeNull();
		expect(screen.queryByText("Continue Stripe Setup")).toBeNull();
	});

	it("labels a restricted account instead of leaving the requirement warnings unexplained", () => {
		renderSection({
			connected: true,
			readyToReceivePayments: false,
			onboardingComplete: false,
			requirementsStatus: "past_due",
			accountStatus: "restricted",
		});

		expect(screen.getByTestId("stripe-account-restricted").textContent).toContain(
			"Stripe is not letting this account take payments right now"
		);
		// Restricted is recoverable, so the onboarding link stays.
		expect(screen.getByText("Continue Stripe Setup")).toBeTruthy();
		expect(screen.getByTestId("stripe-reset-button")).toBeTruthy();
	});

	it("still shows the plain setup pitch when no account was ever created", () => {
		renderSection({
			connected: false,
			readyToReceivePayments: false,
			onboardingComplete: false,
			requirementsStatus: null,
			accountStatus: null,
		});

		expect(screen.getByText("Onboard to collect payments")).toBeTruthy();
		expect(screen.queryByTestId("stripe-account-closed")).toBeNull();
		expect(screen.queryByTestId("stripe-reset-button")).toBeNull();
	});

	it("leaves a legacy connected account with no stored status unlabelled", () => {
		renderSection({
			connected: true,
			readyToReceivePayments: false,
			onboardingComplete: false,
			requirementsStatus: "currently_due",
		});

		expect(screen.queryByTestId("stripe-account-closed")).toBeNull();
		expect(screen.queryByTestId("stripe-account-restricted")).toBeNull();
		expect(screen.getByText("Continue Stripe Setup")).toBeTruthy();
	});
});
