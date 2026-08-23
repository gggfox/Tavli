import { OrderingKeys } from "@/global/i18n";
import { formatCents } from "@/global/utils/money";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { PLATFORM_APPLICATION_FEE_RATE } from "convex/constants";
import { CheckCircle2, ChefHat, Clock, UtensilsCrossed } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmailReceiptButton } from "./EmailReceiptButton";

/** Customer-borne service-fee rate as a display percentage (e.g. 12). */
const SERVICE_FEE_PERCENT = PLATFORM_APPLICATION_FEE_RATE * 100;

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
				<p>{t(OrderingKeys.ORDER_STATUS_LOADING)}</p>
			</div>
		);
	}

	const currentIndex = STATUS_ORDER.indexOf(orderData.status);
	// 86'd lines are still listed below, but the diner is neither charged for
	// them nor waiting on them, so they do not count toward the order.
	const liveItemCount = orderData.items.filter((item) => item.cancelledAt === undefined).length;

	// Paid breakdown shows what was ACTUALLY charged — the payment row's
	// subtotal/fee split, never the rate re-applied client-side. Cash orders
	// (paid in person, no payment row) fall back to the order total with no fee
	// line: cash carries no Tavli service fee (ADR 008).
	const isPaid = orderData.paymentState === "paid";
	const chargedSubtotal = orderData.paidPayment?.subtotalAmount ?? orderData.totalAmount;
	const chargedFee = orderData.paidPayment?.feeAmount ?? 0;
	const chargedTotal = orderData.paidPayment?.amount ?? chargedSubtotal + chargedFee;

	return (
		<div className="flex flex-col h-full p-4 space-y-8">
			<div className="text-center">
				<h2 className="text-xl font-bold text-foreground">
					{t(OrderingKeys.ORDER_STATUS_HEADING)}
				</h2>
				{orderData.dailyOrderNumber != null && (
					<p className="text-base font-semibold tabular-nums mt-1 text-foreground">
						{t(OrderingKeys.ORDER_STATUS_DAY_NUMBER, { n: orderData.dailyOrderNumber })}
					</p>
				)}
				<p className="text-sm mt-1 text-faint-foreground">
					{t(OrderingKeys.ORDER_STATUS_SUMMARY, {
						total: formatCents(orderData.totalAmount),
						count: liveItemCount,
					})}
				</p>
			</div>

			{orderData.status === "cancelled" ? (
				<div className="text-center py-8">
					<p className="text-lg font-semibold text-destructive">
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
									{t(step.labelKey)}
								</span>
							</div>
						);
					})}
				</div>
			)}

			<div className="space-y-2">
				<h3 className="text-sm font-semibold text-foreground">
					{t(OrderingKeys.ORDER_STATUS_ITEMS)}
				</h3>
				{orderData.items.map((item) =>
					// The kitchen or bar ran out. The line stays visible so the diner
					// can see what happened to something they ordered, but it is no
					// longer part of what they owe.
					item.cancelledAt !== undefined ? (
						<div
							key={item._id}
							className="flex justify-between text-sm text-faint-foreground"
							style={{ opacity: 0.6 }}
						>
							<span className="line-through">
								{item.quantity}x {item.menuItemName}
							</span>
							<span>
								{item.refundedAt !== undefined
									? t(OrderingKeys.RECEIPT_ITEM_REFUNDED)
									: t(OrderingKeys.ORDER_ITEM_UNAVAILABLE)}
							</span>
						</div>
					) : (
						<div key={item._id} className="flex justify-between text-sm text-muted-foreground">
							<span>
								{item.quantity}x {item.menuItemName}
							</span>
							<span>${formatCents(item.lineTotal)}</span>
						</div>
					)
				)}

				{isPaid && (
					<>
						<div className="flex justify-between pt-2 text-sm border-t border-border text-muted-foreground">
							<span>{t(OrderingKeys.CHECKOUT_SUBTOTAL)}</span>
							<span>${formatCents(chargedSubtotal)}</span>
						</div>
						{chargedFee > 0 && (
							<div className="flex justify-between text-sm text-muted-foreground">
								<span>{t(OrderingKeys.CHECKOUT_SERVICE_FEE, { rate: SERVICE_FEE_PERCENT })}</span>
								<span>${formatCents(chargedFee)}</span>
							</div>
						)}
						<div className="flex justify-between pt-2 text-sm font-semibold border-t border-border text-foreground">
							<span>{t(OrderingKeys.CHECKOUT_TOTAL)}</span>
							<span>${formatCents(chargedTotal)}</span>
						</div>
					</>
				)}
			</div>

			{isPaid && <EmailReceiptButton orderId={orderId} />}

			<button
				onClick={onBackToMenu}
				className="w-full py-3 rounded-xl text-sm font-medium border border-border text-foreground"
			>
				{t(OrderingKeys.ORDER_STATUS_ORDER_MORE)}
			</button>
		</div>
	);
}
