import { CopyableId } from "@/global/components";
import { PaymentsKeys } from "@/global/i18n";
import { formatDate } from "@/global/utils/date";
import { formatCents } from "@/global/utils/money";
import { type ColumnDef, createColumnHelper } from "@tanstack/react-table";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { OrderItemsTooltipTrigger, type PaymentsOrder } from "./OrderItemsTooltipTrigger";

const columnHelper = createColumnHelper<PaymentsOrder>();

/**
 * Column definitions for the payments AdminTable. Returns a memoized array
 * keyed off the active language so cells re-render with translated copy
 * when the user switches locales.
 */
export function usePaymentsColumns(): ColumnDef<PaymentsOrder, unknown>[] {
	const { t, i18n } = useTranslation();

	return useMemo(
		() =>
			[
				columnHelper.accessor("_id", {
					header: t(PaymentsKeys.TABLE_ORDER_ID),
					cell: (info) => <CopyableId id={info.getValue()} />,
				}),
				columnHelper.accessor("paidAt", {
					header: t(PaymentsKeys.TABLE_DATE),
					cell: (info) => {
						const value = info.getValue();
						return (
							<span className="text-foreground">
								{value ? formatDate(value, i18n.language) : "—"}
							</span>
						);
					},
				}),
				columnHelper.accessor("tableNumber", {
					header: t(PaymentsKeys.TABLE_TABLE),
					cell: (info) => (
						<span className="text-foreground">
							{t(PaymentsKeys.TABLE_TABLE)} {info.getValue()}
						</span>
					),
				}),
				columnHelper.accessor((row) => row.items, {
					id: "items",
					header: t(PaymentsKeys.TABLE_ITEMS),
					cell: (info) => <OrderItemsTooltipTrigger order={info.row.original} />,
					enableSorting: false,
					enableGlobalFilter: false,
				}),
				columnHelper.accessor("totalAmount", {
					header: t(PaymentsKeys.TABLE_TOTAL),
					cell: (info) => (
						<span className="font-medium text-foreground">${formatCents(info.getValue())}</span>
					),
				}),
			] as ColumnDef<PaymentsOrder, unknown>[],
		[t, i18n.language]
	);
}
