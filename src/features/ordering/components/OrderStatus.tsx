import { OrderingKeys } from "@/global/i18n";
import { useFormatMoney } from "@/global/hooks/useFormatMoney";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { ORDER_STATUS, PLATFORM_APPLICATION_FEE_RATE } from "convex/constants";
import { CheckCircle2, ChefHat, Clock, CreditCard, UtensilsCrossed } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmailReceiptButton } from "./EmailReceiptButton";
import { OrderNotFound } from "./OrderNotFound";

/** Customer-borne service-fee rate as a display percentage (e.g. 12). */
const SERVICE_FEE_PERCENT = PLATFORM_APPLICATION_FEE_RATE * 100;

interface OrderStatusProps {
	orderId: Id<"orders">;
	onBackToMenu: () => void;
	/** The diner's orders list — the way out of a not-found order. */
	onViewOrders: () => void;
	/** The per-order checkout, for a round that has not been paid yet. */
	onContinueToPayment: () => void;
}

const STATUS_STEPS = [
	{ key: "submitted", labelKey: OrderingKeys.ORDER_STATUS_STEP_PLACED, icon: Clock },
	{ key: "preparing", labelKey: OrderingKeys.ORDER_STATUS_STEP_PREPARING, icon: ChefHat },
	{ key: "ready", labelKey: OrderingKeys.ORDER_STATUS_STEP_READY, icon: CheckCircle2 },
	{ key: "served", labelKey: OrderingKeys.ORDER_STATUS_STEP_SERVED, icon: UtensilsCrossed },
] as const;

const STATUS_ORDER = ["submitted", "preparing", "ready", "served"];

