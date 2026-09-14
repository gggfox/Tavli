/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
/**
 * The owner's "accepting reservations" toggle must show the owner's own
 * setting, not the effective value after the zero-tables fold. Otherwise a
 * restaurant with no tables yet sees its toggle OFF, cannot turn it "on", and
 * — worse — a save would write that OFF into the row and keep reservations
 * off after tables are added.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
	settings: null as any,
	mutateAsync: vi.fn(async () => [null, null]),
}));

vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: hoisted.settings }),
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (ref: unknown, args: unknown) => ({ queryKey: [ref, args] }),
}));

vi.mock("@/global/hooks", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	useConvexMutate: () => ({ mutateAsync: hoisted.mutateAsync, isPending: false }),
}));

import { ReservationSettingsPanel } from "./ReservationSettingsPanel";

function settings(overrides: Record<string, unknown> = {}) {
	return {
		_id: null,
		restaurantId: "restaurants:1",
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

describe("ReservationSettingsPanel at a restaurant with no tables", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		hoisted.settings = settings();
	});

	it("shows the owner's toggle as ON even though the effective value is off", () => {
		render(<ReservationSettingsPanel restaurantId={"restaurants:1" as any} />);

		const toggle = screen.getByRole("checkbox") as HTMLInputElement;
		expect(toggle.checked).toBe(true);
	});

	it("explains that reservations stay off until a table exists", () => {
		render(<ReservationSettingsPanel restaurantId={"restaurants:1" as any} />);

		expect(screen.getByText(/no tables/i)).toBeTruthy();
	});

	it("drops the explanation once a table exists", () => {
		hoisted.settings = settings({ hasActiveTables: true, acceptingReservations: true });

		render(<ReservationSettingsPanel restaurantId={"restaurants:1" as any} />);

		expect(screen.queryByText(/no tables/i)).toBeNull();
	});
});
