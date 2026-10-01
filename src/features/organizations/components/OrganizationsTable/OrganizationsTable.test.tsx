/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
/**
 * The platform-admin Organizations page in Spanish.
 *
 * The page used to be English whatever the app's language, dates included
 * ("Mar 28, 2026"). Pinned here: the page's own headers, status pill, actions
 * and search box follow the language, and dates are formatted for es-MX.
 */
import { i18n } from "@/global/i18n";
import { cleanup, render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 28 March 2026, midday UTC — the same calendar day in every CI timezone.
const CREATED_AT = Date.UTC(2026, 2, 28, 12, 0);

vi.mock("@tanstack/react-query", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-query")>()),
	useQuery: () => ({
		data: [
			{
				_id: "organizations:1",
				_creationTime: CREATED_AT,
				name: "Fierro Viejo",
				isActive: true,
				createdAt: CREATED_AT,
				updatedAt: CREATED_AT,
			},
		],
		isLoading: false,
		error: null,
		isError: false,
		refetch: vi.fn(),
	}),
	useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (ref: any, args: unknown) => ({ queryKey: [getFunctionName(ref), args] }),
	useConvexMutation: () => vi.fn(),
}));

vi.mock("convex/react", async (importOriginal) => ({
	...(await importOriginal<typeof import("convex/react")>()),
	useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
}));

vi.mock("@/features/users/hooks", () => ({
	useCurrentUserRoles: () => ({
		roles: ["admin"],
		organizationId: undefined,
		isLoading: false,
		isAuthenticated: true,
	}),
}));

import { OrganizationsTable } from "./OrganizationsTable";

describe("OrganizationsTable in Spanish", () => {
	beforeEach(async () => {
		await i18n.changeLanguage("es");
	});

	afterEach(async () => {
		// Unmount first: switching language re-renders anything still mounted.
		cleanup();
		await i18n.changeLanguage("en");
	});

	it("labels the table, its rows and its actions in Spanish", () => {
		render(<OrganizationsTable />);

		for (const header of ["Nombre", "Descripción", "Estado", "Creada", "Actualizada"]) {
			expect(screen.getByText(header)).toBeInTheDocument();
		}
		expect(screen.getByText("Activa")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /Nueva organización/ })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Editar" })).toBeInTheDocument();
		expect(screen.getByPlaceholderText("Buscar organizaciones...")).toBeInTheDocument();
		expect(screen.getByText("1 organización")).toBeInTheDocument();
	});

	it("formats dates for es-MX, not with English month names", () => {
		render(<OrganizationsTable />);

		const expected = new Intl.DateTimeFormat("es-MX", {
			year: "numeric",
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		}).format(new Date(CREATED_AT));
		expect(screen.getAllByText(expected)).toHaveLength(2);
		expect(screen.queryByText(/Mar 28, 2026/)).not.toBeInTheDocument();
	});
});
