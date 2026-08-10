/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
/**
 * The create-restaurant form.
 *
 * Two behaviours are pinned here. First (TAVLI-71 item 8): the organization
 * picker must never be an empty, required, silent `<select>` — the query used
 * to be admin-only, so an owner got a blank control with no spinner, no message
 * and no disabled state. Second: an operator is no longer asked to invent a
 * slug (it is derived from the name server-side), and is not asked to pick an
 * organization when only one is available to them.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
	roles: ["owner"] as string[],
	orgState: {
		organizations: [] as any[],
		isLoading: false,
		error: null as unknown,
	},
	createMock: vi.fn(async (_args: unknown) => ["restaurants:1", null]),
	setSelectedRestaurantId: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
	useMutation: () => ({ mutateAsync: hoisted.createMock, isPending: false }),
	useQuery: ({ queryKey }: any) => {
		const name = queryKey?.[0];
		if (name === "restaurants:getAll") return { data: [], isLoading: false };
		return { data: [], isLoading: false };
	},
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (ref: any, args: unknown) => ({ queryKey: [getFunctionName(ref), args] }),
	useConvexMutation: () => hoisted.createMock,
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
	useRestaurant: () => ({ setSelectedRestaurantId: hoisted.setSelectedRestaurantId }),
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
	return { submit: screen.getByRole("button", { name: "Create" }) as HTMLButtonElement };
}

/** The states that still render the `<select>`: loading, failed, empty, 2+. */
function openWithPicker() {
	const { submit } = openCreateModal();
	return { select: screen.getByLabelText("Organization") as HTMLSelectElement, submit };
}

describe("CreateRestaurantForm organization picker", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		hoisted.createMock.mockResolvedValue(["restaurants:1", null] as any);
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

		const { select, submit } = openWithPicker();

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

		const { select, submit } = openWithPicker();

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

		const { select, submit } = openWithPicker();

		expect(select.disabled).toBe(true);
		expect(submit.disabled).toBe(true);
		expect(
			screen.getByText(
				"No organizations are available to you. Ask an administrator to add you to one before creating a restaurant."
			)
		).toBeInTheDocument();
	});

	it("does not ask an owner with a single organization to pick one", async () => {
		hoisted.roles = ["owner"];
		hoisted.orgState = {
			organizations: [{ _id: "organizations:1", name: "Grupo Tavli" }],
			isLoading: false,
			error: null,
		};

		const { submit } = openCreateModal();

		// No control to operate — just a read-only statement of where it lands.
		expect(screen.queryByLabelText("Organization")).toBeNull();
		expect(screen.getByTestId("admin-rest-org-single").textContent).toContain("Grupo Tavli");
		expect(
			screen.getByText("Your only organization — the restaurant will be created here.")
		).toBeInTheDocument();
		expect(submit.disabled).toBe(false);

		fireEvent.change(screen.getByLabelText("Restaurant Name"), { target: { value: "La Cocina" } });
		fireEvent.click(submit);

		await waitFor(() => {
			expect(hoisted.createMock).toHaveBeenCalledWith(
				expect.objectContaining({ name: "La Cocina", organizationId: "organizations:1" })
			);
		});
	});

	it("keeps the picker for someone who belongs to more than one organization", () => {
		hoisted.roles = ["admin"];
		hoisted.orgState = {
			organizations: [
				{ _id: "organizations:1", name: "Grupo Tavli" },
				{ _id: "organizations:2", name: "Otra Org" },
			],
			isLoading: false,
			error: null,
		};

		const { select, submit } = openWithPicker();

		expect(select.disabled).toBe(false);
		expect(screen.getByRole("option", { name: "Grupo Tavli" })).toBeInTheDocument();
		expect(screen.getByRole("option", { name: "Otra Org" })).toBeInTheDocument();
		// Nothing picked yet: the restaurant has nowhere to land.
		expect(submit.disabled).toBe(true);

		fireEvent.change(select, { target: { value: "organizations:2" } });

		expect(select.value).toBe("organizations:2");
		expect((screen.getByRole("button", { name: "Create" }) as HTMLButtonElement).disabled).toBe(
			false
		);
	});
});

describe("CreateRestaurantForm slug", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		hoisted.createMock.mockResolvedValue(["restaurants:1", null] as any);
		HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
			this.setAttribute("open", "");
		});
		HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
			this.removeAttribute("open");
		});
		hoisted.roles = ["owner"];
		hoisted.orgState = {
			organizations: [{ _id: "organizations:1", name: "Grupo Tavli" }],
			isLoading: false,
			error: null,
		};
	});

	it("never asks for a slug", () => {
		openCreateModal();

		expect(screen.queryByLabelText("Slug (URL identifier)")).toBeNull();
	});

	it("submits without a slug so the server derives it from the name", async () => {
		const { submit } = openCreateModal();

		fireEvent.change(screen.getByLabelText("Restaurant Name"), { target: { value: "Café Ñoño" } });
		fireEvent.click(submit);

		await waitFor(() => {
			expect(hoisted.createMock).toHaveBeenCalledTimes(1);
		});
		expect(hoisted.createMock.mock.calls[0][0]).not.toHaveProperty("slug");
	});
});
