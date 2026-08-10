/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
/**
 * The admin scope provider, exercised through the context it publishes.
 *
 * The load-bearing case is the first one: with nothing stored, the scope is
 * **All organizations** and an admin still sees every restaurant. The
 * organization switcher is only allowed to narrow that after a deliberate pick.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import type { Doc, Id } from "convex/_generated/dataModel";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	LOCAL_STORAGE_KEY_ADMIN_SELECTED_ORGANIZATION_ID,
	LOCAL_STORAGE_KEY_ADMIN_SELECTED_RESTAURANT_ID,
} from "./constants";

const hoisted = vi.hoisted(() => ({
	restaurants: [] as any[],
	restaurantsLoading: false,
	isAuthenticated: true,
	roles: ["admin"] as string[],
	rolesLoading: false,
	orgState: {
		organizations: [] as any[],
		isLoading: false,
		error: null as unknown,
	},
	/**
	 * Makes the hook mock hand back `orgState` even when the provider disabled
	 * the query — the belt-and-braces case where an authorization error leaks
	 * through to a viewer who has no switcher to clear a filter with.
	 */
	orgStateIgnoresEnabled: false,
	/** Arguments every `useOrganizations()` call was made with. */
	orgHookCalls: [] as unknown[],
	/** Every (organization filter, active restaurant's org) pair ever rendered. */
	renderLog: [] as { orgFilter: string | null; restaurantOrg: string | null }[],
}));

vi.mock("@tanstack/react-query", () => ({
	useQuery: ({ queryKey }: any) => {
		if (queryKey?.[0] === "restaurants:getAll") {
			return { data: hoisted.restaurants, isLoading: hoisted.restaurantsLoading };
		}
		return { data: undefined, isLoading: false };
	},
	useMutation: () => ({ mutateAsync: vi.fn(async () => [null, null]), isPending: false }),
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (ref: any, args: unknown) => ({ queryKey: [getFunctionName(ref), args] }),
	useConvexMutation: () => vi.fn(async () => [null, null]),
	useConvexAuth: () => ({ isAuthenticated: hoisted.isAuthenticated, isLoading: false }),
}));

vi.mock("./hooks/useOrganizations", () => ({
	useOrganizations: (options?: unknown) => {
		hoisted.orgHookCalls.push(options);
		// Mirrors the real hook: a disabled query never ran, so it has no data,
		// is not loading and cannot have errored.
		if (
			!hoisted.orgStateIgnoresEnabled &&
			(options as { enabled?: boolean } | undefined)?.enabled === false
		) {
			return { organizations: [], isLoading: false, error: null };
		}
		return hoisted.orgState;
	},
}));

vi.mock("@/features/users/hooks", () => ({
	useCurrentUserRoles: () => ({
		roles: hoisted.roles,
		organizationId: undefined,
		isLoading: hoisted.rolesLoading,
	}),
}));

import { RestaurantAdminProvider, useRestaurant } from "./RestaurantAdminScope";

/**
 * This jsdom environment ships no `localStorage` (the provider's try/catch is
 * what keeps that from crashing the app), so persistence needs a stub to be
 * observable at all.
 */
const memoryStorage = (() => {
	const store = new Map<string, string>();
	return {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => void store.set(key, String(value)),
		removeItem: (key: string) => void store.delete(key),
		clear: () => store.clear(),
	};
})();
Object.defineProperty(globalThis.window, "localStorage", {
	configurable: true,
	value: memoryStorage,
});

const ORG_A = "organizations:a" as Id<"organizations">;
const ORG_B = "organizations:b" as Id<"organizations">;

function restaurant(
	id: string,
	organizationId: Id<"organizations">,
	updatedAt: number
): Doc<"restaurants"> {
	return {
		_id: id as Id<"restaurants">,
		_creationTime: updatedAt,
		updatedAt,
		organizationId,
		ownerId: "u1",
		name: id,
		slug: id,
		currency: "MXN",
		isActive: true,
		createdAt: 0,
	} as Doc<"restaurants">;
}

/** Newest `updatedAt` wins the default pick, so these are deliberately ordered. */
const A1 = restaurant("a1", ORG_A, 10);
const A2 = restaurant("a2", ORG_A, 20);
const B1 = restaurant("b1", ORG_B, 30);
/** Stands in for a just-created restaurant Convex has not pushed to us yet. */
const FRESH = restaurant("fresh", ORG_B, 40);

