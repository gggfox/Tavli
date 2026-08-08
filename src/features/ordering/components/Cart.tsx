import { EmptyState } from "@/global/components";
import { localizeName, OrderingKeys } from "@/global/i18n";
import { formatCents } from "@/global/utils/money";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { ArrowLeft, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CartSkeleton } from "./CartSkeleton";

interface CartProps {
	orderId: Id<"orders">;
	onBack: () => void;
	onSubmit: () => void;
	onRemoveItem: (orderItemId: Id<"orderItems">) => void;
}

/**
 * The diner's draft-order review step.
 *
 * ADR 008 note: there is deliberately no busy/`isSubmitting` state here. Under
 * the tab model this button ran `orders.submitOrder` and needed a "Placing
 * order…" label while the mutation was in flight; pay-at-submit turned it into
 * a client-side route change to the per-order checkout, which has nothing to
 * wait on. The spinner now lives on the checkout's own pay buttons.
 */
export function Cart({ orderId, onBack, onSubmit, onRemoveItem }: Readonly<CartProps>) {
	const { t, i18n } = useTranslation();
	const { data: orderData } = useQuery(convexQuery(api.orders.getOrderWithItems, { orderId }));

	if (!orderData) {
		return <CartSkeleton onBack={onBack} />;
	}

	const { items, totalAmount } = orderData;

	return (
		<div className="flex flex-col h-full">
			<div className="flex-1 overflow-y-auto p-4 space-y-4">
				<button onClick={onBack} className="flex items-center gap-1 text-sm text-primary">
					<ArrowLeft size={16} /> {t(OrderingKeys.CART_BACK)}
				</button>

				<h2 className="text-xl font-bold text-foreground">{t(OrderingKeys.CART_HEADING)}</h2>

				{items.length === 0 ? (
					<EmptyState variant="inline" title={t(OrderingKeys.CART_EMPTY)} className="py-8" />
				) : (
					<div className="space-y-3">
						{items.map((item) => (
							<div
								key={item._id}
								className="flex items-start justify-between px-4 py-3 rounded-xl bg-muted"
							>
								<div className="flex-1">
									<div className="flex items-center gap-2">
										<span className="text-sm font-medium text-foreground">
											{item.quantity}x {item.menuItemName}
										</span>
									</div>
									{item.selectedOptions.length > 0 && (
										<div className="text-xs mt-1 text-faint-foreground">
											{item.selectedOptions
												.map((o) => localizeName(o.optionName, undefined, i18n.language))
												.join(", ")}
										</div>
									)}
									{item.specialInstructions && (
										<div className="text-xs mt-0.5 italic text-faint-foreground">
											{item.specialInstructions}
										</div>
									)}
								</div>
								<div className="flex items-center gap-2">
									<span className="text-sm font-medium text-foreground">
										${formatCents(item.lineTotal)}
									</span>
									<button
										onClick={() => onRemoveItem(item._id)}
										className="p-1 rounded hover:bg-hover text-destructive"
									>
										<Trash2 size={14} />
									</button>
								</div>
							</div>
						))}
					</div>
				)}
			</div>

			{items.length > 0 && (
				<div className="px-4 pb-4 pt-3 space-y-3 border-t border-border">
					<div className="flex justify-between text-base font-semibold text-foreground">
						<span>{t(OrderingKeys.CART_TOTAL)}</span>
						<span>${formatCents(totalAmount)}</span>
					</div>
					<button
						onClick={onSubmit}
						className="w-full py-3 rounded-xl text-sm font-medium hover-btn-primary"
					>
						{/* ADR 008: the draft heads to the per-order checkout, not the kitchen. */}
						{t(OrderingKeys.CHECKOUT_CONTINUE_TO_PAYMENT)}
					</button>
				</div>
			)}
		</div>
	);
}
