import { OrderingKeys } from "@/global/i18n";
import { formatCents } from "@/global/utils/money";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import {
	ArrowLeft,
	CheckCircle2,
	ChefHat,
	Clock,
	CreditCard,
	HandCoins,
	Lock,
	UtensilsCrossed,
	XCircle,
} from "lucide-react";
import type { TFunction } from "i18next";
import { OrderSummaryCard } from "./OrderSummaryCard";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "../hooks/useSession";
import { SessionOrdersListSkeleton } from "./SessionOrdersListSkeleton";

interface SessionOrdersListProps {
	onBackToMenu: () => void;
	onViewOrder: (orderId: Id<"orders">) => void;
	/** Navigate a draft to the per-order checkout (ADR 008 pay-at-submit). */
	onContinueCheckout: (orderId: Id<"orders">) => void;
	/** LEGACY (pre-pivot sessions only): navigate to the whole-tab checkout. */
	onPayTab: () => void;
	/** Navigate to the visit close-out (post-visit tip + close, Phase 3B). */
	onCloseout: () => void;
}

/**
 * An order plus its lines, as `orders.getOrdersBySession` now returns them —
 * the summary card needs the lines without a second round-trip.
 */
type OrderDoc = Doc<"orders"> & { items: Doc<"orderItems">[] };

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
		// ADR 008 cash path: staff collect at the table, then the kitchen fires.
		case "awaiting_payment":
			return {
				label: t(OrderingKeys.ORDERS_LIFECYCLE_AWAITING_PAYMENT),
				icon: HandCoins,
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
	onBackToMenu,
	onViewOrder,
	onContinueCheckout,
	onPayTab,
	onCloseout,
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
			sessionId={sessionId}
			onBackToMenu={onBackToMenu}
			onViewOrder={onViewOrder}
			onContinueCheckout={onContinueCheckout}
			onPayTab={onPayTab}
			onCloseout={onCloseout}
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
	sessionId,
	onBackToMenu,
	onViewOrder,
	onContinueCheckout,
	onPayTab,
	onCloseout,
}: Readonly<{
	sessionId: Id<"sessions">;
	onBackToMenu: () => void;
	onViewOrder: (orderId: Id<"orders">) => void;
	onContinueCheckout: (orderId: Id<"orders">) => void;
	onPayTab: () => void;
	onCloseout: () => void;
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

				{/*
				 * The Share and Join cards are gone (TAVLI-99). Grouping a table's
				 * orders is now a staff-side concern — see TAVLI-100 — rather than
				 * something a diner has to arrange by reading a code aloud.
				 *
				 * `sessions.joinByCode` and the `joinCode` field stay on the
				 * backend, deprecated: sessions that were already shared when this
				 * shipped keep working, and nothing has to migrate.
				 */}
				{/* LEGACY settlement tail: post-pivot sessions always report a tab
				    subtotal of 0 (orders pay at submit), so the whole-tab payment
				    card only renders for a pre-pivot session that still owes. */}
				{tab && tab.subtotal > 0 && <TabSummaryCard tab={tab} onPayTab={onPayTab} />}
				{/* Visit close-out (ADR 008, Phase 3B): per-member post-visit tip +
				    session close. `tab` is non-null only while the session is active. */}
				{tab && (
					<button
						type="button"
						onClick={onCloseout}
						className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold hover-btn-primary"
					>
						<HandCoins size={16} />
						{t(OrderingKeys.CLOSEOUT_CTA)}
					</button>
				)}

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
					<OrderCard
						key={order._id}
						order={order}
						onViewOrder={onViewOrder}
						onContinueCheckout={onContinueCheckout}
					/>
				))}
			</div>
		</div>
	);
}

type TabSummary = NonNullable<FunctionReturnType<typeof api.sessions.getTabSummary>>;

/**
 * LEGACY (pre-ADR-008) whole-tab balance + Pay-tab CTA. Only rendered while
 * the session carries a pre-pivot unpaid balance (`subtotal > 0`); deleted
 * with the rest of the tab machinery at T+30d.
 */