function Probe() {
	const {
		restaurant: active,
		restaurants,
		allRestaurants,
		selectedOrganizationId,
		setSelectedOrganizationId,
		setSelectedRestaurantId,
		isMultiRestaurant,
	} = useRestaurant();

	hoisted.renderLog.push({
		orgFilter: selectedOrganizationId ?? null,
		restaurantOrg: active ? String(active.organizationId) : null,
	});

	return (
		<div>
			<span data-testid="active">{active?._id ?? "none"}</span>
			<span data-testid="scoped">{restaurants.map((r) => r._id).join(",")}</span>
			<span data-testid="all">{allRestaurants.map((r) => r._id).join(",")}</span>
			<span data-testid="org">{selectedOrganizationId ?? "all"}</span>
			<span data-testid="multi">{String(isMultiRestaurant)}</span>
			<button onClick={() => setSelectedOrganizationId(ORG_A)}>pick-a</button>
			<button onClick={() => setSelectedOrganizationId(ORG_B)}>pick-b</button>
			<button onClick={() => setSelectedOrganizationId(null)}>pick-all</button>
			<button onClick={() => setSelectedRestaurantId(B1._id)}>select-b1</button>
			<button
				onClick={() => setSelectedRestaurantId(FRESH._id, { organizationId: FRESH.organizationId })}
			>
				select-fresh
			</button>
		</div>
	);
}

function renderScope() {
	return render(
		<RestaurantAdminProvider>
			<Probe />
		</RestaurantAdminProvider>
	);
}

const text = (id: string) => screen.getByTestId(id).textContent;

