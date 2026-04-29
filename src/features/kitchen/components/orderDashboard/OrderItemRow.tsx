import { localizeName, useLocalizedName } from "@/global/i18n";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { DashboardOrderItem } from "./statusConfig";

export function OrderItemRow({ item }: Readonly<{ item: DashboardOrderItem }>) {
	const { i18n } = useTranslation();
	const itemName = useLocalizedName(item.menuItemName, item.menuItemTranslations);
	const optionsLabel = useMemo(
		() =>
			item.selectedOptions
				.map((option) => localizeName(option.optionName, option.optionTranslations, i18n.language))
				.join(", "),
		[item.selectedOptions, i18n.language]
	);

	return (
		<div className="text-sm text-foreground" >
			<span className="font-medium">{item.quantity}x</span> {itemName}
			{item.selectedOptions.length > 0 && (
				<span className="text-xs ml-1 text-faint-foreground" >
					({optionsLabel})
				</span>
			)}
			{item.specialInstructions && (
				<p className="text-xs italic text-warning" >
					{item.specialInstructions}
				</p>
			)}
		</div>
	);
}
