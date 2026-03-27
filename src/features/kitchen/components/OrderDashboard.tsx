import { EmptyState, LoadingState, StatusBadge } from "@/global/components";
import type { Id } from "convex/_generated/dataModel";
import { CheckCircle2, ChefHat, CreditCard, UtensilsCrossed, XCircle } from "lucide-react";
import { useOrders } from "../hooks/useOrders";

interface OrderDashboardProps {
	restaurantId: Id<"restaurants">;
}

const STATUS_CONFIG: Record<
	string,
	{ label: string; next: string | null; nextLabel: string; color: string }
> = {
	submitted: {
		label: "New",
		next: "preparing",
		nextLabel: "Start Preparing",
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
	served: {
		label: "Served",
		next: "paid",
		nextLabel: "Mark Paid",
		color: "var(--accent-secondary, #7c3aed)",
	},
};

export function OrderDashboard({ restaurantId }: Readonly<OrderDashboardProps>) {
	const { orders, isLoading, updateStatus } = useOrders(restaurantId);

	if (isLoading) {
		return <LoadingState message="Loading orders..." className="p-4" />;
	}

	const sorted = [...orders].sort((a: any, b: any) => {
		const statusOrder = ["submitted", "preparing", "ready", "served"];
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
							</div>
							<span className="text-xs" style={{ color: "var(--text-muted)" }}>
								${(order.totalAmount / 100).toFixed(2)}
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

						<div className="px-4 pb-4 flex gap-2">
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
									{config.next === "paid" && <CreditCard size={14} />}
									{config.nextLabel}
								</button>
							)}
							{(order.status === "submitted" || order.status === "served") && (
								<button
									onClick={() => updateStatus({ orderId: order._id, newStatus: "cancelled" })}
									className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm"
									style={{
										border: "1px solid var(--border-default)",
										color: "var(--accent-danger)",
									}}
								>
									<XCircle size={14} />
									Cancel
								</button>
							)}
						</div>
					</div>
				);
			})}
		</div>
	);
}
