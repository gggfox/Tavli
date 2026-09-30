/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, boundaries/element-types, @typescript-eslint/no-explicit-any */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
	/** Answer of `reservations.isBookableByDiners` for the render under test. */
	bookable: undefined as boolean | undefined,
	pathname: "/r/vernaculo-spgg/en/menu",
	session: {
		isLoaded: true,
		isSignedIn: false,
		sessionId: null as string | null,
		errorKey: null as string | null,
		retry: () => {},
	},
	loaderData: { branding: null, restaurantName: "Vernáculo", notFound: false } as any,
	loadBranding: async (): Promise<any> => null,
}));

vi.mock("@tanstack/react-router", () => ({
	// The options object doubles as the route, plus the two hooks the layout
	// reads off it.
	createFileRoute: (_path: string) => (options: any) => ({
		...options,
		useParams: () => ({ slug: "vernaculo-spgg" }),
		useLoaderData: () => hoisted.loaderData,
	}),
	notFound: (options: any = {}) => ({ ...options, isNotFound: true }),
	// An <a> only carries the "link" role once it has an href, so the stub has
	// to supply one or every tab is invisible to a role query.
	Link: ({ children, to, params: _params, ...rest }: any) => (
		<a href={String(to)} {...rest}>
			{children}
		</a>
	),
	/** Stands in for the child page — the menu, the reservation form, … */
	Outlet: () => <div data-testid="child-page" />,
	useNavigate: () => vi.fn(),
	useParams: () => ({ slug: "vernaculo-spgg", lang: "en" }),
	useRouterState: () => hoisted.pathname,
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

vi.mock("@/features/ordering", () => ({ useCustomerSession: () => hoisted.session }));
vi.mock("@/features/ordering/hooks/useBranding", () => ({
	BrandingProvider: ({ children }: any) => <>{children}</>,
}));
vi.mock("@/features/ordering/brandingCss", () => ({ buildBrandingCss: () => "" }));
vi.mock("@/features/ordering/brandingLoader", () => ({
	loadBranding: () => hoisted.loadBranding(),
}));

import { CustomerNavTabs, CustomerNotFound, Route, isBrowsableWithoutSession } from "./$slug";

const route = Route as any;

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

describe("isBrowsableWithoutSession", () => {
	it.each([
		"/r/vernaculo-spgg/menu",
		"/r/vernaculo-spgg/es/menu",
		"/r/vernaculo-spgg/en/menu/",
		"/r/vernaculo-spgg/reserve",
	])("lets a signed-out diner see %s", (path) => {
		expect(isBrowsableWithoutSession(path)).toBe(true);
	});

	it.each([
		"/r/vernaculo-spgg/en/orders",
		"/r/vernaculo-spgg/en/order/abc",
		"/r/vernaculo-spgg/en/checkout",
		"/r/vernaculo-spgg/en/closeout",
		"/r/vernaculo-spgg/en/cart",
	])("keeps %s behind sign-in", (path) => {
		expect(isBrowsableWithoutSession(path)).toBe(false);
	});
});

describe("CustomerLayout", () => {
	const Layout = () => route.component();

	beforeEach(() => {
		hoisted.bookable = false;
		hoisted.pathname = "/r/vernaculo-spgg/en/menu";
		hoisted.session = {
			isLoaded: true,
			isSignedIn: false,
			sessionId: null,
			errorKey: null,
			retry: () => {},
		};
	});

	describe("signed out", () => {
		it("renders the menu page itself, not a sign-in wall", () => {
			render(<Layout />);

			expect(screen.getByTestId("child-page")).toBeInTheDocument();
			expect(screen.queryByRole("heading", { name: /sign in to order/i })).toBeNull();
			// The branded header is still there: this is the restaurant's page.
			expect(screen.getByText("vernaculo")).toBeInTheDocument();
		});

		it("renders the reservation form", () => {
			hoisted.pathname = "/r/vernaculo-spgg/reserve";

			render(<Layout />);

			expect(screen.getByTestId("child-page")).toBeInTheDocument();
			expect(screen.queryByRole("heading", { name: /sign in to order/i })).toBeNull();
		});

		it("keeps the sign-in card on pages about the diner's own orders", () => {
			hoisted.pathname = "/r/vernaculo-spgg/en/orders";

			render(<Layout />);

			expect(screen.queryByTestId("child-page")).toBeNull();
			expect(screen.getByRole("heading", { name: /sign in to order/i })).toBeInTheDocument();
			// The copy no longer claims the menu needs an account…
			expect(screen.queryByText(/to browse the menu/i)).toBeNull();
			// …and the card is not a dead end.
			expect(screen.getByRole("link", { name: /back to menu/i })).toBeInTheDocument();
		});
	});

	it("shows loading, not 'no active session', while Clerk resolves", () => {
		hoisted.session = { ...hoisted.session, isLoaded: false };

		render(<Layout />);

		expect(screen.getByRole("status")).toBeInTheDocument();
		expect(screen.queryByText(/no active session/i)).toBeNull();
		expect(screen.queryByTestId("child-page")).toBeNull();
	});

	it("shows loading while a signed-in diner's Session is being opened", () => {
		hoisted.session = { ...hoisted.session, isSignedIn: true, sessionId: null };

		render(<Layout />);

		expect(screen.getByRole("status")).toBeInTheDocument();
		expect(screen.queryByText(/no active session/i)).toBeNull();
	});
});

describe("/r/$slug loader", () => {
	const load = () =>
		route.loader({ context: { queryClient: {} }, params: { slug: "does-not-exist" } });

	it("renders not-found for a restaurant Convex says does not exist", async () => {
		hoisted.loadBranding = async () => ({ branding: null, restaurantName: null, notFound: true });

		const thrown = await load().catch((error: unknown) => error);
		expect(thrown).toMatchObject({ isNotFound: true });

		// …and what that not-found renders is the restaurant copy.
		render(<CustomerNotFound data={thrown.data} />);
		expect(
			screen.getByRole("heading", { name: /couldn't find this restaurant/i })
		).toBeInTheDocument();
	});

	it("does NOT render not-found when the lookup timed out", async () => {
		// A Convex blip must never tell a diner at a real table that their
		// restaurant does not exist — it degrades to an unbranded page instead.
		const unresolved = { branding: null, restaurantName: null, notFound: false };
		hoisted.loadBranding = async () => unresolved;

		await expect(load()).resolves.toEqual(unresolved);
	});
});

describe("CustomerNotFound", () => {
	it("an unknown restaurant: says so, with no sign-in buttons and no branded header", () => {
		render(<CustomerNotFound data="restaurant-missing" />);

		expect(
			screen.getByRole("heading", { name: /couldn't find this restaurant/i })
		).toBeInTheDocument();
		expect(screen.queryByRole("button")).toBeNull();
		expect(screen.queryByRole("banner")).toBeNull();
	});

	it("a real restaurant, a page that does not exist: does not claim the restaurant is missing", () => {
		// The router's fuzzy not-found lands `/r/<real-slug>/en/typo` here too.
		render(<CustomerNotFound data={undefined} />);

		expect(screen.queryByText(/couldn't find this restaurant/i)).toBeNull();
		expect(screen.getByRole("heading", { name: /couldn't find this page/i })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: /back to menu/i })).toBeInTheDocument();
	});
});

describe("/r/$slug head", () => {
	it("titles the page with the restaurant's name", () => {
		const head = route.head({
			loaderData: { branding: null, restaurantName: "Vernáculo", notFound: false },
		});
		expect(head.meta).toEqual([{ title: "Vernáculo" }]);
	});

	it("leaves the app title alone when the name did not resolve", () => {
		const head = route.head({
			loaderData: { branding: null, restaurantName: null, notFound: false },
		});
		expect(head.meta).toBeUndefined();
	});
});
