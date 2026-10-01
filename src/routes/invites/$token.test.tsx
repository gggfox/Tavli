/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, boundaries/element-types, @typescript-eslint/no-explicit-any */
/**
 * The public invitation page, in the invitee's language.
 *
 * Pinned here: a live invitation says who is inviting (one restaurant, a few,
 * many, or a whole organization) and keeps its sign-in / accept flow; a dead
 * one (unknown, used, revoked or expired) offers no sign-in and no admin panel,
 * only what to do next and a way home.
 */
import { i18n } from "@/global/i18n";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
	preview: { data: undefined as any, isLoading: false },
	isSignedIn: false,
}));

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: (_path: string) => (options: any) => ({
		...options,
		useParams: () => ({ token: "token-1" }),
	}),
	Link: ({ children, to, ...rest }: any) => (
		<a href={String(to)} {...rest}>
			{children}
		</a>
	),
}));

vi.mock("@clerk/tanstack-react-start", () => ({
	SignInButton: ({ children }: any) => <>{children}</>,
	useAuth: () => ({ isSignedIn: hoisted.isSignedIn }),
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (ref: any, args: any) => ({ ref, args }),
	useConvexMutation: () => vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
	useQuery: () => hoisted.preview,
	useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("convex/_generated/api", () => ({
	api: {
		invites: {
			getByTokenPublic: { name: "invites:getByTokenPublic" },
			acceptInvitation: { name: "invites:acceptInvitation" },
		},
	},
}));

import { inviteHeadline, Route } from "./$token";

const InviteAcceptPage = (Route as any).component as () => React.JSX.Element;

function liveInvite(overrides: Record<string, unknown> = {}) {
	return {
		email: "j***@example.com",
		organizationId: "organizations:1",
		role: "employee",
		status: "pending",
		expiresAt: Date.now() + 60_000,
		organizationName: "Grupo Fierro",
		restaurantNames: ["Vernáculo"],
		...overrides,
	};
}

describe("invite page", () => {
	beforeEach(async () => {
		hoisted.preview = { data: liveInvite(), isLoading: false };
		hoisted.isSignedIn = false;
		await i18n.changeLanguage("es");
	});

	afterEach(async () => {
		cleanup();
		await i18n.changeLanguage("en");
	});

	it("names the one restaurant and keeps the sign-in flow on a live invite", () => {
		render(<InviteAcceptPage />);

		expect(screen.getByText("Te invitaron a unirte a Vernáculo.")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Iniciar sesión" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Ir al panel de administración" })).toHaveAttribute(
			"href",
			"/admin"
		);
	});

	it("shows the role alongside who is inviting once signed in", () => {
		hoisted.isSignedIn = true;
		render(<InviteAcceptPage />);

		expect(screen.getByText("Te invitaron a unirte a Vernáculo.")).toBeInTheDocument();
		expect(screen.getByText("Rol:")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Aceptar invitación" })).toBeEnabled();
	});

	it.each([
		["invalid or expired", undefined],
		["already used", null],
	])("on a dead link (%s) offers only the way home", (_label, data) => {
		hoisted.preview = { data, isLoading: false };
		render(<InviteAcceptPage />);

		expect(
			screen.getByText("Este enlace de invitación no es válido o ya expiró.")
		).toBeInTheDocument();
		expect(
			screen.getByText("Pide a quien te invitó que te envíe una nueva invitación.")
		).toBeInTheDocument();
		expect(screen.getAllByRole("link")).toHaveLength(1);
		expect(screen.getByRole("link", { name: "Ir a la página de inicio de Tavli" })).toHaveAttribute(
			"href",
			"/"
		);
		expect(screen.queryByRole("button")).not.toBeInTheDocument();
		expect(screen.queryByText(/Inicia sesión/)).not.toBeInTheDocument();
		expect(screen.queryByText(/panel de administración/)).not.toBeInTheDocument();
	});

	it("offers the dead end to a signed-in visitor too", () => {
		hoisted.isSignedIn = true;
		hoisted.preview = { data: null, isLoading: false };
		render(<InviteAcceptPage />);

		expect(screen.queryByRole("button", { name: "Aceptar invitación" })).not.toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Ir a la página de inicio de Tavli" })).toBeVisible();
	});

	it("does not show the dead end while the invitation is still loading", () => {
		hoisted.preview = { data: undefined, isLoading: true };
		render(<InviteAcceptPage />);

		expect(screen.getByText("Cargando…")).toBeInTheDocument();
		expect(
			screen.queryByText("Este enlace de invitación no es válido o ya expiró.")
		).not.toBeInTheDocument();
	});
});

describe("inviteHeadline", () => {
	const t = i18n.getFixedT("es");

	it("names a few restaurants as a list in the reader's language", () => {
		expect(
			inviteHeadline(
				{ organizationName: "Grupo Fierro", restaurantNames: ["Vernáculo", "Fierro", "Pardo"] },
				t,
				"es"
			)
		).toBe("Te invitaron a unirte a Vernáculo, Fierro y Pardo.");
		expect(
			inviteHeadline(
				{ organizationName: "Grupo Fierro", restaurantNames: ["Vernáculo", "Fierro"] },
				i18n.getFixedT("en"),
				"en"
			)
		).toBe("You've been invited to join Vernáculo and Fierro.");
	});

	it("counts many restaurants against their organization", () => {
		expect(
			inviteHeadline(
				{ organizationName: "Grupo Fierro", restaurantNames: ["A", "B", "C", "D"] },
				t,
				"es"
			)
		).toBe("Te invitaron a unirte a 4 restaurantes de Grupo Fierro.");
	});

	it("names the organization on an organization-level invite", () => {
		expect(inviteHeadline({ organizationName: "Grupo Fierro", restaurantNames: [] }, t, "es")).toBe(
			"Te invitaron a unirte a Grupo Fierro en Tavli."
		);
	});

	it("falls back to the anonymous line when nothing is named", () => {
		expect(inviteHeadline({ organizationName: null, restaurantNames: [] }, t, "es")).toBe(
			"Te invitaron a unirte a un equipo en Tavli."
		);
	});
});
