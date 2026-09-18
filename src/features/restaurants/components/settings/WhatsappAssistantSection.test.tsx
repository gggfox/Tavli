/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
/**
 * The WhatsApp assistant section must say, in Settings, why reservations are
 * off at a restaurant with no tables — and point at the fix. It must NOT block
 * enabling: the assistant still answers menu questions without a floor plan.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
	enablement: null as any,
	settings: null as any,
	setEnabled: vi.fn(async () => null),
	toggleActive: vi.fn(async () => [true, null]),
	regenerate: vi.fn(async () => null),
}));

vi.mock("@tanstack/react-query", () => ({
	useQuery: ({ queryKey }: any) => {
		const name = queryKey?.[0];
		if (name === "whatsappChannels:getForRestaurant") return { data: hoisted.enablement };
		if (name === "reservationSettings:get") return { data: hoisted.settings };
		return { data: undefined };
	},
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (ref: any, args: unknown) => ({ queryKey: [getFunctionName(ref), args] }),
	useConvexMutation: (ref: any) => {
		const name = getFunctionName(ref);
		if (name === "whatsappChannels:setEnabled") return hoisted.setEnabled;
		if (name === "restaurants:toggleActive") return hoisted.toggleActive;
		return hoisted.regenerate;
	},
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({ to, search, children, ...rest }: any) => (
		<a href={`${to}?manage=${search?.manage ?? ""}`} {...rest}>
			{children}
		</a>
	),
}));

vi.mock("@/features/whatsapp", () => ({
	WhatsappAssistantPanel: () => <div data-testid="assistant-panel" />,
}));

import { WhatsappAssistantSection } from "./WhatsappAssistantSection";

const RESTAURANT_ID = "restaurants:1" as any;

function settings(overrides: Record<string, unknown> = {}) {
	return {
		_id: null,
		restaurantId: RESTAURANT_ID,
		defaultTurnMinutes: 90,
		turnMinutesByCapacity: [],
		minAdvanceMinutes: 30,
		maxAdvanceDays: 60,
		noShowGraceMinutes: 15,
		blackoutWindows: [],
		acceptingReservations: false,
		acceptingReservationsSetting: true,
		hasActiveTables: false,
		isDefault: true,
		...overrides,
	};
}

function enablement(overrides: Record<string, unknown> = {}) {
	return {
		restaurantId: RESTAURANT_ID,
		restaurantName: "Tavliai",
		isActive: true,
		restaurantIsActive: true,
		shortCode: "TVLUL2",
		formattedShortCode: "TVL-UL2",
		deepLinkUrl: "https://wa.me/14058777412?text=hi",
		deepLinkText: "Hi, I'd like information about Tavliai · TVL-UL2",
		...overrides,
	};
}

describe("WhatsappAssistantSection with no tables", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		hoisted.enablement = null;
		hoisted.settings = settings();
	});

	it("warns that reservations are off and links to the tables canvas, before enabling", () => {
		render(<WhatsappAssistantSection restaurantId={RESTAURANT_ID} isAdmin />);

		expect(screen.getByText(/has no tables/i)).toBeTruthy();
		const link = screen.getByRole("link", { name: /set up tables/i }) as HTMLAnchorElement;
		expect(link.getAttribute("href")).toBe("/admin/restaurants?manage=restaurants:1");
	});

	it("does not block enabling — the assistant still answers menu questions", () => {
		render(<WhatsappAssistantSection restaurantId={RESTAURANT_ID} isAdmin />);

		expect(screen.getByRole("button", { name: /enable/i })).toBeTruthy();
	});

	it("still warns once the assistant is enabled", () => {
		hoisted.enablement = enablement();

		render(<WhatsappAssistantSection restaurantId={RESTAURANT_ID} isAdmin />);

		expect(screen.getByTestId("assistant-panel")).toBeTruthy();
		expect(screen.getByText(/has no tables/i)).toBeTruthy();
	});

	it("says nothing about tables once one exists", () => {
		hoisted.enablement = enablement();
		hoisted.settings = settings({ hasActiveTables: true, acceptingReservations: true });

		render(<WhatsappAssistantSection restaurantId={RESTAURANT_ID} isAdmin />);

		expect(screen.queryByText(/has no tables/i)).toBeNull();
	});
});

/**
 * The assistant follows the restaurant's active state (TAVLI-107). Deactivating
 * a restaurant does not touch the channel row, so Settings must derive "off"
 * from the restaurant, refuse to enable at an inactive one, and offer the fix.
 */
