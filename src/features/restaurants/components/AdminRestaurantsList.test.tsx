/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const now = 1_745_000_000_000;

const restaurant = {
	_id: "restaurants:1",
	_creationTime: now,
	name: "La Cocina",
	slug: "la-cocina",
	currency: "MXN",
	organizationId: "organizations:1",
	ownerId: "user_owner",
	isActive: true,
	createdAt: now,
	updatedAt: now,
} as any;

vi.mock("@tanstack/react-query", () => ({
	useMutation: () => ({ mutateAsync: vi.fn(async () => [null, null]), isPending: false }),
	useQuery: ({ queryKey }: any) => {
		const name = queryKey?.[0];
		if (name === "restaurants:getAll") return { data: [restaurant], isLoading: false };
		return { data: [], isLoading: false };
	},
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (ref: any, args: unknown) => ({ queryKey: [getFunctionName(ref), args] }),
	useConvexMutation: () => vi.fn(async () => [null, null]),
	useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
}));

vi.mock("@clerk/tanstack-react-start", () => ({
	useUser: () => ({ user: { id: "user_owner" }, isLoaded: true }),
}));

vi.mock("@/features/users/hooks", () => ({
	useCurrentUserRoles: () => ({
		roles: ["admin"],
		organizationId: "organizations:1",
		isLoading: false,
	}),
}));

vi.mock("@/features/restaurants/RestaurantAdminScope", () => ({
	useRestaurant: () => ({ setSelectedRestaurantId: vi.fn() }),
}));

vi.mock("@/features/restaurants/hooks/useOrganizations", () => ({
	useOrganizations: () => ({ organizations: [], isLoading: false, error: null }),
}));

vi.mock("@/features/restaurants/components/TablesManager", () => ({
	TablesManager: () => <div data-testid="tables-manager" />,
}));

vi.mock("@/features/restaurants/components/RestaurantSettingsView", () => ({
	RestaurantSettingsView: ({ restaurant: r, settingsAccess, onClose }: any) => (
		<div data-testid="settings-canvas" data-access={settingsAccess} data-name={r.name}>
			<button type="button" onClick={onClose}>
				canvas-close
			</button>
		</div>
	),
}));

import { AdminRestaurantsList } from "./AdminRestaurantsList";

describe("AdminRestaurantsList settings entry point", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("routes the row's pencil to ?settings=<id> instead of opening a modal", () => {
		const onSettingsChange = vi.fn();
		render(
			<AdminRestaurantsList
				manageId={null}
				settingsId={null}
				onSettingsChange={onSettingsChange}
				onManageChange={vi.fn()}
			/>
		);

		fireEvent.click(screen.getByTitle("Edit restaurant"));

		expect(onSettingsChange).toHaveBeenCalledWith("restaurants:1");
		// The old `size="lg"` edit dialog is gone for good.
		expect(screen.queryByLabelText("Edit Restaurant")).toBeNull();
	});

	it("swaps the list for the full-canvas settings view when the param is set", () => {
		render(
			<AdminRestaurantsList
				manageId={null}
				settingsId={"restaurants:1" as any}
				onSettingsChange={vi.fn()}
				onManageChange={vi.fn()}
			/>
		);

		const canvas = screen.getByTestId("settings-canvas");
		expect(canvas.dataset.name).toBe("La Cocina");
		expect(canvas.dataset.access).toBe("full");
		// Row chrome and the top action row step aside for the canvas.
		expect(screen.queryByTitle("Edit restaurant")).toBeNull();
		expect(screen.queryByText("New Restaurant")).toBeNull();
	});

	it("clears the param when the canvas closes itself", () => {
		const onSettingsChange = vi.fn();
		render(
			<AdminRestaurantsList
				manageId={null}
				settingsId={"restaurants:1" as any}
				onSettingsChange={onSettingsChange}
				onManageChange={vi.fn()}
			/>
		);

		fireEvent.click(screen.getByText("canvas-close"));

		expect(onSettingsChange).toHaveBeenCalledWith(null);
	});
});
