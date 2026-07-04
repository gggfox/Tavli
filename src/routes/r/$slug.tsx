import { restoreSession, useSessionStore } from "@/features/ordering";
import { CustomerKeys, OrderingKeys } from "@/global/i18n";
import { SignInButton, SignUpButton, useAuth } from "@clerk/tanstack-react-start";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	Link,
	Outlet,
	createFileRoute,
	useNavigate,
	useParams,
	useRouterState,
} from "@tanstack/react-router";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { CalendarClock, LogIn, Receipt, UserPlus, UtensilsCrossed } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

function getSessionErrorKey(err: unknown): string {
	let raw = "";
	if (err instanceof Error) raw = err.message;
	else if (typeof err === "string") raw = err;

	if (raw.includes("Restaurant not found")) {
		return OrderingKeys.SESSION_ERROR_NOT_FOUND;
	}
	if (raw.includes("NOT_AUTHENTICATED")) {
		return OrderingKeys.SESSION_SIGN_IN_REQUIRED;
	}
	return OrderingKeys.SESSION_ERROR_GENERIC;
}

export const Route = createFileRoute("/r/$slug")({
	component: CustomerLayout,
});

function CustomerLayout() {
	const { t } = useTranslation();
	const { slug } = Route.useParams();
	const { isLoaded, isSignedIn } = useAuth();
	const { sessionId, setSession, clearSession } = useSessionStore();
	const [errorKey, setErrorKey] = useState<string | null>(null);
	const [creatingSession, setCreatingSession] = useState(false);

	const createSession = useMutation({
		mutationFn: useConvexMutation(api.sessions.create),
	});

	const restoredFromStorage = useMemo(
		() => (!sessionId && isSignedIn ? restoreSession() : null),
		[sessionId, isSignedIn]
	);

	const { data: restoredSession, isPending: validatingRestore } = useQuery({
		...convexQuery(
			api.sessions.getActive,
			restoredFromStorage?.sessionId
				? { sessionId: restoredFromStorage.sessionId as Id<"sessions"> }
				: "skip"
		),
		enabled: isLoaded && isSignedIn && !sessionId && !!restoredFromStorage?.sessionId,
	});

	useEffect(() => {
		if (!isLoaded) return;

		if (!isSignedIn) {
			clearSession();
			setErrorKey(null);
			return;
		}

		if (sessionId) return;

		if (restoredFromStorage && validatingRestore) return;

		if (restoredFromStorage && restoredSession) {
			setSession({
				sessionId: restoredSession._id,
				restaurantId: restoredSession.restaurantId,
			});
			return;
		}

		if (restoredFromStorage && restoredSession === null) {
			clearSession();
		}

		if (creatingSession) return;

		setCreatingSession(true);
		setErrorKey(null);
		createSession
			.mutateAsync({ restaurantSlug: slug })
			.then((result) => {
				setSession({
					sessionId: result.sessionId,
					restaurantId: result.restaurantId,
				});
			})
			.catch((err: unknown) => {
				setErrorKey(getSessionErrorKey(err));
			})
			.finally(() => {
				setCreatingSession(false);
			});
	}, [
		isLoaded,
		isSignedIn,
		slug,
		sessionId,
		restoredFromStorage,
		restoredSession,
		validatingRestore,
		creatingSession,
		setSession,
		clearSession,
		createSession,
	]);

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
				<header className="px-3 py-2 flex items-center justify-between gap-2 shrink-0 border-b border-border bg-muted">
					<CustomerNavTabs slug={slug} />
					<CustomerAuthAction forceShow />
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

	if (errorKey) {
		return (
			<div className="flex-1 flex items-center justify-center p-6">
				<div className="text-center max-w-sm">
					<h1 className="text-xl font-semibold mb-2 text-foreground">
						{t(OrderingKeys.SESSION_OOPS)}
					</h1>
					<p className="text-sm text-muted-foreground">{t(errorKey)}</p>
				</div>
			</div>
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

function CustomerHeader({
	slug,
	sessionId,
}: Readonly<{ slug: string; sessionId: Id<"sessions"> | null }>) {
	return (
		<header className="px-3 py-2 flex items-center justify-between gap-2 shrink-0 border-b border-border bg-muted">
			<CustomerNavTabs slug={slug} />
			<div className="flex items-center gap-2">
				{sessionId && <MyOrdersLink sessionId={sessionId} slug={slug} />}
				<CustomerAuthAction />
			</div>
		</header>
	);
}

function CustomerNavTabs({ slug }: Readonly<{ slug: string }>) {
	const { t } = useTranslation();
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const params = useParams({ strict: false });
	const lang = (params as { lang?: string }).lang;

	const isReserveActive = pathname.endsWith("/reserve");
	const isMenuActive = !isReserveActive;

	return (
		<nav
			aria-label="Customer sections"
			className="flex items-center gap-0.5 rounded-full p-0.5 bg-background border border-border"
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
			<TabLink
				to="/r/$slug/reserve"
				params={{ slug }}
				active={isReserveActive}
				icon={<CalendarClock size={14} />}
				label={t(CustomerKeys.RESERVE)}
			/>
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
				<span
					className="ml-0.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center bg-primary"
					style={{ color: "white" }}
				>
					{activeCount}
				</span>
			)}
		</button>
	);
}