describe("WhatsappAssistantSection at an inactive restaurant", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		hoisted.enablement = null;
		hoisted.settings = settings({ hasActiveTables: true, acceptingReservations: true });
		hoisted.toggleActive.mockResolvedValue([true, null]);
		hoisted.setEnabled.mockResolvedValue(null);
	});

	it("shows an enabled assistant as off while the restaurant is inactive, with the fix", () => {
		hoisted.enablement = enablement({ restaurantIsActive: false });

		render(<WhatsappAssistantSection restaurantId={RESTAURANT_ID} isAdmin />);

		expect(screen.getByText(/off · restaurant inactive/i)).toBeTruthy();
		expect(screen.queryByText(/^paused$/i)).toBeNull();
		expect(screen.getByRole("button", { name: /activate restaurant/i })).toBeTruthy();
	});

	it("shows staff the off badge but not the fix", () => {
		hoisted.enablement = enablement({ restaurantIsActive: false });

		render(<WhatsappAssistantSection restaurantId={RESTAURANT_ID} isAdmin={false} />);

		expect(screen.getByText(/off · restaurant inactive/i)).toBeTruthy();
		expect(screen.queryByRole("button", { name: /activate restaurant/i })).toBeNull();
	});

	it("says nothing about the restaurant while it is active", () => {
		hoisted.enablement = enablement();

		render(<WhatsappAssistantSection restaurantId={RESTAURANT_ID} isAdmin />);

		expect(screen.queryByText(/restaurant inactive/i)).toBeNull();
		expect(screen.queryByRole("button", { name: /activate restaurant/i })).toBeNull();
	});

	it("explains a refused enable and offers to activate the restaurant", async () => {
		hoisted.setEnabled.mockRejectedValueOnce(
			new Error(
				"[CONVEX M(whatsappChannels:setEnabled)] [Request ID: x] Server Error\nUncaught Error: ERROR_RESTAURANT_INACTIVE\n    at handler"
			)
		);

		render(<WhatsappAssistantSection restaurantId={RESTAURANT_ID} isAdmin />);
		fireEvent.click(screen.getByRole("button", { name: /^enable$/i }));

		await waitFor(() =>
			expect(screen.getByText(/can't be enabled while the restaurant is inactive/i)).toBeTruthy()
		);
		expect(screen.getByRole("button", { name: /activate restaurant/i })).toBeTruthy();
		expect(screen.queryByText(/that didn't work/i)).toBeNull();
	});

	it("the quick action activates the restaurant and then enables the assistant, in that order", async () => {
		hoisted.enablement = enablement({ restaurantIsActive: false });
		const order: string[] = [];
		hoisted.toggleActive.mockImplementation(async () => {
			order.push("toggleActive");
			return [true, null];
		});
		hoisted.setEnabled.mockImplementation(async () => {
			order.push("setEnabled");
			return null;
		});

		render(<WhatsappAssistantSection restaurantId={RESTAURANT_ID} isAdmin />);
		fireEvent.click(screen.getByRole("button", { name: /activate restaurant/i }));

		await waitFor(() => expect(order).toEqual(["toggleActive", "setEnabled"]));
		expect(hoisted.toggleActive).toHaveBeenCalledWith({ restaurantId: RESTAURANT_ID });
		expect(hoisted.setEnabled).toHaveBeenCalledWith({
			restaurantId: RESTAURANT_ID,
			isActive: true,
		});
	});

	it("keeps a generic failure generic", async () => {
		hoisted.setEnabled.mockRejectedValueOnce(new Error("network down"));

		render(<WhatsappAssistantSection restaurantId={RESTAURANT_ID} isAdmin />);
		fireEvent.click(screen.getByRole("button", { name: /^enable$/i }));

		await waitFor(() => expect(screen.getByText(/that didn't work/i)).toBeTruthy());
		expect(screen.queryByRole("button", { name: /activate restaurant/i })).toBeNull();
	});
});
