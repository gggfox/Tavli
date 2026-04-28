import { EmptyState } from "@/global/components";
import { formatCents } from "@/global/utils/money";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { ArrowLeft, Trash2 } from "lucide-react";
import { CartSkeleton } from "./CartSkeleton";

interface CartProps {
	orderId: Id<"orders">;
	onBack: () => void;
	onSubmit: () => void;
	onRemoveItem: (orderItemId: Id<"orderItems">) => void;
	isSubmitting: boolean;
}

export function Cart({
	orderId,
	onBack,
	onSubmit,
	onRemoveItem,
	isSubmitting,
}: Readonly<CartProps>) {
	const { data: orderData } = useQuery(convexQuery(api.orders.getOrderWithItems, { orderId }));

	if (!orderData) {
		return <CartSkeleton onBack={onBack} />;
	}

	const { items, totalAmount } = orderData;

	return (
		<div className="flex flex-col h-full">
			<div className="flex-1 overflow-y-auto p-4 space-y-4">
				<button
					onClick={onBack}
					className="flex items-center gap-1 text-sm"
					style={{ color: "var(--btn-primary-bg)" }}
				>
					<ArrowLeft size={16} /> Back to menu
				</button>

				<h2 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
					Your Order
				</h2>

				{items.length === 0 ? (
					<EmptyState
						variant="inline"
						title="Your cart is empty. Add some items!"
						className="py-8"
					/>
				) : (
					<div className="space-y-3">
						{items.map((item) => (
							<div
								key={item._id}
								className="flex items-start justify-between px-4 py-3 rounded-xl"
								style={{ backgroundColor: "var(--bg-secondary)" }}
							>
								<div className="flex-1">
									<div className="flex items-center gap-2">
										<span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
											{item.quantity}x {item.menuItemName}
										</span>
									</div>
									{item.selectedOptions.length > 0 && (
										<div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
											{item.selectedOptions.map((o) => o.optionName).join(", ")}
										</div>
									)}
									{item.specialInstructions && (
										<div className="text-xs mt-0.5 italic" style={{ color: "var(--text-muted)" }}>
											{item.specialInstructions}
										</div>
									)}
								</div>
								<div className="flex items-center gap-2">
									<span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
										${formatCents(item.lineTotal)}
									</span>
									<button
										onClick={() => onRemoveItem(item._id)}
										className="p-1 rounded hover:bg-[var(--bg-hover)]"
									>
										<Trash2 size={14} style={{ color: "var(--accent-danger)" }} />
									</button>
								</div>
							</div>
						))}
					</div>
				)}
			</div>

			{items.length > 0 && (
				<div
					className="px-4 pb-4 pt-3 space-y-3"
					style={{ borderTop: "1px solid var(--border-default)" }}
				>
					<div
						className="flex justify-between text-base font-semibold"
						style={{ color: "var(--text-primary)" }}
					>
						<span>Total</span>
						<span>${formatCents(totalAmount)}</span>
					</div>
					<button
						onClick={onSubmit}
						disabled={isSubmitting}
						className="w-full py-3 rounded-xl text-sm font-medium hover-btn-primary disabled:opacity-50"
					>
						{isSubmitting ? "Placing Order..." : "Place Order"}
					</button>
				</div>
			)}
		</div>
	);
}
