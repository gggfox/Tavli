import { OrderingKeys } from "@/global/i18n";
import { formatCents } from "@/global/utils/money";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import {
	ArrowLeft,
	CheckCircle2,
	ChefHat,
	Clock,
	Copy,
	CreditCard,
	Lock,
	Users,
	UtensilsCrossed,
	XCircle,
} from "lucide-react";
import type { TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { grantGeofenceBypass } from "../hooks/useGeofence";
import { useSessionStore } from "../hooks/useSession";
import { SessionOrdersListSkeleton } from "./SessionOrdersListSkeleton";

interface SessionOrdersListProps {
	slug: string;
	onBackToMenu: () => void;
	onViewOrder: (orderId: Id<"orders">) => void;
	/** Navigate to the tab checkout (tip + one Stripe payment for the whole tab). */
	onPayTab: () => void;
}

type OrderDoc = Doc<"orders">;

interface StatusMeta {
	label: string;
	icon: typeof Clock;
	iconColor: string;
	iconBg: string;
}

function getStatusMeta(order: OrderDoc, t: TFunction): StatusMeta {
	switch (order.status) {
		case "draft":
			return {
				label: t(OrderingKeys.ORDERS_LIFECYCLE_UNPAID),
				icon: CreditCard,
				iconColor: "var(--accent-warning)",
				iconBg: "rgba(217, 119, 6, 0.12)",
			};
		case "submitted":
			return {
				label: t(OrderingKeys.ORDERS_LIFECYCLE_PLACED),
				icon: Clock,
				iconColor: "var(--btn-primary-bg)",
				iconBg: "rgba(35, 131, 226, 0.12)",
			};
		case "preparing":
			return {
				label: t(OrderingKeys.ORDERS_LIFECYCLE_PREPARING),
				icon: ChefHat,
				iconColor: "var(--btn-primary-bg)",
				iconBg: "rgba(35, 131, 226, 0.12)",
			};
		case "ready":
			return {
				label: t(OrderingKeys.ORDERS_LIFECYCLE_READY),
				icon: CheckCircle2,
				iconColor: "var(--accent-success)",
				iconBg: "rgba(5, 150, 105, 0.12)",
			};
		case "served":
			return {
				label: t(OrderingKeys.ORDERS_LIFECYCLE_SERVED),
				icon: UtensilsCrossed,
				iconColor: "var(--text-muted)",
				iconBg: "var(--bg-secondary)",
			};
		case "cancelled":
			return {
				label: t(OrderingKeys.ORDERS_LIFECYCLE_CANCELLED),
				icon: XCircle,
				iconColor: "var(--accent-danger)",
				iconBg: "rgba(220, 38, 38, 0.12)",
			};
	}
}

function formatTime(timestamp: number, t: TFunction, locale: string): string {
	const now = Date.now();
	const diffMs = now - timestamp;
	const diffMin = Math.floor(diffMs / 60_000);
	if (diffMin < 1) return t(OrderingKeys.ORDERS_TIME_JUST_NOW);
	if (diffMin < 60) return t(OrderingKeys.ORDERS_TIME_MIN_AGO, { count: diffMin });
	const diffHr = Math.floor(diffMin / 60);
	if (diffHr < 24) return t(OrderingKeys.ORDERS_TIME_HOUR_AGO, { count: diffHr });
	return new Date(timestamp).toLocaleDateString(locale);
}

export function SessionOrdersList({
	slug,
	onBackToMenu,
	onViewOrder,
	onPayTab,
}: Readonly<SessionOrdersListProps>) {
	const { t } = useTranslation();
	const { sessionId } = useSessionStore();

	if (!sessionId) {
		return (
			<div className="flex flex-col h-full p-4">
				<Header onBackToMenu={onBackToMenu} />
				<div className="flex-1 flex items-center justify-center">
					<p className="text-sm text-faint-foreground">{t(OrderingKeys.SESSION_NO_SESSION)}</p>
				</div>
			</div>
		);
	}

	return (
		<SessionOrdersListContent
			slug={slug}
			sessionId={sessionId}
			onBackToMenu={onBackToMenu}
			onViewOrder={onViewOrder}
			onPayTab={onPayTab}
		/>
	);
}

function Header({ onBackToMenu }: Readonly<{ onBackToMenu: () => void }>) {
	const { t } = useTranslation();
	return (
		<div className="flex items-center gap-3 mb-4">
			<button
				onClick={onBackToMenu}
				className="p-2 rounded-lg hover:bg-(--bg-hover) text-foreground"
				aria-label={t(OrderingKeys.BACK_TO_MENU_ARIA)}
			>
				<ArrowLeft size={20} />
			</button>
			<h2 className="text-lg font-bold text-foreground">{t(OrderingKeys.ORDERS_HEADER)}</h2>
		</div>
	);
}

function SessionOrdersListContent({
	slug,
	sessionId,
	onBackToMenu,
	onViewOrder,
	onPayTab,
}: Readonly<{
	slug: string;
	sessionId: Id<"sessions">;
	onBackToMenu: () => void;
	onViewOrder: (orderId: Id<"orders">) => void;
	onPayTab: () => void;
}>) {
	const { t } = useTranslation();
	const { data: orders, isLoading } = useQuery(
		convexQuery(api.orders.getOrdersBySession, { sessionId })
	);
	const { data: tab } = useQuery(convexQuery(api.sessions.getTabSummary, { sessionId }));

	const visible = (orders ?? []).filter((o) => !(o.status === "draft" && o.totalAmount === 0));
	const sortedOrders = [...visible].sort((a, b) => b._creationTime - a._creationTime);

	if (isLoading && !orders) {
		return <SessionOrdersListSkeleton onBackToMenu={onBackToMenu} />;
	}

	return (
		<div className="flex flex-col h-full overflow-y-auto">
			<div className="max-w-lg w-full mx-auto p-4 pb-8 flex flex-col gap-3">
				<Header onBackToMenu={onBackToMenu} />

				{tab && <TabSummaryCard tab={tab} onPayTab={onPayTab} />}
				<JoinTabCard slug={slug} />

				{orders && sortedOrders.length === 0 && (
					<div className="py-12 flex flex-col items-center gap-2 rounded-xl bg-muted">
						<UtensilsCrossed size={32} className="text-faint-foreground" />
						<p className="text-sm font-medium text-foreground">
							{t(OrderingKeys.ORDERS_EMPTY_TITLE)}
						</p>
						<p className="text-xs text-center px-6 text-faint-foreground">
							{t(OrderingKeys.ORDERS_EMPTY_DESC)}
						</p>
						<button
							onClick={onBackToMenu}
							className="mt-2 px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
						>
							{t(OrderingKeys.ORDERS_EMPTY_BROWSE)}
						</button>
					</div>
				)}

				{sortedOrders.map((order) => (
					<OrderCard key={order._id} order={order} onViewOrder={onViewOrder} />
				))}
			</div>
		</div>
	);
}

type TabSummary = NonNullable<FunctionReturnType<typeof api.sessions.getTabSummary>>;

function TabSummaryCard({
	tab,
	onPayTab,
}: Readonly<{
	tab: TabSummary;
	onPayTab: () => void;
}>) {
	const { t } = useTranslation();
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		if (!tab.joinCode) return;
		try {
			await navigator.clipboard.writeText(tab.joinCode);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			// Clipboard unavailable — the code is visible on screen anyway.
		}
	};

	return (
		<div className="rounded-xl p-4 space-y-3 bg-muted border border-border">
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-2 text-sm font-semibold text-foreground">
					<Users size={16} className="text-muted-foreground" />
					<span>{t(OrderingKeys.TAB_HEADING)}</span>
					{tab.memberCount > 1 && (
						<span className="text-xs font-medium text-faint-foreground">
							{t(OrderingKeys.TAB_MEMBER_COUNT, { count: tab.memberCount })}
						</span>
					)}
				</div>
				<span className="text-sm font-semibold text-foreground">${formatCents(tab.subtotal)}</span>
			</div>

			{tab.joinCode && (
				<button
					type="button"
					onClick={handleCopy}
					className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm bg-background border border-border hover:bg-(--bg-hover)"
				>
					<span className="text-xs text-muted-foreground">
						{t(OrderingKeys.TAB_SHARE_CODE_LABEL)}
					</span>
					<span className="flex items-center gap-2 font-mono font-bold tracking-widest text-foreground">
						{tab.joinCode}
						<Copy size={14} className="text-faint-foreground" />
					</span>
				</button>
			)}
			{copied && <p className="text-xs text-success">{t(OrderingKeys.TAB_CODE_COPIED)}</p>}

			{tab.lockedForPayment ? (
				<div className="flex items-center gap-2 text-xs text-muted-foreground">
					<Lock size={14} />
					<span>{t(OrderingKeys.TAB_LOCKED_NOTICE)}</span>
				</div>
			) : null}

			<button
				type="button"
				onClick={onPayTab}
				disabled={tab.subtotal <= 0}
				className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold hover-btn-primary disabled:opacity-50"
			>
				<CreditCard size={16} />
				{t(OrderingKeys.TAB_PAY_CTA, { amount: formatCents(tab.subtotal) })}
			</button>
		</div>
	);
}

