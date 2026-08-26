import { useCustomerSession } from "@/features/ordering";
import { BrandingProvider } from "@/features/ordering/hooks/useBranding";
import { ErrorFallback, RouteErrorComponent } from "@/global/components";
import { CustomerKeys, OrderingKeys } from "@/global/i18n";
import { SignInButton, SignUpButton, useAuth } from "@clerk/tanstack-react-start";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import {
	Link,
	Outlet,
	createFileRoute,
	useNavigate,
	useParams,
	useRouterState,
	type ErrorComponentProps,
} from "@tanstack/react-router";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { brandFontPreloadHref } from "convex/_shared/brandFonts";
import { buildBrandingCss } from "@/features/ordering/brandingCss";
import { loadBranding } from "@/features/ordering/brandingLoader";
import { CalendarClock, LogIn, Receipt, UserPlus, UtensilsCrossed } from "lucide-react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/r/$slug")({
	/**
	 * Resolve branding before the first byte (TAVLI-97). Applying it after
	 * hydration was rejected: the diner would watch platform blue repaint into
	 * the restaurant's colour on the first frame of the one screen this feature
	 * exists to make feel like theirs.
	 *
	 * `loadBranding` never throws — every failure degrades to unbranded — so
	 * this cannot turn a Convex blip into an error page for a diner mid-order.
	 */
	loader: async ({ context, params }) => loadBranding(context.queryClient, params.slug),

	/**
	 * **A pure function of `loaderData`.** TanStack re-runs `head()` on
	 * hydration and does not set `suppressHydrationWarning` on `style`, so
	 * anything non-deterministic here (a timestamp, a `document` read) is a
	 * hydration mismatch on every customer page load.
	 */
	head: ({ loaderData }) => {
		const css = buildBrandingCss(loaderData?.branding);
		const fontId = loaderData?.branding?.fontId;
		return {
			...(css ? { styles: [{ children: css }] } : {}),
			...(fontId
				? {
						links: [
							{
								rel: "preload",
								as: "font",
								type: "font/woff2",
								href: brandFontPreloadHref(fontId),
								// Fonts are always fetched in CORS mode, even
								// same-origin. Without this the preload succeeds and is
								// then discarded as a different request, so the file is
								// downloaded twice and the preload achieves nothing.
								crossOrigin: "anonymous",
							},
						],
					}
				: {}),
		};
	},
	component: CustomerLayout,
	errorComponent: CustomerErrorComponent,
});

/**
 * Customer-facing recovery differs from the staff default: a diner who hits
 * an error mid-order should be able to get back to the menu of the
 * restaurant they are sitting in, not just reload.
 */
function CustomerErrorComponent(props: Readonly<ErrorComponentProps>) {
	const { t } = useTranslation();
	const { slug } = Route.useParams();
	return (
		<RouteErrorComponent
			{...props}
			actions={
				<Link
					to="/r/$slug/menu"
					params={{ slug }}
					className="px-6 py-2.5 font-medium rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-offset-2 hover-btn-secondary"
				>
					{t(CustomerKeys.MENU)}
				</Link>
			}
		/>
	);
}

/**
 * Publishes the loader's branding to the whole customer tree.
 *
 * Wrapping here rather than inside each branch is deliberate: the signed-out
 * state renders its own header with its own logo, and the error and
 * no-session states are still the restaurant's pages. A provider per branch
 * would be four chances to forget one.
 */
function CustomerLayout() {
	const { branding } = Route.useLoaderData();
	return (
		<BrandingProvider branding={branding}>
			<CustomerLayoutContent />
		</BrandingProvider>
	);
}