describe("RestaurantAdminProvider organization scope", () => {
	beforeEach(() => {
		globalThis.window.localStorage.clear();
		hoisted.restaurants = [A1, A2, B1];
		hoisted.restaurantsLoading = false;
		hoisted.isAuthenticated = true;
		hoisted.roles = ["admin"];
		hoisted.rolesLoading = false;
		hoisted.orgHookCalls = [];
		hoisted.orgStateIgnoresEnabled = false;
		hoisted.orgState = {
			organizations: [
				{ _id: ORG_A, name: "Alpha" },
				{ _id: ORG_B, name: "Beta" },
			],
			isLoading: false,
			error: null,
		};
		hoisted.renderLog = [];
	});

	it("defaults to All organizations and exposes every restaurant (no regression)", () => {
		renderScope();

		expect(text("org")).toBe("all");
		expect(text("scoped")).toBe("a1,a2,b1");
		expect(text("all")).toBe("a1,a2,b1");
		expect(text("multi")).toBe("true");
		// Newest updatedAt across the whole directory, exactly as before the switcher.
		expect(text("active")).toBe("b1");
		expect(
			globalThis.window.localStorage.getItem(LOCAL_STORAGE_KEY_ADMIN_SELECTED_ORGANIZATION_ID)
		).toBeNull();
	});

	it("narrows the restaurant list to the selected organization and persists it", () => {
		renderScope();

		fireEvent.click(screen.getByText("pick-a"));

		expect(text("org")).toBe(ORG_A);
		expect(text("scoped")).toBe("a1,a2");
		// The raw scope stays available for directory-wide surfaces.
		expect(text("all")).toBe("a1,a2,b1");
		expect(
			globalThis.window.localStorage.getItem(LOCAL_STORAGE_KEY_ADMIN_SELECTED_ORGANIZATION_ID)
		).toBe(ORG_A);
	});

	it("re-resolves the active restaurant into the organization just selected", () => {
		renderScope();
		expect(text("active")).toBe("b1");

		fireEvent.click(screen.getByText("pick-a"));

		expect(text("active")).toBe("a2");
		expect(
			globalThis.window.localStorage.getItem(LOCAL_STORAGE_KEY_ADMIN_SELECTED_RESTAURANT_ID)
		).toBe("a2");
		// Not one frame with the filter on and a restaurant from another org.
		const outside = hoisted.renderLog.filter(
			(entry) =>
				entry.orgFilter !== null &&
				entry.restaurantOrg !== null &&
				entry.restaurantOrg !== entry.orgFilter
		);
		expect(outside).toEqual([]);
	});

	it("restores the remembered restaurant when an organization has none", () => {
		hoisted.restaurants = [A1, A2];
		renderScope();
		expect(text("active")).toBe("a2");

		fireEvent.click(screen.getByText("pick-b"));
		expect(text("scoped")).toBe("");
		expect(text("active")).toBe("none");
		expect(text("multi")).toBe("false");

		fireEvent.click(screen.getByText("pick-all"));
		expect(text("active")).toBe("a2");
	});

	it("keeps a stored organization that is still in the directory", () => {
		globalThis.window.localStorage.setItem(LOCAL_STORAGE_KEY_ADMIN_SELECTED_ORGANIZATION_ID, ORG_A);

		renderScope();

		expect(text("org")).toBe(ORG_A);
		expect(text("scoped")).toBe("a1,a2");
	});

	it("falls back to All and clears storage when the stored organization is gone", () => {
		globalThis.window.localStorage.setItem(
			LOCAL_STORAGE_KEY_ADMIN_SELECTED_ORGANIZATION_ID,
			"organizations:deleted"
		);

		renderScope();

		expect(text("org")).toBe("all");
		expect(text("scoped")).toBe("a1,a2,b1");
		expect(
			globalThis.window.localStorage.getItem(LOCAL_STORAGE_KEY_ADMIN_SELECTED_ORGANIZATION_ID)
		).toBeNull();
	});

	it("keeps the stored organization while the directory is temporarily unavailable", () => {
		globalThis.window.localStorage.setItem(LOCAL_STORAGE_KEY_ADMIN_SELECTED_ORGANIZATION_ID, ORG_A);
		// Loading and a transient failure both mean "we do not know yet", and
		// neither may be read as "that organization no longer exists". The
		// switcher surfaces the failure and can still clear the filter.
		hoisted.orgState = { organizations: [], isLoading: true, error: null };
		const { unmount } = renderScope();
		expect(text("org")).toBe(ORG_A);
		unmount();

		hoisted.orgState = { organizations: [], isLoading: false, error: new Error("boom") };
		renderScope();

		expect(text("org")).toBe(ORG_A);
		expect(
			globalThis.window.localStorage.getItem(LOCAL_STORAGE_KEY_ADMIN_SELECTED_ORGANIZATION_ID)
		).toBe(ORG_A);
	});

	it("drops a stored organization for a viewer who is no longer an admin", () => {
		// The demotion case: they kept the localStorage entry but lost both the
		// directory and the switcher, so nothing may stay narrowed — there would
		// be no control left to widen it with.
		globalThis.window.localStorage.setItem(LOCAL_STORAGE_KEY_ADMIN_SELECTED_ORGANIZATION_ID, ORG_A);
		hoisted.roles = ["manager"];

		renderScope();

		expect(text("org")).toBe("all");
		expect(text("scoped")).toBe("a1,a2,b1");
		expect(
			globalThis.window.localStorage.getItem(LOCAL_STORAGE_KEY_ADMIN_SELECTED_ORGANIZATION_ID)
		).toBeNull();
		// Never even asks for a directory it is not entitled to.
		expect(hoisted.orgHookCalls).not.toEqual([]);
		expect(hoisted.orgHookCalls.every((args: any) => args?.enabled === false)).toBe(true);
	});

	it("drops it even if the directory query reports NOT_AUTHORIZED", () => {
		// "Keep the filter on error" is for transient failures only. An
		// authorization failure is not transient — treating it as "we do not know
		// yet" is what would strand a demoted admin in a phantom organization.
		globalThis.window.localStorage.setItem(LOCAL_STORAGE_KEY_ADMIN_SELECTED_ORGANIZATION_ID, ORG_A);
		hoisted.roles = ["manager"];
		hoisted.orgStateIgnoresEnabled = true;
		hoisted.orgState = {
			organizations: [],
			isLoading: false,
			error: Object.assign(new Error("NOT_AUTHORIZED"), { name: "NOT_AUTHORIZED" }),
		};

		renderScope();

		expect(text("org")).toBe("all");
		expect(text("scoped")).toBe("a1,a2,b1");
		expect(
			globalThis.window.localStorage.getItem(LOCAL_STORAGE_KEY_ADMIN_SELECTED_ORGANIZATION_ID)
		).toBeNull();
	});

	it("subscribes to the directory only for an admin", () => {
		renderScope();

		expect(hoisted.orgHookCalls.every((args: any) => args?.enabled === true)).toBe(true);
	});

	it("widens the organization when a restaurant outside the filter is selected", () => {
		renderScope();
		fireEvent.click(screen.getByText("pick-a"));
		expect(text("org")).toBe(ORG_A);

		fireEvent.click(screen.getByText("select-b1"));

		expect(text("org")).toBe(ORG_B);
		expect(text("active")).toBe("b1");
		expect(text("scoped")).toBe("b1");
	});

	it("holds a just-created restaurant that has not reached the query yet", () => {
		const { rerender } = renderScope();
		fireEvent.click(screen.getByText("pick-a"));
		expect(text("org")).toBe(ORG_A);

		// Exactly the create-restaurant flow: the id is handed over the moment the
		// mutation resolves, so it is NOT in the restaurant list yet and its
		// organization can only come from the caller.
		fireEvent.click(screen.getByText("select-fresh"));

		expect(text("org")).toBe(ORG_B);
		// Reconciliation must not have bounced the selection to org B's default.
		expect(text("scoped")).toBe("b1");

		hoisted.restaurants = [A1, A2, B1, FRESH];
		rerender(
			<RestaurantAdminProvider>
				<Probe />
			</RestaurantAdminProvider>
		);

		expect(text("active")).toBe("fresh");
		expect(text("scoped")).toBe("b1,fresh");
		expect(
			globalThis.window.localStorage.getItem(LOCAL_STORAGE_KEY_ADMIN_SELECTED_RESTAURANT_ID)
		).toBe("fresh");
	});
});
