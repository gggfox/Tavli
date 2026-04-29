import { CopyableId } from "@/global/components";
import { formatDate, getDisplayTimestamp } from "@/global/utils/date";
import { createColumnHelper } from "@tanstack/react-table";
import type { OrganizationDoc } from "convex/constants";

const columnHelper = createColumnHelper<OrganizationDoc>();

export const columns = [
	columnHelper.accessor("_id", {
		header: "ID",
		cell: (info) => <CopyableId id={info.getValue()} />,
	}),
	columnHelper.accessor("name", {
		header: "Name",
		cell: (info) => (
			<span className="text-sm font-medium text-foreground" >
				{info.getValue()}
			</span>
		),
	}),
	columnHelper.accessor("description", {
		header: "Description",
		cell: (info) => {
			const value = info.getValue();
			return value ? (
				<span className="text-sm text-muted-foreground" >
					{value.length > 60 ? `${value.slice(0, 60)}...` : value}
				</span>
			) : (
				<span className="text-faint-foreground" >—</span>
			);
		},
	}),
	columnHelper.accessor("isActive", {
		header: "Status",
		cell: (info) => {
			const active = info.getValue();
			return (
				<span
					className="px-2 py-0.5 rounded-full text-xs font-medium"
					style={{backgroundColor: active ? "var(--accent-success-light)" : "rgba(156, 163, 175, 0.15)",
				color: active ? "var(--accent-success)" : "var(--text-muted)"}}
				>
					{active ? "Active" : "Inactive"}
				</span>
			);
		},
	}),
	columnHelper.accessor("createdAt", {
		header: "Created",
		cell: (info) => {
			const displayTimestamp = getDisplayTimestamp(
				info.getValue(),
				info.row.original._creationTime
			);
			return (
				<span className="text-sm text-muted-foreground" >
					{formatDate(displayTimestamp)}
				</span>
			);
		},
	}),
	columnHelper.accessor("updatedAt", {
		header: "Updated",
		cell: (info) => {
			const displayTimestamp = getDisplayTimestamp(
				info.getValue(),
				info.row.original._creationTime
			);
			return (
				<span className="text-sm text-muted-foreground" >
					{formatDate(displayTimestamp)}
				</span>
			);
		},
	}),
];
