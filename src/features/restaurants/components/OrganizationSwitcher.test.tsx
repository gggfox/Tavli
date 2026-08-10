/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
/**
 * The sidebar organization switcher: who sees it, in what order it lists
 * organizations, and what it does when the directory is slow or broken.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import type { Id } from "convex/_generated/dataModel";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
	roles: ["admin"] as string[],
	rolesLoading: false,
	setSelectedOrganizationId: vi.fn(),
	scope: {
		organizations: [] as any[],
		selectedOrganizationId: null as string | null,
		isOrganizationsLoading: false,
		organizationsError: null as unknown,
	},
}));

vi.mock("@/features/users/hooks", () => ({
	useCurrentUserRoles: () => ({
		roles: hoisted.roles,
		organizationId: undefined,
		isLoading: hoisted.rolesLoading,
	}),
}));

vi.mock("../RestaurantAdminScope", () => ({
	useRestaurant: () => ({
		...hoisted.scope,
		setSelectedOrganizationId: hoisted.setSelectedOrganizationId,
	}),
}));

import { OrganizationSwitcher } from "./OrganizationSwitcher";

const ORG_A = "organizations:a" as Id<"organizations">;
const ORG_B = "organizations:b" as Id<"organizations">;
const ORG_C = "organizations:c" as Id<"organizations">;

const THREE_ORGS = [
	{ _id: ORG_C, name: "Zocalo" },
	{ _id: ORG_A, name: "Alpha" },
	{ _id: ORG_B, name: "Mercado" },
];

describe("OrganizationSwitcher", () => {
	beforeEach(() => {
		hoisted.roles = ["admin"];
		hoisted.rolesLoading = false;
		hoisted.setSelectedOrganizationId = vi.fn();
		hoisted.scope = {
			organizations: THREE_ORGS,
			selectedOrganizationId: null,
			isOrganizationsLoading: false,
			organizationsError: null,
		};
	});

	it("renders All organizations first, then the rest sorted by name", () => {
		render(<OrganizationSwitcher />);

		const select = screen.getByLabelText("Organization") as HTMLSelectElement;
		expect([...select.options].map((o) => o.textContent)).toEqual([
			"All organizations",
			"Alpha",
			"Mercado",
			"Zocalo",
		]);
		// All is the default, and it is what the control shows.
		expect(select.value).toBe("");
	});

	it("reflects the organization already selected", () => {
		hoisted.scope.selectedOrganizationId = ORG_B;

		render(<OrganizationSwitcher />);

		expect((screen.getByLabelText("Organization") as HTMLSelectElement).value).toBe(ORG_B);
	});

	it("sets the organization when one is picked", () => {
		render(<OrganizationSwitcher />);

		fireEvent.change(screen.getByLabelText("Organization"), { target: { value: ORG_A } });

		expect(hoisted.setSelectedOrganizationId).toHaveBeenCalledWith(ORG_A);
	});

	it("sets null — All organizations — when the first option is picked", () => {
		hoisted.scope.selectedOrganizationId = ORG_A;

		render(<OrganizationSwitcher />);
		fireEvent.change(screen.getByLabelText("Organization"), { target: { value: "" } });

		expect(hoisted.setSelectedOrganizationId).toHaveBeenCalledWith(null);
	});

	it("is hidden for a non-admin", () => {
		hoisted.roles = ["owner", "manager"];

		const { container } = render(<OrganizationSwitcher />);

		expect(container).toBeEmptyDOMElement();
	});

	it("is hidden while the viewer's roles are still unknown", () => {
		hoisted.rolesLoading = true;

		const { container } = render(<OrganizationSwitcher />);

		expect(container).toBeEmptyDOMElement();
	});

	it("is hidden when there is nothing to switch between", () => {
		hoisted.scope.organizations = [{ _id: ORG_A, name: "Alpha" }];
		const single = render(<OrganizationSwitcher />);
		expect(single.container).toBeEmptyDOMElement();

		single.unmount();
		hoisted.scope.organizations = [];
		expect(render(<OrganizationSwitcher />).container).toBeEmptyDOMElement();
	});

	it("renders nothing rather than an empty control while the directory loads", () => {
		hoisted.scope = {
			organizations: [],
			selectedOrganizationId: null,
			isOrganizationsLoading: true,
			organizationsError: null,
		};

		const { container } = render(<OrganizationSwitcher />);

		expect(container).toBeEmptyDOMElement();
	});

	it("explains a failed directory instead of silently disappearing", () => {
		hoisted.scope = {
			organizations: [],
			selectedOrganizationId: null,
			isOrganizationsLoading: false,
			organizationsError: new Error("boom"),
		};

		render(<OrganizationSwitcher />);

		const select = screen.getByLabelText("Organization") as HTMLSelectElement;
		// Nothing to pick: no filter is active and there is no directory to
		// choose from — and the copy says exactly that.
		expect(select.disabled).toBe(true);
		expect([...select.options].map((o) => o.textContent)).toEqual(["All organizations"]);
		expect(
			screen.getByText("Could not load organizations. Showing every restaurant.")
		).toBeInTheDocument();
		// Never the raw backend text.
		expect(screen.queryByText("boom")).toBeNull();
	});

	it("keeps a filter that survived a failed directory clearable, and says it is still on", () => {
		// The provider deliberately does not re-widen the scope on error, so the
		// control must show the filter that IS in force and let the admin drop it.
		hoisted.scope = {
			organizations: [],
			selectedOrganizationId: ORG_A,
			isOrganizationsLoading: false,
			organizationsError: new Error("boom"),
		};

		render(<OrganizationSwitcher />);

		const select = screen.getByLabelText("Organization") as HTMLSelectElement;
		expect(select.disabled).toBe(false);
		expect(select.value).toBe(ORG_A);
		expect([...select.options].map((o) => o.textContent)).toEqual([
			"All organizations",
			"Selected organization",
		]);
		expect(
			screen.getByText(
				"Could not load organizations. Still showing only the one you selected — pick All organizations to clear it."
			)
		).toBeInTheDocument();
		expect(
			screen.queryByText("Could not load organizations. Showing every restaurant.")
		).toBeNull();

		fireEvent.change(select, { target: { value: "" } });
		expect(hoisted.setSelectedOrganizationId).toHaveBeenCalledWith(null);
	});
});
