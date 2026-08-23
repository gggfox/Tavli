import { Tooltip } from "@/global/components";
import { CommonKeys, localizeName, PaymentsKeys } from "@/global/i18n";
import { formatCents } from "@/global/utils/money";
import { useTranslation } from "react-i18next";
import type { PaymentsLedgerRow } from "./types";

/**
 * Renders the "N items" tooltip cell for the payments ledger. Hovering reveals
 * each line item with its quantity and localized name plus the food subtotal.
 * Tip rows have no items, so they render an em dash instead.
 */
export function OrderItemsTooltipTrigger({ row }: Readonly<{ row: PaymentsLedgerRow }>) {
	const { t, i18n } = useTranslation();
	// A paid order can still carry lines that were 86'd while it was open.
	// They were never charged, so listing them here would not add up to the
	// subtotal right below.
	const chargedItems = row.items.filter((item) => item.cancelledAt === undefined);
	const itemCount = chargedItems.reduce((n, item) => n + item.quantity, 0);
	const label = t(CommonKeys.ITEMS_COUNT, { count: itemCount });

	if (chargedItems.length === 0) {
		return <span className="text-faint-foreground">—</span>;
	}

	return (
		<Tooltip
			content={
				<div className="space-y-2">
					<ul className="space-y-1 list-none p-0 m-0">
						{chargedItems.map((item) => (
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
						<span className="text-faint-foreground">{t(PaymentsKeys.TOOLTIP_SUBTOTAL)}</span>
						<span>${formatCents(row.subtotalCents)}</span>
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
