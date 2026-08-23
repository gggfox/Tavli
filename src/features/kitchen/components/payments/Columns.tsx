import { CopyableId } from "@/global/components";
import { PaymentsKeys } from "@/global/i18n";
import { formatDate } from "@/global/utils/date";
import { formatCents } from "@/global/utils/money";
import { type ColumnDef, createColumnHelper } from "@tanstack/react-table";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { OrderItemsTooltipTrigger } from "./OrderItemsTooltipTrigger";
import type { PaymentsLedgerRow } from "./types";

const columnHelper = createColumnHelper<PaymentsLedgerRow>();

/** Renders cents, or an em dash when the amount was never recorded. */
function Money({ cents }: Readonly<{ cents: number | null }>) {
	if (cents === null) return <span className="text-faint-foreground">—</span>;
	return <span className="text-foreground tabular-nums">${formatCents(cents)}</span>;
}

/**
 * Column definitions for the payments ledger AdminTable. Returns a memoized
 * array keyed off the active language so cells re-render with translated copy
 * when the user switches locales.
 *
 * ADR 008: a row is either a paid Order or a post-visit Tip payment, and the
 * money is split into what the diner paid (subtotal + Tavli service fee) and
 * what the restaurant nets — summing "subtotal" alone is the restaurant's
 * revenue, which is why the fee is shown as its own column rather than folded
 * into a single total.
 */
export function usePaymentsColumns(): ColumnDef<PaymentsLedgerRow, unknown>[] {
	const { t, i18n } = useTranslation();

	return useMemo(
		() =>
			[
				columnHelper.accessor("dailyOrderNumber", {
					header: t(PaymentsKeys.TABLE_DAY_ORDER_NUMBER),
					cell: (info) => {
						const n = info.getValue();
						return (
							<span className="text-foreground tabular-nums font-medium">
								{n === null || n === undefined ? "—" : `#${n}`}
							</span>
						);
					},
					sortingFn: (rowA, rowB) => {
						const av = rowA.original.dailyOrderNumber;
						const bv = rowB.original.dailyOrderNumber;
						if (av == null && bv == null) return 0;
						if (av == null) return 1;
						if (bv == null) return -1;
						return av - bv;
					},
				}),
				columnHelper.accessor("rowKind", {
					header: t(PaymentsKeys.TABLE_TYPE),
					cell: (info) => (
						<span className="text-foreground">
							{info.getValue() === "tip"
								? t(PaymentsKeys.ROW_KIND_TIP)
								: t(PaymentsKeys.ROW_KIND_ORDER)}
						</span>
					),
				}),
				columnHelper.accessor("id", {
					header: t(PaymentsKeys.TABLE_ROW_ID),
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
					cell: (info) => <OrderItemsTooltipTrigger row={info.row.original} />,
					enableSorting: false,
					enableGlobalFilter: false,
				}),
				columnHelper.accessor("subtotalCents", {
					header: t(PaymentsKeys.TABLE_SUBTOTAL),
					cell: (info) => (
						<span className="font-medium text-foreground tabular-nums">
							${formatCents(info.getValue())}
						</span>
					),
				}),
				columnHelper.accessor("serviceFeeCents", {
					header: t(PaymentsKeys.TABLE_SERVICE_FEE),
					cell: (info) => <Money cents={info.getValue()} />,
				}),
				columnHelper.accessor("tipCents", {
					header: t(PaymentsKeys.TABLE_TIP),
					cell: (info) => <Money cents={info.getValue()} />,
				}),
				columnHelper.accessor("netToRestaurantCents", {
					header: t(PaymentsKeys.TABLE_NET_TO_RESTAURANT),
					cell: (info) => (
						<span className="font-medium">
							<Money cents={info.getValue()} />
						</span>
					),
				}),
			] as ColumnDef<PaymentsLedgerRow, unknown>[],
		[t, i18n.language]
	);
}
