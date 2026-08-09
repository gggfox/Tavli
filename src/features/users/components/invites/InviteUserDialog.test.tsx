/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
/**
 * The single-invite form.
 *
 * Three behaviours are pinned here, each of which corresponds to a way this
 * form could quietly damage a real person's account:
 *
 *   - **A restaurant from the previous organization must never be submittable.**
 *     Changing the organization clears the selection outright.
 *   - **Cross-organization moves are opt-in.** The backend refuses the first
 *     attempt; Send stays disabled until the admin ticks the acknowledgement,
 *     and the retry carries `acknowledgeOrgMove`.
 *   - **The directory never fails silently.** A slow or broken organization
 *     query says so instead of rendering an empty `<select>` (the bug class
 *     `AdminRestaurantsCreateForm.test.tsx` already guards for elsewhere).
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Id } from "convex/_generated/dataModel";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG_A = "organizations:a" as Id<"organizations">;
const ORG_B = "organizations:b" as Id<"organizations">;
const REST_A1 = "restaurants:a1" as Id<"restaurants">;
const REST_B1 = "restaurants:b1" as Id<"restaurants">;

const hoisted = vi.hoisted(() => ({
	orgState: {
		organizations: [] as any[],
		isLoading: false,
		error: null as unknown,
	},
	restaurants: [] as any[],
	restaurantsLoading: false,
	restaurantsError: null as unknown,
	sendMock: vi.fn(async (_args: unknown) => [
		{ invitationId: "invitations:1", status: "ok", replacedPendingCount: 0 },
		null,
	]),
}));

vi.mock("@tanstack/react-query", () => ({
	useQuery: ({ queryKey }: any) => {
		if (queryKey?.[0] === "restaurants:getAll") {
			return {
				data: hoisted.restaurants,
				isLoading: hoisted.restaurantsLoading,
				error: hoisted.restaurantsError,
			};
		}
		return { data: undefined, isLoading: false, error: null };
	},
	useMutation: () => ({ mutateAsync: hoisted.sendMock, isPending: false }),
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (ref: any, args: unknown) => ({ queryKey: [getFunctionName(ref), args] }),
	useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
	useConvexMutation: () => hoisted.sendMock,
}));

vi.mock("@/features/restaurants/hooks/useOrganizations", () => ({
	useOrganizations: () => hoisted.orgState,
}));

import { InviteUserDialog } from "./InviteUserDialog";

const TWO_ORGS = [
	{ _id: ORG_B, name: "Mercado" },
	{ _id: ORG_A, name: "Alpha Group" },
];

const RESTAURANTS = [
	{ _id: REST_A1, name: "Alpha Diner", organizationId: ORG_A },
	{ _id: REST_B1, name: "Mercado Cantina", organizationId: ORG_B },
];

function openDialog() {
	return render(<InviteUserDialog isOpen onClose={vi.fn()} />);
}

const sendButton = () => screen.getByRole("button", { name: "Send invitation" });
const orgSelect = () => screen.getByLabelText("Organization") as HTMLSelectElement;
const roleSelect = () => screen.getByLabelText("Role") as HTMLSelectElement;

function pickRestaurant(name: string) {
	fireEvent.click(screen.getByLabelText("Restaurants for this invitation"));
	fireEvent.click(screen.getByRole("option", { name }));
}

beforeEach(() => {
	HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
		this.setAttribute("open", "");
	});
	HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
		this.removeAttribute("open");
	});

	hoisted.orgState = { organizations: TWO_ORGS, isLoading: false, error: null };
	hoisted.restaurants = RESTAURANTS;
	hoisted.restaurantsLoading = false;
	hoisted.restaurantsError = null;
	hoisted.sendMock = vi.fn(async (_args: unknown) => [
		{ invitationId: "invitations:1", status: "ok", replacedPendingCount: 0 },
		null,
	]);
});

describe("InviteUserDialog — roles and restaurants", () => {
	it("lists organizations by name and hides restaurants for an owner invite", () => {
		openDialog();

		expect([...orgSelect().options].map((option) => option.textContent)).toEqual([
			"Choose an organization",
			"Alpha Group",
			"Mercado",
		]);
		// Owner is the default role and an owner invitation is organization-wide.
		expect(roleSelect().value).toBe("owner");
		expect(screen.queryByLabelText("Restaurants for this invitation")).toBeNull();
	});

	it("will not send a manager invite until a restaurant is chosen", () => {
		openDialog();

		fireEvent.change(screen.getByLabelText("Email"), {
			target: { value: "nuevo@example.com" },
		});
		fireEvent.change(roleSelect(), { target: { value: "manager" } });
		fireEvent.change(orgSelect(), { target: { value: ORG_A } });

		expect(screen.getByLabelText("Restaurants for this invitation")).toBeInTheDocument();
		expect(sendButton()).toBeDisabled();

		pickRestaurant("Alpha Diner");
		expect(sendButton()).toBeEnabled();
	});

	it("only offers restaurants belonging to the chosen organization", () => {
		openDialog();

		fireEvent.change(roleSelect(), { target: { value: "employee" } });
		fireEvent.change(orgSelect(), { target: { value: ORG_A } });
		fireEvent.click(screen.getByLabelText("Restaurants for this invitation"));

		expect(screen.getByRole("option", { name: "Alpha Diner" })).toBeInTheDocument();
		expect(screen.queryByRole("option", { name: "Mercado Cantina" })).toBeNull();
	});

	it("clears the restaurant selection when the organization changes", () => {
		openDialog();

		fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@example.com" } });
		fireEvent.change(roleSelect(), { target: { value: "manager" } });
		fireEvent.change(orgSelect(), { target: { value: ORG_A } });
		pickRestaurant("Alpha Diner");
		expect(screen.getByText("1 restaurant selected")).toBeInTheDocument();

		fireEvent.change(orgSelect(), { target: { value: ORG_B } });

		// The stale restaurant is gone from the summary and Send is blocked again,
		// so Alpha Diner can never travel with a Mercado invitation.
		expect(screen.queryByText("1 restaurant selected")).toBeNull();
		expect(sendButton()).toBeDisabled();
	});
});

describe("InviteUserDialog — cross-organization moves", () => {
	it("gates Send behind an acknowledgement and then sends it", async () => {
		hoisted.sendMock = vi
			.fn()
			.mockResolvedValueOnce([
				null,
				{
					name: "VALIDATION_ERROR",
					message: "email: ERROR_INVITE_CROSS_ORG",
					fields: [{ field: "email", message: "ERROR_INVITE_CROSS_ORG" }],
				},
			])
			.mockResolvedValueOnce([
				{ invitationId: "invitations:1", status: "cross_org", replacedPendingCount: 0 },
				null,
			]);

		openDialog();
		fireEvent.change(screen.getByLabelText("Email"), { target: { value: "moved@example.com" } });
		fireEvent.change(orgSelect(), { target: { value: ORG_A } });
		fireEvent.click(sendButton());

		await waitFor(() =>
			expect(screen.getByText("This person belongs to another organization")).toBeInTheDocument()
		);
		// Refused, and refused loudly: nothing was created and Send is now locked.
		expect(hoisted.sendMock).toHaveBeenCalledTimes(1);
		expect(hoisted.sendMock.mock.calls[0][0]).toMatchObject({ acknowledgeOrgMove: false });
		expect(sendButton()).toBeDisabled();

		fireEvent.click(
			screen.getByLabelText("I understand — move this person to the new organization")
		);
		expect(sendButton()).toBeEnabled();

		fireEvent.click(sendButton());
		await waitFor(() => expect(screen.getByText("Invitation sent")).toBeInTheDocument());
		expect(hoisted.sendMock.mock.calls[1][0]).toMatchObject({ acknowledgeOrgMove: true });
	});

	it("drops the acknowledgement when the email is edited afterwards", async () => {
		hoisted.sendMock = vi.fn().mockResolvedValue([
			null,
			{
				name: "VALIDATION_ERROR",
				message: "email: ERROR_INVITE_CROSS_ORG",
				fields: [{ field: "email", message: "ERROR_INVITE_CROSS_ORG" }],
			},
		]);

		openDialog();
		fireEvent.change(screen.getByLabelText("Email"), { target: { value: "moved@example.com" } });
		fireEvent.change(orgSelect(), { target: { value: ORG_A } });
		fireEvent.click(sendButton());

		await waitFor(() =>
			expect(screen.getByText("This person belongs to another organization")).toBeInTheDocument()
		);
		fireEvent.click(
			screen.getByLabelText("I understand — move this person to the new organization")
		);

		// A verdict is about one address. Typing a different one must not inherit
		// permission to move whoever the previous address belonged to.
		fireEvent.change(screen.getByLabelText("Email"), { target: { value: "other@example.com" } });

		expect(screen.queryByText("This person belongs to another organization")).toBeNull();
		expect(sendButton()).toBeEnabled();
	});

	it("offers to replace an invitation that is already pending", async () => {
		hoisted.sendMock = vi
			.fn()
			.mockResolvedValueOnce([
				null,
				{
					name: "VALIDATION_ERROR",
					message: "email: ERROR_INVITE_DUPLICATE_PENDING",
					fields: [{ field: "email", message: "ERROR_INVITE_DUPLICATE_PENDING" }],
				},
			])
			.mockResolvedValueOnce([
				{ invitationId: "invitations:2", status: "duplicate_pending", replacedPendingCount: 1 },
				null,
			]);

		openDialog();
		fireEvent.change(screen.getByLabelText("Email"), { target: { value: "again@example.com" } });
		fireEvent.change(orgSelect(), { target: { value: ORG_A } });
		fireEvent.click(sendButton());

		await waitFor(() =>
			expect(screen.getByText("They already have an invitation waiting")).toBeInTheDocument()
		);
		fireEvent.click(screen.getByLabelText("Cancel the old invitation and send a new one"));
		fireEvent.click(sendButton());

		await waitFor(() => expect(screen.getByText("Invitation sent")).toBeInTheDocument());
		expect(hoisted.sendMock.mock.calls[1][0]).toMatchObject({ replaceExistingPending: true });
		expect(
			screen.getByText(
				"The invitation that was already waiting for them was cancelled and replaced."
			)
		).toBeInTheDocument();
	});
});

describe("InviteUserDialog — directory states", () => {
	it("says the organization directory is loading rather than showing an empty picker", () => {
		hoisted.orgState = { organizations: [], isLoading: true, error: null };

		openDialog();

		expect(screen.getByText("Loading organizations…")).toBeInTheDocument();
		expect(orgSelect()).toBeDisabled();
	});

	it("explains a failed organization directory, without the raw backend text", () => {
		hoisted.orgState = { organizations: [], isLoading: false, error: new Error("boom") };

		openDialog();

		expect(
			screen.getByText("Could not load the list of organizations. Reload the page and try again.")
		).toBeInTheDocument();
		expect(screen.queryByText("boom")).toBeNull();
	});

	it("says an organization simply has none rather than leaving the picker blank", () => {
		hoisted.orgState = { organizations: [], isLoading: false, error: null };

		openDialog();

		expect(
			screen.getByText("There are no organizations yet. Create one before inviting anybody.")
		).toBeInTheDocument();
	});

	it("explains a failed restaurant list for the chosen organization", () => {
		hoisted.restaurants = [];
		hoisted.restaurantsError = new Error("boom");

		openDialog();
		fireEvent.change(roleSelect(), { target: { value: "manager" } });
		fireEvent.change(orgSelect(), { target: { value: ORG_A } });

		expect(
			screen.getByText(
				"Could not load the restaurants for this organization. Reload the page and try again."
			)
		).toBeInTheDocument();
		expect(sendButton()).toBeDisabled();
	});

	it("says an organization with no restaurants cannot take a manager", () => {
		hoisted.restaurants = [{ _id: REST_B1, name: "Mercado Cantina", organizationId: ORG_B }];

		openDialog();
		fireEvent.change(roleSelect(), { target: { value: "manager" } });
		fireEvent.change(orgSelect(), { target: { value: ORG_A } });

		expect(
			screen.getByText(
				"This organization has no restaurants yet, so it can't take a manager or an employee."
			)
		).toBeInTheDocument();
	});
});

describe("InviteUserDialog — failures", () => {
	it("shows a localized message for a rate limit, never the code", async () => {
		hoisted.sendMock = vi
			.fn()
			.mockResolvedValue([
				null,
				{ name: "RATE_LIMITED", message: "ERROR_INVITE_EMAIL_RATE_LIMITED" },
			]);

		openDialog();
		fireEvent.change(screen.getByLabelText("Email"), { target: { value: "spam@example.com" } });
		fireEvent.change(orgSelect(), { target: { value: ORG_A } });
		fireEvent.click(sendButton());

		await waitFor(() =>
			expect(
				screen.getByText(
					"This address has already been invited several times today. Please try again tomorrow."
				)
			).toBeInTheDocument()
		);
		expect(screen.queryByText(/ERROR_INVITE/)).toBeNull();
	});
});
