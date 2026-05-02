import { OrderingKeys } from "@/global/i18n";
import { formatCents } from "@/global/utils/money";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import {
	ArrowLeft,
	CheckCircle2,
	ChefHat,
	Clock,
	CreditCard,
	UtensilsCrossed,
	XCircle,
} from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "../hooks/useSession";
import { SessionOrdersListSkeleton } from "./SessionOrdersListSkeleton";

interface SessionOrdersListProps {
	onBackToMenu: () => void;
	onViewOrder: (orderId: Id<"orders">) => void;
	onResumeCheckout: (orderId: Id<"orders">) => void;
}

type OrderDoc = Doc<"orders">;

interface StatusMeta {
	label: string;
	action: "resume-checkout" | "view-order" | "none";
	actionLabel: string;
	icon: typeof Clock;
	iconColor: string;
	iconBg: string;
}

function getStatusMeta(order: OrderDoc, t: TFunction): StatusMeta {
	if (order.status === "draft") {
		if (order.paymentState === "failed") {
			return {
				label: t(OrderingKeys.ORDERS_LIFECYCLE_PAYMENT_FAILED),
				action: "resume-checkout",
				actionLabel: t(OrderingKeys.ORDERS_LIFECYCLE_TRY_AGAIN),
				icon: XCircle,
				iconColor: "var(--accent-danger)",
				iconBg: "rgba(220, 38, 38, 0.12)",
			};
		}
		if (order.paymentState === "processing" || order.paymentState === "pending") {
			return {
				label: t(OrderingKeys.ORDERS_LIFECYCLE_PAYMENT_PROCESSING),
				action: "view-order",
				actionLabel: t(OrderingKeys.ORDERS_LIFECYCLE_VIEW),
				icon: CreditCard,
				iconColor: "var(--btn-primary-bg)",
				iconBg: "rgba(35, 131, 226, 0.12)",
			};
		}
		return {
			label: t(OrderingKeys.ORDERS_LIFECYCLE_UNPAID),
			action: "resume-checkout",
			actionLabel: t(OrderingKeys.ORDERS_LIFECYCLE_FINISH_CHECKOUT),
			icon: CreditCard,
			iconColor: "var(--accent-warning)",
			iconBg: "rgba(217, 119, 6, 0.12)",
		};
	}

	switch (order.status) {
		case "submitted":
			return {
				label: t(OrderingKeys.ORDERS_LIFECYCLE_PLACED),
				action: "view-order",
				actionLabel: t(OrderingKeys.ORDERS_LIFECYCLE_VIEW),
				icon: Clock,
				iconColor: "var(--btn-primary-bg)",
				iconBg: "rgba(35, 131, 226, 0.12)",
			};
		case "preparing":
			return {
				label: t(OrderingKeys.ORDERS_LIFECYCLE_PREPARING),
				action: "view-order",
				actionLabel: t(OrderingKeys.ORDERS_LIFECYCLE_VIEW),
				icon: ChefHat,
				iconColor: "var(--btn-primary-bg)",
				iconBg: "rgba(35, 131, 226, 0.12)",
			};
		case "ready":
			return {
				label: t(OrderingKeys.ORDERS_LIFECYCLE_READY),
				action: "view-order",
				actionLabel: t(OrderingKeys.ORDERS_LIFECYCLE_VIEW),
				icon: CheckCircle2,
				iconColor: "var(--accent-success)",
				iconBg: "rgba(5, 150, 105, 0.12)",
			};
		case "served":
			return {
				label: t(OrderingKeys.ORDERS_LIFECYCLE_SERVED),
				action: "view-order",
				actionLabel: t(OrderingKeys.ORDERS_LIFECYCLE_VIEW),
				icon: UtensilsCrossed,
				iconColor: "var(--text-muted)",
				iconBg: "var(--bg-secondary)",
			};
		case "cancelled":
			return {
				label: t(OrderingKeys.ORDERS_LIFECYCLE_CANCELLED),
				action: "view-order",
				actionLabel: t(OrderingKeys.ORDERS_LIFECYCLE_VIEW),
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
	onResumeCheckout,
}: Readonly<SessionOrdersListProps>) {
	const { t } = useTranslation();
	const { sessionId } = useSessionStore();

	if (!sessionId) {
		return (
			<div className="flex flex-col h-full p-4">
				<Header onBackToMenu={onBackToMenu} />
				<div className="flex-1 flex items-center justify-center">
					<p className="text-sm text-faint-foreground" >
						{t(OrderingKeys.SESSION_NO_SESSION)}
					</p>
				</div>
			</div>
		);
	}

	return (
		<SessionOrdersListContent
			sessionId={sessionId}
			onBackToMenu={onBackToMenu}
			onViewOrder={onViewOrder}
			onResumeCheckout={onResumeCheckout}
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
				<ArrowLeft size={20}  />
			</button>
			<h2 className="text-lg font-bold text-foreground" >
				{t(OrderingKeys.ORDERS_HEADER)}
			</h2>
		</div>
	);
}

function SessionOrdersListContent({
	sessionId,
	onBackToMenu,
	onViewOrder,
	onResumeCheckout,
}: Readonly<{
	sessionId: Id<"sessions">;
	onBackToMenu: () => void;
	onViewOrder: (orderId: Id<"orders">) => void;
	onResumeCheckout: (orderId: Id<"orders">) => void;
}>) {
	const { t } = useTranslation();
	const { data: orders, isLoading } = useQuery(
		convexQuery(api.orders.getOrdersBySession, { sessionId })
	);

	const visible = (orders ?? []).filter(
		(o) => !(o.status === "draft" && o.totalAmount === 0)
	);
	const sortedOrders = [...visible].sort((a, b) => b._creationTime - a._creationTime);

	if (isLoading && !orders) {
		return <SessionOrdersListSkeleton onBackToMenu={onBackToMenu} />;
	}

	return (
		<div className="flex flex-col h-full overflow-y-auto">
			<div className="max-w-lg w-full mx-auto p-4 pb-8 flex flex-col gap-3">
				<Header onBackToMenu={onBackToMenu} />

				{orders && sortedOrders.length === 0 && (
					<div
						className="py-12 flex flex-col items-center gap-2 rounded-xl bg-muted"
						
					>
						<UtensilsCrossed size={32} className="text-faint-foreground"  />
						<p className="text-sm font-medium text-foreground" >
							{t(OrderingKeys.ORDERS_EMPTY_TITLE)}
						</p>
						<p className="text-xs text-center px-6 text-faint-foreground" >
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
						onResumeCheckout={onResumeCheckout}
					/>
				))}
			</div>
		</div>
	);
}