function JoinTabCard({ slug }: Readonly<{ slug: string }>) {
	const { t } = useTranslation();
	const { setSession } = useSessionStore();
	const [code, setCode] = useState("");
	const [error, setError] = useState(false);
	const joinByCode = useMutation({
		mutationFn: useConvexMutation(api.sessions.joinByCode),
	});

	const handleJoin = async () => {
		const normalized = code.trim().toUpperCase();
		if (!normalized) return;
		setError(false);
		try {
			const result = await joinByCode.mutateAsync({
				restaurantSlug: slug,
				joinCode: normalized,
			});
			setSession({ sessionId: result.sessionId, restaurantId: result.restaurantId });
			// A shared code proves physical presence at the table.
			grantGeofenceBypass(slug);
			setCode("");
		} catch {
			setError(true);
		}
	};

	return (
		<div className="rounded-xl p-4 space-y-2 bg-muted border border-border">
			<p className="text-xs font-semibold text-muted-foreground">
				{t(OrderingKeys.TAB_JOIN_HEADING)}
			</p>
			<div className="flex items-center gap-2">
				<input
					type="text"
					value={code}
					onChange={(e) => setCode(e.target.value.toUpperCase())}
					placeholder={t(OrderingKeys.TAB_JOIN_PLACEHOLDER)}
					className="flex-1 px-3 py-2 rounded-lg text-sm uppercase font-mono bg-background border border-border text-foreground"
					aria-label={t(OrderingKeys.TAB_JOIN_PLACEHOLDER)}
				/>
				<button
					type="button"
					onClick={handleJoin}
					disabled={!code.trim() || joinByCode.isPending}
					className="px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary disabled:opacity-50"
				>
					{t(OrderingKeys.TAB_JOIN_CTA)}
				</button>
			</div>
			{error && <p className="text-xs text-destructive">{t(OrderingKeys.TAB_JOIN_INVALID)}</p>}
		</div>
	);
}

