import { CopyableId } from "@/global/components";
import { formatDate, getDisplayTimestamp } from "@/global/utils/date";
import { createColumnHelper } from "@tanstack/react-table";
import type { UserRoleDoc } from "convex/constants";
import { RoleBadge } from "./RoleBadge";

type UserRole = UserRoleDoc;
const columnHelper = createColumnHelper<UserRole>();

export const columns = [
	columnHelper.accessor("userId", {
		header: "User ID",
		cell: (info) => <CopyableId id={info.getValue()} />,
	}),
	columnHelper.accessor("email", {
		header: "Email",
		cell: (info) => {
			const value = info.getValue();
			return value ? (
				<span className="text-sm text-foreground" >
					{value}
				</span>
			) : (
				<span className="text-faint-foreground" >—</span>
			);
		},
	}),
	columnHelper.accessor("roles", {
		header: "Roles",
		cell: (info) => (
			<div className="flex gap-1.5 flex-wrap">
				{info.getValue().map((role) => (
					<RoleBadge key={role} role={role} />
				))}
			</div>
		),
		filterFn: (row, columnId, filterValue) => {
			if (!filterValue) return true;
			const roles = row.getValue(columnId);
			return (
				Array.isArray(roles) &&
				roles.some((role) => role.toLowerCase().includes(filterValue.toLowerCase()))
			);
		},
	}),
	columnHelper.accessor("organizationId", {
		header: "Organization",
		cell: (info) => {
			const value = info.getValue();
			return value ? (
				<span className="font-mono text-xs text-muted-foreground" >
					{value.slice(0, 12)}...
				</span>
			) : (
				<span className="text-faint-foreground" >—</span>
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
