/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
	setEnabledMock: vi.fn(async () => ["restaurants:1", null]),
	checkoutMock: vi.fn(async () => ({ url: "https://checkout.stripe.com/c/pay/cs_1" })),
	cancelMock: vi.fn(async () => ({ cancelAtPeriodEnd: true, currentPeriodEnd: 1_800_000_000_000 })),
	portalMock: vi.fn(async () => ({ url: "https://billing.stripe.com/session/test" })),
}));

vi.mock("@convex-dev/react-query", () => ({
	useConvexMutation: () => hoisted.setEnabledMock,
	useConvexAction: (ref: any) => {
		const name = String(ref?.name ?? ref ?? "");
		if (name.includes("Portal")) return hoisted.portalMock;
		return name.includes("cancel") ? hoisted.cancelMock : hoisted.checkoutMock;
	},
}));

vi.mock("convex/_generated/api", () => ({
	api: {
		billing: {
			createSubscriptionCheckout: { name: "billing:createSubscriptionCheckout" },
			createBillingPortalSession: { name: "billing:createBillingPortalSession" },
			cancelSubscription: { name: "billing:cancelSubscription" },
		},
		billingHelpers: {
			setPlatformSubscriptionEnabled: { name: "billingHelpers:setPlatformSubscriptionEnabled" },
		},
	},
}));

import { BillingSection } from "./BillingSection";

const PERIOD_END = new Date("2026-09-01T00:00:00Z").getTime();

function baseRestaurant(overrides: Record<string, any> = {}) {
	return {
		_id: "restaurants:1",
		_creationTime: 0,
		name: "La Cocina",
		slug: "la-cocina",
		currency: "MXN",
		organizationId: "organizations:1",
		ownerId: "user_owner",
		isActive: true,
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	} as any;
}

function renderSection(props: Record<string, any> = {}) {
	return render(
		<BillingSection restaurant={baseRestaurant(props.restaurant)} isAdmin={props.isAdmin ?? true} />
	);
}

