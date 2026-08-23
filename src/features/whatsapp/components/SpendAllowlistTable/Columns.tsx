import { formatDate, getDisplayTimestamp } from "@/global/utils/date";
import { createColumnHelper } from "@tanstack/react-table";
import type { Doc } from "convex/_generated/dataModel";

export type SpendAllowlistRow = Doc<"whatsappSpendAllowlist">;

const columnHelper = createColumnHelper<SpendAllowlistRow>();

export const columns = [
	columnHelper.accessor("phone", {
		header: "Phone",
		cell: (info) => (
			<span className="text-sm font-medium text-foreground tabular-nums">{info.getValue()}</span>
		),
	}),
	columnHelper.accessor("label", {
		header: "Label",
		cell: (info) => <span className="text-sm text-muted-foreground">{info.getValue()}</span>,
	}),
	columnHelper.accessor("createdAt", {
		header: "Added",
		cell: (info) => (
			<span className="text-sm text-muted-foreground">
				{formatDate(getDisplayTimestamp(info.getValue(), info.row.original._creationTime))}
			</span>
		),
	}),
	columnHelper.accessor("createdBy", {
		header: "Added by",
		cell: (info) => <span className="text-sm text-faint-foreground">{info.getValue()}</span>,
	}),
];
