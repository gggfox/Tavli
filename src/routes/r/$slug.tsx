import { restoreSession, useSessionStore } from "@/features/ordering";
import { CustomerKeys } from "@/global/i18n";
import { SignUpButton, useAuth } from "@clerk/tanstack-react-start";
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
import { CalendarClock, Receipt, UserPlus, UtensilsCrossed } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

function getSessionErrorMessage(err: unknown): string {
	let raw = "";
	if (err instanceof Error) raw = err.message;
	else if (typeof err === "string") raw = err;

	if (raw.includes("Restaurant not found")) {
		return "This restaurant was not found or is currently unavailable. Please check the link.";
	}
	return "Something went wrong. Please try refreshing the page.";
}

export const Route = createFileRoute("/r/$slug")({
	component: CustomerLayout,
});

function CustomerLayout() {
	const { slug } = Route.useParams();
	const { sessionId, setSession } = useSessionStore();
	const [error, setError] = useState<string | null>(null);

	const createSession = useMutation({
		mutationFn: useConvexMutation(api.sessions.create),
	});

	useEffect(() => {
		if (sessionId) return;

		const restored = restoreSession();
		if (restored) {
			setSession(restored);
			return;
		}

		createSession
			.mutateAsync({
				restaurantSlug: slug,
			})
			.then((result) => {
				setSession({
					sessionId: result.sessionId,
					restaurantId: result.restaurantId,
				});
			})
			.catch((err: unknown) => {
				setError(getSessionErrorMessage(err));
			});
	}, [slug]);

	if (error) {
		return (
			<div className="flex-1 flex items-center justify-center p-6">
				<div className="text-center max-w-sm">
					<h1 className="text-xl font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
						Oops!
					</h1>
					<p className="text-sm" style={{ color: "var(--text-secondary)" }}>
						{error}
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="flex-1 flex flex-col overflow-hidden">
			<CustomerHeader slug={slug} sessionId={sessionId} />
			<div className="flex-1 overflow-hidden">
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
		<header
			className="px-3 py-2 flex items-center justify-between gap-2 shrink-0"
			style={{
				borderBottom: "1px solid var(--border-default)",
				backgroundColor: "var(--bg-secondary)",
			}}
		>
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
			className="flex items-center gap-0.5 rounded-full p-0.5"
			style={{
				backgroundColor: "var(--bg-primary)",
				border: "1px solid var(--border-default)",
			}}
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
				color: "var(--btn-primary-text, #fff)",
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

function CustomerAuthAction() {
	const { t } = useTranslation();
	const { isLoaded, isSignedIn } = useAuth();

	if (!isLoaded || isSignedIn) return null;

	return (
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
	);
}

function MyOrdersLink({
	sessionId,
	slug,
}: Readonly<{ sessionId: Id<"sessions">; slug: string }>) {
	const navigate = useNavigate();
	const params = useParams({ strict: false });
	const lang = (params as { lang?: string }).lang;

	const { data: orders } = useQuery(
		convexQuery(api.orders.getOrdersBySession, { sessionId })
	);

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
			className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium hover:bg-(--bg-hover) transition-colors"
			style={{
				color: "var(--text-primary)",
				border: "1px solid var(--border-default)",
			}}
			aria-label="View your orders"
		>
			<Receipt size={14} style={{ color: "var(--text-secondary)" }} />
			<span>My orders</span>
			{activeCount > 0 && (
				<span
					className="ml-0.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center"
					style={{
						backgroundColor: "var(--btn-primary-bg)",
						color: "white",
					}}
				>
					{activeCount}
				</span>
			)}
		</button>
	);
}
