import { Tooltip } from "@/global/components";
import { CommonKeys, localizeName, PaymentsKeys } from "@/global/i18n";
import { formatCents } from "@/global/utils/money";
import type { Doc } from "convex/_generated/dataModel";
import { useTranslation } from "react-i18next";

type LiveNameDescriptionTranslations = Record<string, { name?: string; description?: string }>;

export type PaymentsOrderItem = Doc<"orderItems"> & {
	readonly menuItemTranslations?: LiveNameDescriptionTranslations;
};

export type PaymentsOrder = Doc<"orders"> & {
	readonly items: ReadonlyArray<PaymentsOrderItem>;
	readonly tableNumber: number;
};

/**
 * Renders the "N items" tooltip cell for the payments table. Hovering reveals
 * each line item with its quantity and localized name plus the order total.
 */
export function OrderItemsTooltipTrigger({ order }: Readonly<{ order: PaymentsOrder }>) {
	const { t, i18n } = useTranslation();
	const itemCount = order.items.reduce((n, item) => n + item.quantity, 0);
	const label = t(CommonKeys.ITEMS_COUNT, { count: itemCount });

	return (
		<Tooltip
			content={
				<div className="space-y-2">
					<ul className="space-y-1 list-none p-0 m-0">
						{order.items.map((item) => (
							<li
								key={item._id}
								className="flex items-baseline justify-between gap-3 text-foreground"
							>
								<span className="text-faint-foreground">{item.quantity}×</span>
								<span className="flex-1">
									{localizeName(item.menuItemName, item.menuItemTranslations, i18n.language)}
								</span>
							</li>
						))}
					</ul>
					<div className="flex items-baseline justify-between gap-3 pt-1.5 mt-1 font-medium border-t border-border text-foreground">
						<span className="text-faint-foreground">{t(PaymentsKeys.TOOLTIP_TOTAL)}</span>
						<span>${formatCents(order.totalAmount)}</span>
					</div>
				</div>
			}
		>
			<button
				type="button"
				className="bg-transparent p-0 cursor-help text-muted-foreground"
				style={{
					textDecoration: "underline",
					textDecorationStyle: "dotted",
					textUnderlineOffset: "3px",
				}}
			>
				{label}
			</button>
		</Tooltip>
	);
}
