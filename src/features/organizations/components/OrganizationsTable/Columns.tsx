import { isValidTimestamp } from "@/global/utils/date";
import { createColumnHelper } from "@tanstack/react-table";
import type { OrganizationDoc } from "convex/constants";

const columnHelper = createColumnHelper<OrganizationDoc>();

function formatDate(timestamp: number | undefined): string {
	if (!isValidTimestamp(timestamp)) {
		return "—";
	}
	return new Intl.DateTimeFormat("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	}).format(new Date(timestamp));
}

function getDisplayTimestamp(
	timestamp: number | undefined,
	fallback: number | undefined
): number | undefined {
	if (isValidTimestamp(timestamp)) {
		return timestamp;
	}
	return fallback;
}

export const columns = [
	columnHelper.accessor("name", {
		header: "Name",
		cell: (info) => (
			<span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
				{info.getValue()}
			</span>
		),
	}),
	columnHelper.accessor("description", {
		header: "Description",
		cell: (info) => {
			const value = info.getValue();
			return value ? (
				<span className="text-sm" style={{ color: "var(--text-secondary)" }}>
					{value.length > 60 ? `${value.slice(0, 60)}...` : value}
				</span>
			) : (
				<span style={{ color: "var(--text-muted)" }}>—</span>
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
					style={{
						backgroundColor: active ? "rgba(34, 197, 94, 0.15)" : "rgba(156, 163, 175, 0.15)",
						color: active ? "rgb(34, 197, 94)" : "rgb(156, 163, 175)",
					}}
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
				<span className="text-sm" style={{ color: "var(--text-secondary)" }}>
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
				<span className="text-sm" style={{ color: "var(--text-secondary)" }}>
					{formatDate(displayTimestamp)}
				</span>
			);
		},
	}),
];