export function OrderStatus({
	orderId,
	onBackToMenu,
	onViewOrders,
	onContinueToPayment,
}: Readonly<OrderStatusProps>) {
	const formatMoney = useFormatMoney();
	const { t } = useTranslation();
	const { data: orderData, isError } = useQuery({
		...convexQuery(api.orders.getOrderWithItems, { orderId }),
		// A Convex query error is an answer, not a blip: an id the validator
		// rejects fails the same way every time. Retrying only stretches the
		// spinner by the backoff before the not-found screen.
		retry: false,
	});

	// `undefined` is loading; `null` is the query's answer for an order that
	// does not exist or is not this diner's. Treating both as "loading" was an
	// infinite spinner on every stale or shared link.
	if (orderData === null || (orderData === undefined && isError)) {
		return <OrderNotFound onBackToMenu={onBackToMenu} onViewOrders={onViewOrders} />;
	}

	if (orderData === undefined) {
		return (
			<div className="p-4 flex items-center justify-center h-full text-faint-foreground">
				<p>{t(OrderingKeys.ORDER_STATUS_LOADING)}</p>
			</div>
		);
	}

	// Not placed yet: a draft the diner has not paid, or a round committed to
	// pay at the table. The kitchen has not seen either, so the stepper would
	// be four grey circles with no way forward — the way forward is checkout.
	const awaitingPlacement =
		orderData.status === ORDER_STATUS.DRAFT || orderData.status === ORDER_STATUS.AWAITING_PAYMENT;

	const currentIndex = STATUS_ORDER.indexOf(orderData.status);
	// Removed lines are still listed below, but the diner is neither charged for
	// them nor waiting on them, so they do not count toward the order.
	const liveItemCount = orderData.items.filter((item) => item.cancelledAt === undefined).length;

	// Paid breakdown shows what was ACTUALLY charged — the payment row's
	// subtotal/fee split, never the rate re-applied client-side. Cash orders
	// (paid in person, no payment row) fall back to the order total with no fee
	// line: cash carries no Tavli service fee (ADR 008).
	//
	// Gated on the succeeded charge, not on `paymentState === "paid"`: removing
	// an order's last live line refunds the whole charge and leaves the order
	// `cancelled` / `refunded` (ADR 013), and a diner whose money has just come
	// back is exactly the one who needs to see what was charged and what was
	// returned. `paidPayment` is the succeeded kind-"order" payment and survives
	// a refund — refunds patch `refundStatus`, never `status`. The
	// `paymentState` half of the test keeps cash orders (no payment row) showing
	// their subtotal-only breakdown.
	const isPaid = orderData.paidPayment !== null || orderData.paymentState === "paid";
	const chargedSubtotal = orderData.paidPayment?.subtotalAmount ?? orderData.totalAmount;
	const chargedFee = orderData.paidPayment?.feeAmount ?? 0;
	const chargedTotal = orderData.paidPayment?.amount ?? chargedSubtotal + chargedFee;
	// What has already come back for lines the restaurant could not make
	// (ADR 013). The total above stays the amount PAID; the refund is its own
	// line, so the diner can reconcile both against their card statement rather
	// than seeing a total silently shrink.
	const refundedTotal = orderData.items.reduce((sum, item) => sum + (item.refundAmount ?? 0), 0);

	// The page scrolls itself: the customer layout clips its outlet
	// (`overflow-hidden`), so a long order used to push "Order more" out of
	// reach. The actions live in a sticky footer (below) so they stay on screen
	// however many lines the order has.
	return (
		<div className="flex flex-col h-full overflow-y-auto p-4 space-y-8">
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
						total: formatMoney(orderData.totalAmount),
						count: liveItemCount,
					})}
				</p>
			</div>

			{awaitingPlacement ? (
				<p className="text-sm text-center max-w-xs mx-auto text-muted-foreground">
					{orderData.status === ORDER_STATUS.DRAFT
						? t(OrderingKeys.ORDER_STATUS_UNPAID_NOTE)
						: t(OrderingKeys.CHECKOUT_CASH_KITCHEN_NOTE)}
				</p>
			) : orderData.status === "cancelled" ? (
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
					// The kitchen or bar ran out and staff removed the line. It stays
					// visible so the diner can see what happened to something they
					// ordered — and, on a paid order, that the money came back
					// (ADR 013). It is no longer part of what they owe.
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
									? t(OrderingKeys.ORDER_ITEM_UNAVAILABLE_REFUNDED)
									: t(OrderingKeys.ORDER_ITEM_UNAVAILABLE)}
							</span>
						</div>
					) : (
						<div key={item._id} className="flex justify-between text-sm text-muted-foreground">
							<span>
								{item.quantity}x {item.menuItemName}
							</span>
							<span>{formatMoney(item.lineTotal)}</span>
						</div>
					)
				)}

				{isPaid && (
					<>
						<div className="flex justify-between pt-2 text-sm border-t border-border text-muted-foreground">
							<span>{t(OrderingKeys.CHECKOUT_SUBTOTAL)}</span>
							<span>{formatMoney(chargedSubtotal)}</span>
						</div>
						{chargedFee > 0 && (
							<div className="flex justify-between text-sm text-muted-foreground">
								<span>{t(OrderingKeys.CHECKOUT_SERVICE_FEE, { rate: SERVICE_FEE_PERCENT })}</span>
								<span>{formatMoney(chargedFee)}</span>
							</div>
						)}
						<div className="flex justify-between pt-2 text-sm font-semibold border-t border-border text-foreground">
							<span>{t(OrderingKeys.CHECKOUT_TOTAL)}</span>
							<span>{formatMoney(chargedTotal)}</span>
						</div>
						{refundedTotal > 0 && (
							<div className="flex justify-between text-sm text-muted-foreground">
								<span>{t(OrderingKeys.ORDER_STATUS_REFUNDED_LINE)}</span>
								<span>{formatMoney(-refundedTotal)}</span>
							</div>
						)}
					</>
				)}
			</div>

			{isPaid && <EmailReceiptButton orderId={orderId} />}

			{/* `mt-auto` pins the footer to the bottom of a short order; `sticky`
			    keeps it on screen over a long one. The negative margins let its
			    background span the page padding so lines scroll under it, not
			    through it. */}
			<div className="sticky bottom-0 mt-auto -mx-4 -mb-4 px-4 pt-3 space-y-2 border-t border-border bg-background pb-[max(1rem,env(safe-area-inset-bottom))]">
				{awaitingPlacement && (
					<button
						type="button"
						onClick={onContinueToPayment}
						className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold hover-btn-primary"
					>
						<CreditCard size={16} />
						{t(OrderingKeys.CHECKOUT_CONTINUE_TO_PAYMENT)}
					</button>
				)}
				<button
					type="button"
					onClick={onBackToMenu}
					className="w-full py-3 rounded-xl text-sm font-medium border border-border text-foreground"
				>
					{t(OrderingKeys.ORDER_STATUS_ORDER_MORE)}
				</button>
			</div>
		</div>
	);
}