function CustomerLayoutContent() {
	const { t } = useTranslation();
	const { slug } = Route.useParams();
	const { isLoaded, isSignedIn, sessionId, errorKey, retry } = useCustomerSession(slug);

	if (!isLoaded) {
		return (
			<div className="flex-1 flex items-center justify-center p-6">
				<p className="text-sm text-muted-foreground">{t(OrderingKeys.SESSION_NO_SESSION)}</p>
			</div>
		);
	}

	if (!isSignedIn) {
		return (
			<div className="flex-1 flex flex-col min-h-0">
				<header className="px-3 py-2 shrink-0 border-b border-border bg-muted space-y-1.5">
					<RestaurantNameBadge slug={slug} />
					<div className="flex items-center justify-between gap-2">
						<CustomerNavTabs slug={slug} />
						<CustomerAuthAction forceShow />
					</div>
				</header>
				<div className="flex-1 flex items-center justify-center p-6">
					<div className="text-center max-w-sm space-y-4">
						<h1 className="text-xl font-semibold text-foreground">
							{t(OrderingKeys.SESSION_SIGN_IN_REQUIRED)}
						</h1>
						<p className="text-sm text-muted-foreground">
							{t(OrderingKeys.SESSION_SIGN_IN_PROMPT)}
						</p>
						<div className="flex flex-col sm:flex-row items-center justify-center gap-2">
							<SignInButton mode="redirect">
								<button
									type="button"
									className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium hover-btn-primary transition-colors"
								>
									<LogIn size={16} />
									{t(CustomerKeys.SIGN_IN)}
								</button>
							</SignInButton>
							<SignUpButton mode="redirect">
								<button
									type="button"
									className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium border border-border hover-secondary transition-colors"
								>
									<UserPlus size={16} />
									{t(CustomerKeys.SIGN_UP)}
								</button>
							</SignUpButton>
						</div>
					</div>
				</div>
			</div>
		);
	}

	// A failed session handshake is caught, not thrown, so it never reaches
	// the route's `errorComponent`. Render it through the same panel anyway so
	// the diner gets a consistent surface — and, unlike the old dead-end
	// message, a way out. `retry` re-runs the bootstrap exactly once; the hook
	// still refuses to retry on its own (see #69).
	if (errorKey) {
		return (
			<ErrorFallback
				error={undefined}
				title={t(OrderingKeys.SESSION_OOPS)}
				description={t(errorKey)}
				onRetry={retry}
			/>
		);
	}

	if (!sessionId) {
		return (
			<div className="flex-1 flex items-center justify-center p-6">
				<p className="text-sm text-muted-foreground">{t(OrderingKeys.SESSION_NO_SESSION)}</p>
			</div>
		);
	}

	return (
		<div className="flex-1 flex flex-col min-h-0 overflow-hidden">
			<CustomerHeader slug={slug} sessionId={sessionId} />
			<div className="flex-1 min-h-0 overflow-hidden">
				<Outlet />
			</div>
		</div>
	);
}

/**
 * The restaurant's name in the sticky header — the diner's only persistent
 * answer to "whose menu is this?".
 *
 * Reads the same `getBySlug` subscription the menu page already holds, so this
 * is a cache hit rather than a second round trip. Renders nothing until the
 * name resolves: a placeholder would shift the header's layout on arrival.
 *
 * Rendered on its own line rather than inline with the nav. At 375px the nav
 * pills and the actions already consume the row, so an inline name truncates
 * to nothing and pushes the auth buttons into wrapping.
 */
function RestaurantNameBadge({ slug }: Readonly<{ slug: string }>) {
	const { data: restaurant } = useQuery(convexQuery(api.restaurants.getBySlug, { slug }));
	if (!restaurant?.name) return null;

	const logo = restaurant.branding?.logo;
	if (logo) {
		return (
			// The logo *replaces* the name line rather than sitting beside it: a
			// logo almost always contains the name, and showing both reads as a
			// rendering bug. The name survives as `alt`, so a blocked or slow
			// image still says which restaurant this is — and a screen reader
			// gets the same line it got before branding existed.
			<img
				src={logo.url}
				alt={restaurant.name}
				width={logo.width}
				height={logo.height}
				// Explicit dimensions plus a fixed rendered height. Preflight sets
				// `img { height: auto }`, so an image with no intrinsic size
				// collapses to nothing and then shoves the header open when it
				// decodes — the exact shift the stored dimensions exist to stop.
				className="h-8 w-auto max-w-40 object-contain object-left"
			/>
		);
	}

	return <p className="truncate text-sm font-semibold text-foreground">{restaurant.name}</p>;
}

function CustomerHeader({
	slug,
	sessionId,
}: Readonly<{ slug: string; sessionId: Id<"sessions"> | null }>) {
	return (
		<header className="px-3 py-2 shrink-0 border-b border-border bg-muted space-y-1.5">
			<RestaurantNameBadge slug={slug} />
			<div className="flex items-center justify-between gap-2">
				<CustomerNavTabs slug={slug} />
				<div className="flex items-center gap-2 shrink-0">
					{sessionId && <MyOrdersLink sessionId={sessionId} slug={slug} />}
					<CustomerAuthAction />
				</div>
			</div>
		</header>
	);
}

