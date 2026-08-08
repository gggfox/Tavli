/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
/**
 * TAVLI-71 item 8 -- the create-restaurant organization picker.
 *
 * The reported bug was an owner opening this modal and finding an empty,
 * required organization `<select>` with no spinner, no message and no disabled
 * state, because `getAllOrganizations` was admin-only and the hook swallowed
 * the NotAuthorized. These tests pin the three states the field must always
 * distinguish (loading / failed / empty) plus the owner regression.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
	roles: ["owner"] as string[],
	orgState: {
		organizations: [] as any[],
		isLoading: false,
		error: null as unknown,
	},
}));

vi.mock("@tanstack/react-query", () => ({
	useMutation: () => ({ mutateAsync: vi.fn(async () => [null, null]), isPending: false }),
	useQuery: ({ queryKey }: any) => {
		const name = queryKey?.[0];
		if (name === "restaurants:getAll") return { data: [], isLoading: false };
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
		roles: hoisted.roles,
		organizationId: "organizations:1",
		isLoading: false,
	}),
}));

vi.mock("@/features/restaurants/RestaurantAdminScope", () => ({
	useRestaurant: () => ({ setSelectedRestaurantId: vi.fn() }),
}));

vi.mock("@/features/restaurants/hooks/useOrganizations", () => ({
	useOrganizations: () => hoisted.orgState,
}));

vi.mock("@/features/restaurants/components/TablesManager", () => ({
	TablesManager: () => <div data-testid="tables-manager" />,
}));

vi.mock("@/features/restaurants/components/RestaurantSettingsView", () => ({
	RestaurantSettingsView: () => <div data-testid="settings-canvas" />,
}));

import { AdminRestaurantsList } from "./AdminRestaurantsList";

function openCreateModal() {
	render(
		<AdminRestaurantsList
			manageId={null}
			settingsId={null}
			onSettingsChange={vi.fn()}
			onManageChange={vi.fn()}
		/>
	);
	fireEvent.click(screen.getByText("New Restaurant"));
	return {
		select: screen.getByLabelText("Organization") as HTMLSelectElement,
		submit: screen.getByRole("button", { name: "Create" }) as HTMLButtonElement,
	};
}

describe("CreateRestaurantForm organization picker", () => {
	beforeEach(() => {
		HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
			this.setAttribute("open", "");
		});
		HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
			this.removeAttribute("open");
		});
		hoisted.roles = ["owner"];
		hoisted.orgState = { organizations: [], isLoading: false, error: null };
	});

	it("shows a loading state and blocks submit while the organizations load", () => {
		hoisted.orgState = { organizations: [], isLoading: true, error: null };

		const { select, submit } = openCreateModal();

		expect(select.disabled).toBe(true);
		expect(select).toHaveAttribute("aria-busy", "true");
		expect(submit.disabled).toBe(true);
		expect(screen.getAllByText("Loading organizations…").length).toBeGreaterThan(0);
	});

	it("shows the mapped backend error instead of a blank control when the query fails", () => {
		hoisted.orgState = {
			organizations: [],
			isLoading: false,
			error: Object.assign(new Error("ERROR_OWNER_ROLE_REQUIRED"), {
				name: "NOT_AUTHORIZED",
			}),
		};

		const { select, submit } = openCreateModal();

		expect(select.disabled).toBe(true);
		expect(submit.disabled).toBe(true);
		// Mapped from the stable code, not the raw backend message.
		expect(screen.getByText("You need owner permissions to do that.")).toBeInTheDocument();
	});

	it("falls back to generic copy for an unrecognized failure", () => {
		hoisted.orgState = { organizations: [], isLoading: false, error: new Error("boom") };

		openCreateModal();

		expect(
			screen.getByText("Could not load organizations, so a restaurant cannot be created right now.")
		).toBeInTheDocument();
		expect(screen.queryByText("boom")).toBeNull();
	});

	it("explains an empty directory rather than leaving a silently empty required field", () => {
		hoisted.orgState = { organizations: [], isLoading: false, error: null };

		const { select, submit } = openCreateModal();

		expect(select.disabled).toBe(true);
		expect(submit.disabled).toBe(true);
		expect(
			screen.getByText(
				"No organizations are available to you. Ask an administrator to add you to one before creating a restaurant."
			)
		).toBeInTheDocument();
	});

	it("lists the organization of an owner who is not an admin", () => {
		hoisted.roles = ["owner"];
		hoisted.orgState = {
			organizations: [{ _id: "organizations:1", name: "Grupo Tavli" }],
			isLoading: false,
			error: null,
		};

		const { select, submit } = openCreateModal();

		expect(select.disabled).toBe(false);
		expect(submit.disabled).toBe(false);
		expect(screen.getByRole("option", { name: "Grupo Tavli" })).toBeInTheDocument();

		fireEvent.change(select, { target: { value: "organizations:1" } });
		expect(select.value).toBe("organizations:1");
	});
});
