/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, boundaries/element-types, @typescript-eslint/no-explicit-any */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
	/** Answer of `reservations.isBookableByDiners` for the render under test. */
	bookable: undefined as boolean | undefined,
}));

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: (_path: string) => (options: any) => options,
	// An <a> only carries the "link" role once it has an href, so the stub has
	// to supply one or every tab is invisible to a role query.
	Link: ({ children, to, params: _params, ...rest }: any) => (
		<a href={String(to)} {...rest}>
			{children}
		</a>
	),
	Outlet: () => null,
	useNavigate: () => vi.fn(),
	useParams: () => ({ slug: "vernaculo-spgg", lang: "en" }),
	useRouterState: () => "/r/vernaculo-spgg/en/menu",
}));

vi.mock("@clerk/tanstack-react-start", () => ({
	SignInButton: ({ children }: any) => <>{children}</>,
	SignUpButton: ({ children }: any) => <>{children}</>,
	useAuth: () => ({ isSignedIn: false }),
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (ref: any, args: any) => ({ ref: String(ref?.name ?? ""), args }),
}));

vi.mock("@tanstack/react-query", () => ({
	useQuery: ({ ref }: any) => {
		if (ref.includes("isBookable")) return { data: hoisted.bookable };
		return { data: { _id: "restaurants:1", name: "vernaculo" } };
	},
}));

vi.mock("convex/_generated/api", () => ({
	api: {
		restaurants: { getBySlug: { name: "restaurants:getBySlug" } },
		reservations: { isBookableByDiners: { name: "reservations:isBookableByDiners" } },
	},
}));

vi.mock("@/features/ordering", () => ({ useCustomerSession: () => ({ sessionId: null }) }));
vi.mock("@/features/ordering/hooks/useBranding", () => ({
	BrandingProvider: ({ children }: any) => <>{children}</>,
}));
vi.mock("@/features/ordering/brandingCss", () => ({ buildBrandingCss: () => "" }));
vi.mock("@/features/ordering/brandingLoader", () => ({ loadBranding: async () => null }));

import { CustomerNavTabs } from "./$slug";

describe("CustomerNavTabs", () => {
	beforeEach(() => {
		hoisted.bookable = undefined;
	});

	it("shows both tabs when the restaurant takes reservations", () => {
		hoisted.bookable = true;

		render(<CustomerNavTabs slug="vernaculo-spgg" />);

		expect(screen.getByRole("navigation", { name: /customer sections/i })).toBeTruthy();
		expect(screen.getAllByRole("link")).toHaveLength(2);
	});

	// A strip holding one tab is not navigation, it is a label that looks
	// clickable — the same argument CategoryPills already makes for a menu
	// with one category.
	it("renders nothing when Menu would be the only tab", () => {
		hoisted.bookable = false;

		render(<CustomerNavTabs slug="vernaculo-spgg" />);

		expect(screen.queryByRole("navigation")).toBeNull();
	});

	it("renders nothing while the reservations answer is still loading", () => {
		hoisted.bookable = undefined;

		render(<CustomerNavTabs slug="vernaculo-spgg" />);

		expect(screen.queryByRole("navigation")).toBeNull();
	});
});