function CustomerNavTabs({ slug }: Readonly<{ slug: string }>) {
	const { t } = useTranslation();
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const params = useParams({ strict: false });
	const lang = (params as { lang?: string }).lang;

	const { data: restaurant } = useQuery(convexQuery(api.restaurants.getBySlug, { slug }));
	const { data: bookable } = useQuery(
		convexQuery(
			api.reservations.isBookableByDiners,
			restaurant ? { restaurantId: restaurant._id } : "skip"
		)
	);
	// Hidden while the answer is still loading, not shown-then-removed: a tab
	// that appears and vanishes invites the tap that lands on a 404. The route
	// refuses independently, so this is presentation, never the gate.
	const showReserve = bookable === true;

	const isReserveActive = pathname.endsWith("/reserve");
	const isMenuActive = !isReserveActive;

	return (
		<nav
			aria-label="Customer sections"
			className="flex shrink-0 items-center gap-0.5 rounded-full p-0.5 bg-background border border-border"
		>
			{lang ? (
				<TabLink
					to="/r/$slug/$lang/menu"
					params={{ slug, lang }}
					active={isMenuActive}
					icon={<UtensilsCrossed size={14} />}
					label={t(CustomerKeys.MENU)}
				/>
			) : (
				<TabLink
					to="/r/$slug/menu"
					params={{ slug }}
					active={isMenuActive}
					icon={<UtensilsCrossed size={14} />}
					label={t(CustomerKeys.MENU)}
				/>
			)}
			{showReserve ? (
				<TabLink
					to="/r/$slug/reserve"
					params={{ slug }}
					active={isReserveActive}
					icon={<CalendarClock size={14} />}
					label={t(CustomerKeys.RESERVE)}
				/>
			) : null}
		</nav>
	);
}

type TabLinkProps =
	| {
			to: "/r/$slug/menu" | "/r/$slug/reserve";
			params: { slug: string };
			active: boolean;
			icon: React.ReactNode;
			label: string;
	  }
	| {
			to: "/r/$slug/$lang/menu";
			params: { slug: string; lang: string };
			active: boolean;
			icon: React.ReactNode;
			label: string;
	  };

function TabLink(props: Readonly<TabLinkProps>) {
	const { active, icon, label } = props;
	const linkClass = `flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
		active ? "" : "hover-secondary"
	}`;
	const linkStyle: React.CSSProperties = active
		? {
				backgroundColor: "var(--btn-primary-bg)",
				color: "var(--btn-primary-text)",
			}
		: {
				color: "var(--text-secondary)",
				backgroundColor: "transparent",
			};

	if (props.to === "/r/$slug/$lang/menu") {
		return (
			<Link
				to={props.to}
				params={props.params}
				className={linkClass}
				style={linkStyle}
				aria-current={active ? "page" : undefined}
			>
				{icon}
				<span>{label}</span>
			</Link>
		);
	}

	return (
		<Link
			to={props.to}
			params={props.params}
			className={linkClass}
			style={linkStyle}
			aria-current={active ? "page" : undefined}
		>
			{icon}
			<span>{label}</span>
		</Link>
	);
}

function CustomerAuthAction({ forceShow = false }: Readonly<{ forceShow?: boolean }>) {
	const { t } = useTranslation();
	const { isLoaded, isSignedIn } = useAuth();

	if (!isLoaded || (isSignedIn && !forceShow)) return null;

	return (
		<div className="flex items-center gap-1.5">
			<SignInButton mode="redirect">
				<button
					type="button"
					className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium hover-secondary transition-colors"
					aria-label={t(CustomerKeys.SIGN_IN)}
				>
					<LogIn size={14} />
					<span>{t(CustomerKeys.SIGN_IN)}</span>
				</button>
			</SignInButton>
			<SignUpButton mode="redirect">
				<button
					type="button"
					className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium hover-btn-primary transition-colors"
					aria-label={t(CustomerKeys.SIGN_UP)}
				>
					<UserPlus size={14} />
					<span>{t(CustomerKeys.SIGN_UP)}</span>
				</button>
			</SignUpButton>
		</div>
	);
}

function MyOrdersLink({ sessionId, slug }: Readonly<{ sessionId: Id<"sessions">; slug: string }>) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const params = useParams({ strict: false });
	const lang = (params as { lang?: string }).lang;

	const { data: orders } = useQuery(convexQuery(api.orders.getOrdersBySession, { sessionId }));

	const visibleOrders = (orders ?? []).filter(
		(o) => !(o.status === "draft" && o.totalAmount === 0)
	);
	const activeCount = visibleOrders.filter(
		(o) => o.status !== "served" && o.status !== "cancelled"
	).length;

	if (visibleOrders.length === 0) return null;

	const handleClick = () => {
		if (lang) {
			navigate({ to: "/r/$slug/$lang/orders", params: { slug, lang } });
		} else {
			navigate({ to: "/r/$slug/orders", params: { slug } });
		}
	};

	return (
		<button
			onClick={handleClick}
			className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium hover:bg-(--bg-hover) transition-colors text-foreground border border-border"
			aria-label={t(OrderingKeys.SESSION_VIEW_ORDERS)}
		>
			<Receipt size={14} className="text-muted-foreground" />
			<span>{t(OrderingKeys.SESSION_MY_ORDERS)}</span>
			{activeCount > 0 && (
				<span className="ml-0.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center bg-primary text-primary-foreground">
					{activeCount}
				</span>
			)}
		</button>
	);
}
