import { EmptyState } from "@/global/components";
import { OrderingKeys } from "@/global/i18n";
import { SearchX } from "lucide-react";
import { useTranslation } from "react-i18next";

interface OrderNotFoundProps {
	onBackToMenu: () => void;
	/** Omitted where there is no orders list to go back to. */
	onViewOrders?: () => void;
}

/**
 * The order behind this URL is not the diner's to see — it does not exist,
 * belongs to someone else, or the id is not an id at all.
 *
 * One screen for all three on purpose. `getOrderWithItems` already answers
 * `null` for both "missing" and "not yours" so the page cannot be used to
 * probe for other diners' orders, and a mangled link is the same dead end
 * from where the diner sits. What they need is the way out: their own orders,
 * or the menu.
 */
export function OrderNotFound({ onBackToMenu, onViewOrders }: Readonly<OrderNotFoundProps>) {
	const { t } = useTranslation();
	return (
		<div className="flex flex-col h-full p-4">
			<EmptyState
				icon={SearchX}
				title={t(OrderingKeys.ORDER_STATUS_NOT_FOUND_TITLE)}
				description={t(OrderingKeys.ORDER_STATUS_NOT_FOUND_DESC)}
				fill
				action={
					<div className="flex flex-col sm:flex-row items-center gap-2">
						{onViewOrders && (
							<button
								type="button"
								onClick={onViewOrders}
								className="px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
							>
								{t(OrderingKeys.CHECKOUT_VIEW_ORDERS)}
							</button>
						)}
						<button
							type="button"
							onClick={onBackToMenu}
							className="px-4 py-2 rounded-lg text-sm font-medium border border-border text-foreground hover:bg-(--bg-hover)"
						>
							{t(OrderingKeys.BACK_TO_MENU)}
						</button>
					</div>
				}
			/>
		</div>
	);
}