describe("BillingSection", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		hoisted.setEnabledMock.mockResolvedValue(["restaurants:1", null] as any);
		globalThis.history.replaceState({}, "", "/admin/restaurants?settings=restaurants:1");
	});

	it("says out loud that this is not the diner-paid service fee", () => {
		renderSection();

		expect(screen.getByText(/separate from the Tavli service fee your diners pay/i)).toBeTruthy();
	});

	it("shows only the toggle and an off-state note when the flag is off", () => {
		renderSection();

		expect(screen.getByText("This restaurant isn't on the Tavli subscription.")).toBeTruthy();
		expect(screen.queryByTestId("settings-billing-checkout")).toBeNull();
		expect(screen.queryByTestId("settings-billing-cancel")).toBeNull();
	});

	it("disables the toggle for non-admins and tells them why", () => {
		renderSection({ isAdmin: false });

		const toggle = screen.getByTestId("settings-billing-toggle") as HTMLInputElement;
		expect(toggle.disabled).toBe(true);
		expect(screen.getByText("Only Tavli admins can turn this on or off.")).toBeTruthy();
	});

	it("arms the subscription through the admin-only mutation", async () => {
		renderSection();

		fireEvent.click(screen.getByTestId("settings-billing-toggle"));

		await waitFor(() => {
			expect(hoisted.setEnabledMock).toHaveBeenCalledWith({
				restaurantId: "restaurants:1",
				enabled: true,
			});
		});
	});

	it("shows the monthly amount and status once enabled", () => {
		renderSection({
			restaurant: { platformSubscriptionEnabled: true },
		});

		// Thousands separator, matching Tavli's own platform-fee receipt email
		// (`formatPlatformFeeAmount`) — the in-app figure used to read "$2000.00".
		expect(screen.getByTestId("settings-billing-amount").textContent).toBe("$2,000.00 MXN / month");
		expect(screen.getByTestId("settings-billing-status").textContent).toBe("Not set up");
		expect(screen.getByTestId("settings-billing-checkout")).toBeTruthy();
	});

	it("redirects to the Stripe Checkout URL the action returns", async () => {
		const assign = vi.fn();
		const original = globalThis.location;
		Object.defineProperty(globalThis, "location", {
			configurable: true,
			value: { ...original, search: original.search, href: original.href, assign },
		});

		renderSection({ restaurant: { platformSubscriptionEnabled: true } });
		fireEvent.click(screen.getByTestId("settings-billing-checkout"));

		await waitFor(() => {
			expect(hoisted.checkoutMock).toHaveBeenCalledWith({ restaurantId: "restaurants:1" });
		});
		await waitFor(() => {
			expect(globalThis.location.href).toBe("https://checkout.stripe.com/c/pay/cs_1");
		});

		Object.defineProperty(globalThis, "location", { configurable: true, value: original });
	});

	it("offers cancellation instead of a second checkout while a subscription is live", () => {
		renderSection({
			restaurant: {
				platformSubscriptionEnabled: true,
				stripeSubscriptionId: "sub_123",
				billingStatus: "active",
				billingCurrentPeriodEnd: PERIOD_END,
			},
		});

		// Checkout STARTS a subscription and is refused server-side while one
		// exists; managing the card goes through the Billing Portal instead.
		expect(screen.queryByTestId("settings-billing-checkout")).toBeNull();
		expect(screen.getByTestId("settings-billing-portal")).toBeTruthy();
		expect(screen.getByTestId("settings-billing-status").textContent).toBe("Active");
		expect(screen.getByTestId("settings-billing-cancel")).toBeTruthy();
	});

	it("sends a card swap to the Stripe Billing Portal, never a second checkout", async () => {
		const assign = vi.fn();
		const original = globalThis.location;
		Object.defineProperty(globalThis, "location", {
			configurable: true,
			value: { ...original, search: original.search, href: original.href, assign },
		});

		renderSection({
			restaurant: {
				platformSubscriptionEnabled: true,
				stripeSubscriptionId: "sub_123",
				billingStatus: "past_due",
			},
		});
		fireEvent.click(screen.getByTestId("settings-billing-portal"));

		await waitFor(() => {
			expect(hoisted.portalMock).toHaveBeenCalledWith({ restaurantId: "restaurants:1" });
		});
		await waitFor(() => {
			expect(globalThis.location.href).toBe("https://billing.stripe.com/session/test");
		});
		// A second Checkout would mint a second subscription.
		expect(hoisted.checkoutMock).not.toHaveBeenCalled();

		Object.defineProperty(globalThis, "location", { configurable: true, value: original });
	});

	it("surfaces a portal failure as localized copy", async () => {
		hoisted.portalMock.mockRejectedValueOnce(
			new Error(
				"[CONVEX A(billing:createBillingPortalSession)] ERROR_BILLING_PORTAL_UNAVAILABLE"
			) as any
		);
		renderSection({
			restaurant: {
				platformSubscriptionEnabled: true,
				stripeSubscriptionId: "sub_123",
				billingStatus: "active",
			},
		});

		fireEvent.click(screen.getByTestId("settings-billing-portal"));

		await waitFor(() => {
			expect(screen.getByText(/couldn't open the Stripe billing portal/i)).toBeTruthy();
		});
	});

	it("requires a confirmation before cancelling, and cancels at period end", async () => {
		renderSection({
			restaurant: {
				platformSubscriptionEnabled: true,
				stripeSubscriptionId: "sub_123",
				billingStatus: "active",
				billingCurrentPeriodEnd: PERIOD_END,
			},
		});

		fireEvent.click(screen.getByTestId("settings-billing-cancel"));
		expect(hoisted.cancelMock).not.toHaveBeenCalled();
		expect(screen.getByText(/Cancel at the end of the current period\?/i)).toBeTruthy();

		fireEvent.click(screen.getByTestId("settings-billing-cancel-confirm"));
		await waitFor(() => {
			expect(hoisted.cancelMock).toHaveBeenCalledWith({ restaurantId: "restaurants:1" });
		});
	});

	it("shows the pending cancellation and hides the cancel button once scheduled", () => {
		renderSection({
			restaurant: {
				platformSubscriptionEnabled: true,
				stripeSubscriptionId: "sub_123",
				billingStatus: "active",
				billingCurrentPeriodEnd: PERIOD_END,
				billingCancelAtPeriodEnd: true,
			},
		});

		expect(screen.getByTestId("settings-billing-cancel-notice")).toBeTruthy();
		expect(screen.queryByTestId("settings-billing-cancel")).toBeNull();
	});

	it("points a past_due restaurant at the portal to pay with a different card", () => {
		renderSection({
			restaurant: {
				platformSubscriptionEnabled: true,
				stripeSubscriptionId: "sub_123",
				billingStatus: "past_due",
			},
		});

		expect(screen.getByTestId("settings-billing-status").textContent).toBe("Payment failed");
		expect(screen.getByText(/The last payment didn't go through/i)).toBeTruthy();
		expect(screen.getByTestId("settings-billing-portal")).toBeTruthy();
	});

	it("surfaces a checkout failure as localized copy, never the raw error", async () => {
		hoisted.checkoutMock.mockRejectedValueOnce(
			new Error("[CONVEX A(billing:createSubscriptionCheckout)] ERROR_BILLING_NOT_ENABLED") as any
		);
		renderSection({ restaurant: { platformSubscriptionEnabled: true } });

		fireEvent.click(screen.getByTestId("settings-billing-checkout"));

		await waitFor(() => {
			expect(screen.getByText(/isn't on the Tavli subscription yet/i)).toBeTruthy();
		});
	});

	it("acknowledges the return from Stripe checkout and cleans the URL", async () => {
		globalThis.history.replaceState(
			{},
			"",
			"/admin/restaurants?settings=restaurants:1&billing=success"
		);

		renderSection({ restaurant: { platformSubscriptionEnabled: true } });

		await waitFor(() => {
			expect(screen.getByText(/Subscription started/i)).toBeTruthy();
		});
		expect(globalThis.location.search).not.toContain("billing=");
	});
});
