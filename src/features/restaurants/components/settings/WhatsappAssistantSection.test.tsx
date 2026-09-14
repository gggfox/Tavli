/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
/**
 * The WhatsApp assistant section must say, in Settings, why reservations are
 * off at a restaurant with no tables — and point at the fix. It must NOT block
 * enabling: the assistant still answers menu questions without a floor plan.
 */
import { render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
	enablement: null as any,
	settings: null as any,
	setEnabled: vi.fn(async () => null),
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
	useConvexMutation: () => hoisted.setEnabled,
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

function enablement() {
	return {
		restaurantId: RESTAURANT_ID,
		restaurantName: "Tavliai",
		isActive: true,
		shortCode: "TVLUL2",
		formattedShortCode: "TVL-UL2",
		deepLinkUrl: "https://wa.me/14058777412?text=hi",
		deepLinkText: "Hi, I'd like information about Tavliai · TVL-UL2",
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
