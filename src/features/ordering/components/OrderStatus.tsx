import { formatCents } from "@/global/utils/money";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { CheckCircle2, ChefHat, Clock, UtensilsCrossed } from "lucide-react";

interface OrderStatusProps {
	orderId: Id<"orders">;
	onBackToMenu: () => void;
}

const STATUS_STEPS = [
	{ key: "submitted", label: "Order Placed", icon: Clock },
	{ key: "preparing", label: "Preparing", icon: ChefHat },
	{ key: "ready", label: "Ready", icon: CheckCircle2 },
	{ key: "served", label: "Served", icon: UtensilsCrossed },
] as const;

const STATUS_ORDER = ["submitted", "preparing", "ready", "served"];

export function OrderStatus({ orderId, onBackToMenu }: Readonly<OrderStatusProps>) {
	const { data: orderData } = useQuery(convexQuery(api.orders.getOrderWithItems, { orderId }));

	if (!orderData) {
		return (
			<div className="p-4 flex items-center justify-center h-full">
				<p style={{ color: "var(--text-muted)" }}>Loading order...</p>
			</div>
		);
	}

	const currentIndex = STATUS_ORDER.indexOf(orderData.status);

	return (
		<div className="flex flex-col h-full p-4 space-y-8">
			<div className="text-center">
				<h2 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
					Order Status
				</h2>
				<p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
					${formatCents(orderData.totalAmount)} &middot; {orderData.items.length} items
				</p>
			</div>

			{orderData.status === "cancelled" ? (
				<div className="text-center py-8">
					<p className="text-lg font-semibold" style={{ color: "var(--accent-danger)" }}>
						Order Cancelled
					</p>
				</div>
			) : (
				<div className="space-y-4 max-w-xs mx-auto w-full">
					{STATUS_STEPS.map((step, i) => {
						const isComplete = currentIndex >= i;
						const isCurrent = currentIndex === i;
						const Icon = step.icon;
						return (
							<div key={step.key} className="flex items-center gap-4">
								<div
									className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
									style={{
										backgroundColor: isComplete ? "var(--btn-primary-bg)" : "var(--bg-secondary)",
										border: isCurrent
											? "2px solid var(--btn-primary-bg)"
											: "1px solid var(--border-default)",
									}}
								>
									<Icon size={18} style={{ color: isComplete ? "white" : "var(--text-muted)" }} />
								</div>
								<span
									className={`text-sm ${isCurrent ? "font-semibold" : ""}`}
									style={{ color: isComplete ? "var(--text-primary)" : "var(--text-muted)" }}
								>
									{step.label}
								</span>
							</div>
						);
					})}
				</div>
			)}

			{/* Items summary */}
			<div className="space-y-2">
				<h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
					Items
				</h3>
				{orderData.items.map((item) => (
					<div
						key={item._id}
						className="flex justify-between text-sm"
						style={{ color: "var(--text-secondary)" }}
					>
						<span>
							{item.quantity}x {item.menuItemName}
						</span>
						<span>${formatCents(item.lineTotal)}</span>
					</div>
				))}
			</div>

			<button
				onClick={onBackToMenu}
				className="w-full py-3 rounded-xl text-sm font-medium"
				style={{ border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
			>
				Order More
			</button>
		</div>
	);
}
