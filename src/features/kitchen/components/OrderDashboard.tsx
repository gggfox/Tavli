import { EmptyState, LoadingState, StatusBadge } from "@/global/components";
import { formatCents } from "@/global/utils/money";
import type { Id } from "convex/_generated/dataModel";
import {
	AlertTriangle,
	CheckCircle2,
	ChefHat,
	CreditCard,
	UtensilsCrossed,
	XCircle,
} from "lucide-react";
import { useState } from "react";
import { useOrders } from "../hooks/useOrders";

interface OrderDashboardProps {
	restaurantId: Id<"restaurants">;
}

const STATUS_CONFIG: Record<
	string,
	{ label: string; next: string | null; nextLabel: string; color: string }
> = {
	submitted: {
		label: "Pending",
		next: "preparing",
		nextLabel: "Accept Order",
		color: "var(--accent-warning, #d97706)",
	},
	preparing: {
		label: "Preparing",
		next: "ready",
		nextLabel: "Mark Ready",
		color: "var(--btn-primary-bg)",
	},
	ready: {
		label: "Ready",
		next: "served",
		nextLabel: "Mark Served",
		color: "var(--accent-success, #16a34a)",
	},
};

export function OrderDashboard({ restaurantId }: Readonly<OrderDashboardProps>) {
	const { orders, isLoading, error, updateStatus } = useOrders(restaurantId);
	const [cancelConfirm, setCancelConfirm] = useState<string | null>(null);

	if (isLoading) {
		return <LoadingState message="Loading orders..." className="p-4" />;
	}

	if (error) {
		return (
			<EmptyState
				icon={AlertTriangle}
				title="Could not load orders."
				description={error.message ?? "Please check your permissions and try again."}
			/>
		);
	}

	const sorted = [...orders].sort((a: any, b: any) => {
		const statusOrder = ["submitted", "preparing", "ready"];
		return (
			statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status) || a.createdAt - b.createdAt
		);
	});

	if (sorted.length === 0) {
		return <EmptyState icon={ChefHat} title="No active orders right now." />;
	}

	return (
		<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
			{sorted.map((order: any) => {
				const config = STATUS_CONFIG[order.status];
				if (!config) return null;

				return (
					<div
						key={order._id}
						className="rounded-xl overflow-hidden"
						style={{
							border: "1px solid var(--border-default)",
							backgroundColor: "var(--bg-secondary)",
						}}
					>
						<div
							className="px-4 py-3 flex items-center justify-between"
							style={{ borderBottom: "1px solid var(--border-default)" }}
						>
							<div className="flex items-center gap-2">
								<StatusBadge bgColor={config.color} textColor="white" label={config.label} />
								<span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
									Table {order.tableNumber}
								</span>
								{order.paidAt && (
									<span
										className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full"
										style={{ backgroundColor: "var(--accent-success)", color: "white" }}
									>
										<CreditCard size={10} />
										Paid
									</span>
								)}
							</div>
							<span className="text-xs" style={{ color: "var(--text-muted)" }}>
								${formatCents(order.totalAmount)}
							</span>
						</div>

						<div className="p-4 space-y-2">
							{order.items.map((item: any) => (
								<div key={item._id} className="text-sm" style={{ color: "var(--text-primary)" }}>
									<span className="font-medium">{item.quantity}x</span> {item.menuItemName}
									{item.selectedOptions.length > 0 && (
										<span className="text-xs ml-1" style={{ color: "var(--text-muted)" }}>
											({item.selectedOptions.map((o: any) => o.optionName).join(", ")})
										</span>
									)}
									{item.specialInstructions && (
										<p className="text-xs italic" style={{ color: "var(--accent-warning)" }}>
											{item.specialInstructions}
										</p>
									)}
								</div>
							))}
						</div>

						<div className="px-4 pb-4 space-y-2">
							{cancelConfirm === order._id ? (
								<div
									className="p-3 rounded-lg space-y-2"
									style={{
										backgroundColor: "rgba(220, 38, 38, 0.05)",
										border: "1px solid rgba(220, 38, 38, 0.2)",
									}}
								>
									<p className="text-xs font-medium" style={{ color: "var(--accent-danger)" }}>
										{order.stripePaymentIntentId
											? "This order has been paid. Cancelling will issue a refund."
											: "Cancel this order?"}
									</p>
									<div className="flex gap-2">
										<button
											onClick={() => {
												updateStatus({ orderId: order._id, newStatus: "cancelled" });
												setCancelConfirm(null);
											}}
											className="flex-1 py-1.5 rounded-lg text-xs font-medium"
											style={{ backgroundColor: "var(--accent-danger)", color: "white" }}
										>
											{order.stripePaymentIntentId ? "Cancel & Refund" : "Confirm Cancel"}
										</button>
										<button
											onClick={() => setCancelConfirm(null)}
											className="flex-1 py-1.5 rounded-lg text-xs font-medium"
											style={{
												border: "1px solid var(--border-default)",
												color: "var(--text-secondary)",
											}}
										>
											Keep Order
										</button>
									</div>
								</div>
							) : (
								<div className="flex gap-2">
									{config.next && (
										<button
											onClick={() =>
												updateStatus({ orderId: order._id, newStatus: config.next as any })
											}
											className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-sm font-medium hover-btn-primary"
										>
											{config.next === "preparing" && <ChefHat size={14} />}
											{config.next === "ready" && <CheckCircle2 size={14} />}
											{config.next === "served" && <UtensilsCrossed size={14} />}
											{config.nextLabel}
										</button>
									)}
									<button
										onClick={() => setCancelConfirm(order._id)}
										className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm"
										style={{
											border: "1px solid var(--border-default)",
											color: "var(--accent-danger)",
										}}
									>
										<XCircle size={14} />
										Cancel
									</button>
								</div>
							)}
						</div>
					</div>
				);
			})}
		</div>
	);
}
