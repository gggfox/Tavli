/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
/**
 * Who gets the onboarding affordances on the admin Users tab.
 *
 * The load-bearing case is the negative one. `/admin/*` only guards for STAFF
 * (`src/routes/admin.tsx`), so a manager who types the URL reaches this page
 * even though the sidebar never offered it. The invitation endpoints are
 * platform-admin only server-side, which is the real gate — these buttons must
 * simply not be there for anyone who would only get a rejection out of them.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
	roles: ["admin"] as string[],
	rolesLoading: false,
}));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-query")>()),
	useQuery: () => ({
		data: [],
		isLoading: false,
		error: null,
		isError: false,
		refetch: vi.fn(),
	}),
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (ref: any, args: unknown) => ({ queryKey: [getFunctionName(ref), args] }),
	useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
}));

vi.mock("convex/react", async (importOriginal) => ({
	...(await importOriginal<typeof import("convex/react")>()),
	useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
}));

vi.mock("@clerk/tanstack-react-start", () => ({
	useAuth: () => ({ userId: "user_admin", getToken: async () => null }),
	useUser: () => ({ user: { id: "user_admin" }, isLoaded: true }),
}));

vi.mock("../../hooks/useCurrentUserRoles", () => ({
	useCurrentUserRoles: () => ({
		roles: hoisted.roles,
		organizationId: undefined,
		isLoading: hoisted.rolesLoading,
		isAuthenticated: true,
	}),
}));

vi.mock("../invites", () => ({
	InviteUserDialog: ({ isOpen }: any) => (isOpen ? <div data-testid="single-dialog" /> : null),
	BulkInviteDialog: ({ isOpen }: any) => (isOpen ? <div data-testid="bulk-dialog" /> : null),
}));

import { UsersTable } from "./UsersTable";

describe("UsersTable onboarding actions", () => {
	beforeEach(() => {
		hoisted.roles = ["admin"];
		hoisted.rolesLoading = false;
	});

	it("offers both onboarding actions to a platform admin", () => {
		render(<UsersTable />);

		expect(screen.getByRole("button", { name: /Invite user/ })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /Bulk invite/ })).toBeInTheDocument();
	});

	it("hides both actions from a non-admin who reached the page anyway", () => {
		hoisted.roles = ["owner", "manager"];

		render(<UsersTable />);

		expect(screen.queryByRole("button", { name: /Invite user/ })).toBeNull();
		expect(screen.queryByRole("button", { name: /Bulk invite/ })).toBeNull();
	});

	it("shows nothing while the viewer's roles are still unknown", () => {
		hoisted.rolesLoading = true;
		hoisted.roles = ["admin"];

		render(<UsersTable />);

		expect(screen.queryByRole("button", { name: /Invite user/ })).toBeNull();
		expect(screen.queryByRole("button", { name: /Bulk invite/ })).toBeNull();
	});

	it("mounts no dialog until its action is used", () => {
		render(<UsersTable />);

		expect(screen.queryByTestId("single-dialog")).toBeNull();
		expect(screen.queryByTestId("bulk-dialog")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: /Invite user/ }));
		expect(screen.getByTestId("single-dialog")).toBeInTheDocument();
		expect(screen.queryByTestId("bulk-dialog")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: /Bulk invite/ }));
		expect(screen.getByTestId("bulk-dialog")).toBeInTheDocument();
	});
});
