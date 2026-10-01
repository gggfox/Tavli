import { WhatsappKeys } from "@/global/i18n";
import { formatDate, getDisplayTimestamp } from "@/global/utils/date";
import { createColumnHelper } from "@tanstack/react-table";
import type { Doc } from "convex/_generated/dataModel";
import type { TFunction } from "i18next";

export type SpendAllowlistRow = Doc<"whatsappSpendAllowlist">;

const columnHelper = createColumnHelper<SpendAllowlistRow>();

/**
 * Built per render rather than as a module constant because every header is
 * translated, and `t` and the date `locale` follow the active language.
 */
export function buildSpendAllowlistColumns(t: TFunction, locale: string) {
	return [
		columnHelper.accessor("phone", {
			header: t(WhatsappKeys.ALLOWLIST_COLUMN_PHONE),
			cell: (info) => (
				<span className="text-sm font-medium text-foreground tabular-nums">{info.getValue()}</span>
			),
		}),
		columnHelper.accessor("label", {
			header: t(WhatsappKeys.ALLOWLIST_COLUMN_LABEL),
			cell: (info) => <span className="text-sm text-muted-foreground">{info.getValue()}</span>,
		}),
		columnHelper.accessor("createdAt", {
			header: t(WhatsappKeys.ALLOWLIST_COLUMN_ADDED),
			cell: (info) => (
				<span className="text-sm text-muted-foreground">
					{formatDate(
						getDisplayTimestamp(info.getValue(), info.row.original._creationTime),
						locale
					)}
				</span>
			),
		}),
		columnHelper.accessor("createdBy", {
			header: t(WhatsappKeys.ALLOWLIST_COLUMN_ADDED_BY),
			cell: (info) => <span className="text-sm text-faint-foreground">{info.getValue()}</span>,
		}),
	];
}
