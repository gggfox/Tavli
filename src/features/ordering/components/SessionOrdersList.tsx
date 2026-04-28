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

function getStatusMeta(order: OrderDoc): StatusMeta {
	if (order.status === "draft") {
		if (order.paymentState === "failed") {
			return {
				label: "Payment failed",
				action: "resume-checkout",
				actionLabel: "Try again",
				icon: XCircle,
				iconColor: "var(--accent-danger, #dc2626)",
				iconBg: "rgba(220, 38, 38, 0.12)",
			};
		}
		if (order.paymentState === "processing" || order.paymentState === "pending") {
			return {
				label: "Payment processing",
				action: "view-order",
				actionLabel: "View",
				icon: CreditCard,
				iconColor: "var(--btn-primary-bg)",
				iconBg: "rgba(35, 131, 226, 0.12)",
			};
		}
		return {
			label: "Unpaid",
			action: "resume-checkout",
			actionLabel: "Finish checkout",
			icon: CreditCard,
			iconColor: "var(--accent-warning, #d97706)",
			iconBg: "rgba(217, 119, 6, 0.12)",
		};
	}

	switch (order.status) {
		case "submitted":
			return {
				label: "Order placed",
				action: "view-order",
				actionLabel: "View",
				icon: Clock,
				iconColor: "var(--btn-primary-bg)",
				iconBg: "rgba(35, 131, 226, 0.12)",
			};
		case "preparing":
			return {
				label: "Preparing",
				action: "view-order",
				actionLabel: "View",
				icon: ChefHat,
				iconColor: "var(--btn-primary-bg)",
				iconBg: "rgba(35, 131, 226, 0.12)",
			};
		case "ready":
			return {
				label: "Ready",
				action: "view-order",
				actionLabel: "View",
				icon: CheckCircle2,
				iconColor: "var(--accent-success, #059669)",
				iconBg: "rgba(5, 150, 105, 0.12)",
			};
		case "served":
			return {
				label: "Served",
				action: "view-order",
				actionLabel: "View",
				icon: UtensilsCrossed,
				iconColor: "var(--text-muted)",
				iconBg: "var(--bg-secondary)",
			};
		case "cancelled":
			return {
				label: "Cancelled",
				action: "view-order",
				actionLabel: "View",
				icon: XCircle,
				iconColor: "var(--accent-danger, #dc2626)",
				iconBg: "rgba(220, 38, 38, 0.12)",
			};
	}
}

function formatTime(timestamp: number): string {
	const now = Date.now();
	const diffMs = now - timestamp;
	const diffMin = Math.floor(diffMs / 60_000);
	if (diffMin < 1) return "Just now";
	if (diffMin < 60) return `${diffMin}m ago`;
	const diffHr = Math.floor(diffMin / 60);
	if (diffHr < 24) return `${diffHr}h ago`;
	return new Date(timestamp).toLocaleDateString();
}

export function SessionOrdersList({
	onBackToMenu,
	onViewOrder,
	onResumeCheckout,
}: Readonly<SessionOrdersListProps>) {
	const { sessionId } = useSessionStore();

	if (!sessionId) {
		return (
			<div className="flex flex-col h-full p-4">
				<Header onBackToMenu={onBackToMenu} />
				<div className="flex-1 flex items-center justify-center">
					<p className="text-sm" style={{ color: "var(--text-muted)" }}>
						No active session. Please return to the menu.
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
	return (
		<div className="flex items-center gap-3 mb-4">
			<button
				onClick={onBackToMenu}
				className="p-2 rounded-lg hover:bg-(--bg-hover)"
				aria-label="Back to menu"
			>
				<ArrowLeft size={20} style={{ color: "var(--text-primary)" }} />
			</button>
			<h2 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
				Your orders
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
						className="py-12 flex flex-col items-center gap-2 rounded-xl"
						style={{ backgroundColor: "var(--bg-secondary)" }}
					>
						<UtensilsCrossed size={32} style={{ color: "var(--text-muted)" }} />
						<p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
							No orders yet
						</p>
						<p className="text-xs text-center px-6" style={{ color: "var(--text-muted)" }}>
							Start an order from the menu to see it here.
						</p>
						<button
							onClick={onBackToMenu}
							className="mt-2 px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
						>
							Browse menu
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
	const meta = getStatusMeta(order);
	const Icon = meta.icon;

	const handleClick = () => {
		if (meta.action === "resume-checkout") onResumeCheckout(order._id);
		else onViewOrder(order._id);
	};

	return (
		<button
			onClick={handleClick}
			className="w-full text-left flex items-center gap-3 p-4 rounded-xl transition-colors hover:bg-(--bg-hover)"
			style={{
				backgroundColor: "var(--bg-secondary)",
				border: "1px solid var(--border-default)",
			}}
		>
			<div
				className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
				style={{ backgroundColor: meta.iconBg }}
			>
				<Icon size={18} style={{ color: meta.iconColor }} />
			</div>

			<div className="flex-1 min-w-0">
				<div className="flex items-center justify-between gap-2">
					<span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
						{meta.label}
					</span>
					<span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
						${formatCents(order.totalAmount)}
					</span>
				</div>
				<div className="flex items-center justify-between mt-1">
					<span className="text-xs" style={{ color: "var(--text-muted)" }}>
						{formatTime(order._creationTime)}
					</span>
					<span className="text-xs font-medium" style={{ color: "var(--btn-primary-bg)" }}>
						{meta.actionLabel} →
					</span>
				</div>
			</div>
		</button>
	);
}
