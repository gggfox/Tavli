import { OrdersKeys } from "@/global/i18n";
import { useTranslation } from "react-i18next";

interface TableBadgeProps {
	/**
	 * The table this order belongs to, or `null` when the joined table row
	 * no longer exists (deleted or purged). Never `0` — the query used to
	 * collapse "no table" into `0`, which read as a real table on the card.
	 */
	readonly tableNumber: number | null;
	/**
	 * Type scale, color and flex behaviour for the label. Callers own it
	 * because the badge sits both on a card header (foreground, never
	 * allowed to shrink) and inside the tinted awaiting-payment panel
	 * (inherited color, truncates with the panel).
	 */
	readonly className?: string;
}

/**
 * "Which table does this go to" — the single fact a server carrying plates
 * reads first, so it is the loudest thing in an order card header (TAVLI-80).
 * Shared by the order card, the station ticket and the full-order modal so the
 * three surfaces can never drift apart on how a table is named.
 */
export function TableBadge({ tableNumber, className }: Readonly<TableBadgeProps>) {
	const { t } = useTranslation();
	const label =
		tableNumber === null
			? t(OrdersKeys.CARD_TABLE_NONE)
			: t(OrdersKeys.CARD_TABLE, { number: tableNumber });

	return <span className={`tabular-nums ${className ?? ""}`}>{label}</span>;
}