function OrderCard({
	order,
	onViewOrder,
}: Readonly<{
	order: OrderDoc;
	onViewOrder: (orderId: Id<"orders">) => void;
}>) {
	const { t, i18n } = useTranslation();
	const meta = getStatusMeta(order, t);
	const Icon = meta.icon;

	return (
		<button
			onClick={() => onViewOrder(order._id)}
			className="w-full text-left flex items-center gap-3 p-4 rounded-xl transition-colors hover:bg-(--bg-hover) bg-muted border border-border"
		>
			<div
				className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
				style={{ backgroundColor: meta.iconBg }}
			>
				<Icon size={18} style={{ color: meta.iconColor }} />
			</div>

			<div className="flex-1 min-w-0">
				<div className="flex items-center justify-between gap-2">
					<span className="text-sm font-semibold text-foreground flex items-center gap-2 min-w-0">
						{order.dailyOrderNumber != null && (
							<span className="tabular-nums shrink-0 text-foreground">
								{t(OrderingKeys.ORDERS_DAY_NUMBER, { n: order.dailyOrderNumber })}
							</span>
						)}
						<span className="truncate">{meta.label}</span>
					</span>
					<span className="text-sm font-semibold text-foreground">
						${formatCents(order.totalAmount)}
					</span>
				</div>
				<div className="flex items-center justify-between mt-1">
					<span className="text-xs text-faint-foreground">
						{formatTime(order._creationTime, t, i18n.language)}
					</span>
					<span className="text-xs font-medium text-primary">
						{t(OrderingKeys.ORDERS_LIFECYCLE_VIEW)} →
					</span>
				</div>
			</div>
		</button>
	);
}
