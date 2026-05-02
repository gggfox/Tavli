import { OrderingKeys } from "@/global/i18n";
import { formatCents } from "@/global/utils/money";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { CheckCircle2, ChefHat, Clock, UtensilsCrossed } from "lucide-react";
import { useTranslation } from "react-i18next";

interface OrderStatusProps {
	orderId: Id<"orders">;
	onBackToMenu: () => void;
}

const STATUS_STEPS = [
	{ key: "submitted", labelKey: OrderingKeys.ORDER_STATUS_STEP_PLACED, icon: Clock },
	{ key: "preparing", labelKey: OrderingKeys.ORDER_STATUS_STEP_PREPARING, icon: ChefHat },
	{ key: "ready", labelKey: OrderingKeys.ORDER_STATUS_STEP_READY, icon: CheckCircle2 },
	{ key: "served", labelKey: OrderingKeys.ORDER_STATUS_STEP_SERVED, icon: UtensilsCrossed },
] as const;

const STATUS_ORDER = ["submitted", "preparing", "ready", "served"];

export function OrderStatus({ orderId, onBackToMenu }: Readonly<OrderStatusProps>) {
	const { t } = useTranslation();
	const { data: orderData } = useQuery(convexQuery(api.orders.getOrderWithItems, { orderId }));

	if (!orderData) {
		return (
			<div className="p-4 flex items-center justify-center h-full text-faint-foreground">
				<p >{t(OrderingKeys.ORDER_STATUS_LOADING)}</p>
			</div>
		);
	}

	const currentIndex = STATUS_ORDER.indexOf(orderData.status);

	return (
		<div className="flex flex-col h-full p-4 space-y-8">
			<div className="text-center">
				<h2 className="text-xl font-bold text-foreground" >
					{t(OrderingKeys.ORDER_STATUS_HEADING)}
				</h2>
				{orderData.dailyOrderNumber != null && (
					<p className="text-base font-semibold tabular-nums mt-1 text-foreground" >
						{t(OrderingKeys.ORDER_STATUS_DAY_NUMBER, { n: orderData.dailyOrderNumber })}
					</p>
				)}
				<p className="text-sm mt-1 text-faint-foreground" >
					{t(OrderingKeys.ORDER_STATUS_SUMMARY, {
						total: formatCents(orderData.totalAmount),
						count: orderData.items.length,
					})}
				</p>
			</div>

			{orderData.status === "cancelled" ? (
				<div className="text-center py-8">
					<p className="text-lg font-semibold text-destructive" >
						{t(OrderingKeys.ORDER_STATUS_CANCELLED)}
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
									style={{backgroundColor: isComplete ? "var(--btn-primary-bg)" : "var(--bg-secondary)",
				border: isCurrent
											? "2px solid var(--btn-primary-bg)"
											: "1px solid var(--border-default)"}}
								>
									<Icon size={18} style={{color: isComplete ? "white" : "var(--text-muted)"}} />
								</div>
								<span
									className={`text-sm ${isCurrent ? "font-semibold" : ""}`}
									style={{color: isComplete ? "var(--text-primary)" : "var(--text-muted)"}}
								>
									{t(step.labelKey)}
								</span>
							</div>
						);
					})}
				</div>
			)}

			<div className="space-y-2">
				<h3 className="text-sm font-semibold text-foreground" >
					{t(OrderingKeys.ORDER_STATUS_ITEMS)}
				</h3>
				{orderData.items.map((item) => (
					<div
						key={item._id}
						className="flex justify-between text-sm text-muted-foreground"
						
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
				className="w-full py-3 rounded-xl text-sm font-medium border border-border text-foreground"
				
			>
				{t(OrderingKeys.ORDER_STATUS_ORDER_MORE)}
			</button>
		</div>
	);
}
