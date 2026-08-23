import { localizeName, OrdersKeys, useLocalizedName } from "@/global/i18n";
import { type CSSProperties, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { STATION_CONFIG, type DashboardPrepStation } from "./stationConfig";
import type { DashboardOrderItem } from "./statusConfig";

interface OrderItemRowProps {
	readonly item: DashboardOrderItem;
	/**
	 * Currently-active prep-station filter set on the dashboard. Drives the
	 * per-row visual treatment: items in the active set get a tinted
	 * background + station-color left border, items outside the set get
	 * muted via reduced opacity. When the set is empty (no filter applied)
	 * the row renders with no station treatment at all.
	 */
	readonly activeStationFilters?: ReadonlySet<DashboardPrepStation>;
}

export function OrderItemRow({ item, activeStationFilters }: Readonly<OrderItemRowProps>) {
	const { t, i18n } = useTranslation();
	const itemName = useLocalizedName(item.menuItemName, item.menuItemTranslations);
	const optionsLabel = useMemo(
		() =>
			item.selectedOptions
				.map((option) => localizeName(option.optionName, option.optionTranslations, i18n.language))
				.join(", "),
		[item.selectedOptions, i18n.language]
	);

	// No filter active → render as before. When a filter is active, items
	// matching the filter get an accent + tinted background; items outside
	// the filter get dimmed so the eye lands on the relevant queue.
	const hasActiveFilter = activeStationFilters && activeStationFilters.size > 0;
	const matches = hasActiveFilter ? activeStationFilters.has(item.prepStation) : true;
	const visual = STATION_CONFIG[item.prepStation].visual;
	const isCancelled = item.cancelledAt !== undefined;

	let rowStyle: CSSProperties | undefined;
	if (hasActiveFilter) {
		rowStyle = matches
			? { backgroundColor: visual.tintedBg, borderLeft: `3px solid ${visual.accentBorder}` }
			: { opacity: 0.45 };
	}

	// An 86'd line stays visible — the diner ordered it and may ask — but it
	// must never read as something still to make, so the station treatment
	// gives way to a struck-through, muted row.
	if (isCancelled) {
		return (
			<div className="text-sm text-faint-foreground" style={{ opacity: 0.45 }}>
				<span className="line-through">
					<span className="font-medium">{item.quantity}x</span> {itemName}
					{item.selectedOptions.length > 0 && (
						<span className="text-xs ml-1">({optionsLabel})</span>
					)}
				</span>
				<span className="ml-1.5 text-[10px] font-medium uppercase tracking-wide text-destructive">
					{t(OrdersKeys.TICKET_ITEM_CANCELLED_BADGE)}
				</span>
			</div>
		);
	}

	return (
		<div
			className={
				hasActiveFilter && matches
					? "text-sm text-foreground rounded-r-md pl-2 pr-2 py-1"
					: "text-sm text-foreground"
			}
			style={rowStyle}
		>
			<span className="font-medium">{item.quantity}x</span> {itemName}
			{item.selectedOptions.length > 0 && (
				<span className="text-xs ml-1 text-faint-foreground">({optionsLabel})</span>
			)}
			{item.specialInstructions && (
				<p className="text-xs italic text-warning">{item.specialInstructions}</p>
			)}
		</div>
	);
}