function TabSummaryCard({
	tab,
	onPayTab,
}: Readonly<{
	tab: TabSummary;
	onPayTab: () => void;
}>) {
	const { t } = useTranslation();
	// The tab still bills this food; it just can't be settled until it lands.
	const blocked = tab.unservedOrderIds.length > 0;

	return (
		<div className="rounded-xl p-4 space-y-3 bg-muted border border-border">
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-2 text-sm font-semibold text-foreground">
					<CreditCard size={16} className="text-muted-foreground" />
					<span>{t(OrderingKeys.TAB_PAY_HEADING)}</span>
				</div>
				<span className="text-sm font-semibold text-foreground">${formatCents(tab.subtotal)}</span>
			</div>

			{/* Locked wins: while a payment is in flight there is nothing the diner
			    can do but wait, so telling them to fetch a server would be wrong. */}
			{tab.lockedForPayment ? (
				<div className="flex items-center gap-2 text-xs text-muted-foreground">
					<Lock size={14} />
					<span>{t(OrderingKeys.TAB_LOCKED_NOTICE)}</span>
				</div>
			) : blocked ? (
				<div className="flex items-center gap-2 text-xs text-muted-foreground">
					<ChefHat size={14} />
					<span>{t(OrderingKeys.TAB_BLOCKED_NOTICE, { count: tab.unservedOrderIds.length })}</span>
				</div>
			) : null}

			<button
				type="button"
				onClick={onPayTab}
				disabled={tab.subtotal <= 0 || blocked}
				className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold hover-btn-primary disabled:opacity-50"
			>
				<CreditCard size={16} />
				{t(OrderingKeys.TAB_PAY_CTA, { amount: formatCents(tab.subtotal) })}
			</button>
		</div>
	);
}

function OrderCard({
	order,
	onViewOrder,
	onContinueCheckout,
}: Readonly<{
	order: OrderDoc;
	onViewOrder: (orderId: Id<"orders">) => void;
	onContinueCheckout: (orderId: Id<"orders">) => void;
}>) {
	const { t, i18n } = useTranslation();
	const meta = getStatusMeta(order, t);
	const Icon = meta.icon;
	// A draft with items resumes at the per-order checkout (ADR 008); every
	// other status opens the order detail page.
	const isDraft = order.status === "draft";
	const isPaid = order.paymentState === "paid";

	const card = (
		<button
			onClick={() => (isDraft ? onContinueCheckout(order._id) : onViewOrder(order._id))}
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
					<span className="flex items-center gap-2 shrink-0">
						{isPaid && (
							<span
								className="text-xs font-semibold px-2 py-0.5 rounded-full bg-success-subtle"
								style={{ color: "var(--accent-success)" }}
							>
								{t(OrderingKeys.ORDERS_PAID_BADGE)}
							</span>
						)}
						<span className="text-sm font-semibold text-foreground">
							${formatCents(order.totalAmount)}
						</span>
					</span>
				</div>
				<div className="flex items-center justify-between mt-1">
					<span className="text-xs text-faint-foreground">
						{formatTime(order._creationTime, t, i18n.language)}
					</span>
					<span className="text-xs font-medium text-primary">
						{isDraft
							? `${t(OrderingKeys.ORDERS_LIFECYCLE_CONTINUE_PAYMENT)} →`
							: `${t(OrderingKeys.ORDERS_LIFECYCLE_VIEW)} →`}
					</span>
				</div>
			</div>
		</button>
	);

	// A draft resumes at checkout — there is nothing to summarise yet, and
	// wrapping it would put a tooltip in front of the pay button.
	if (isDraft) return card;

	return (
		<OrderSummaryCard
			items={order.items}
			totalAmount={order.totalAmount}
			statusLabel={meta.label}
			onViewStatus={() => onViewOrder(order._id)}
		>
			{card}
		</OrderSummaryCard>
	);
}