function OrderCard({
	order,
	onViewOrder,
	onResumeCheckout,
}: Readonly<{
	order: OrderDoc;
	onViewOrder: (orderId: Id<"orders">) => void;
	onResumeCheckout: (orderId: Id<"orders">) => void;
}>) {
	const { t, i18n } = useTranslation();
	const meta = getStatusMeta(order, t);
	const Icon = meta.icon;

	const handleClick = () => {
		if (meta.action === "resume-checkout") onResumeCheckout(order._id);
		else onViewOrder(order._id);
	};

	return (
		<button
			onClick={handleClick}
			className="w-full text-left flex items-center gap-3 p-4 rounded-xl transition-colors hover:bg-(--bg-hover) bg-muted border border-border"
			
		>
			<div
				className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
				style={{backgroundColor: meta.iconBg}}
			>
				<Icon size={18} style={{color: meta.iconColor}} />
			</div>

			<div className="flex-1 min-w-0">
				<div className="flex items-center justify-between gap-2">
					<span className="text-sm font-semibold text-foreground flex items-center gap-2 min-w-0" >
						{order.dailyOrderNumber != null && (
							<span className="tabular-nums shrink-0 text-foreground">
								{t(OrderingKeys.ORDERS_DAY_NUMBER, { n: order.dailyOrderNumber })}
							</span>
						)}
						<span className="truncate">{meta.label}</span>
					</span>
					<span className="text-sm font-semibold text-foreground" >
						${formatCents(order.totalAmount)}
					</span>
				</div>
				<div className="flex items-center justify-between mt-1">
					<span className="text-xs text-faint-foreground" >
						{formatTime(order._creationTime, t, i18n.language)}
					</span>
					<span className="text-xs font-medium text-primary" >
						{meta.actionLabel} →
					</span>
				</div>
			</div>
		</button>
	);
}
