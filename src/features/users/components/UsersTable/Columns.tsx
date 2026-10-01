import { CopyableId } from "@/global/components";
import { UsersKeys } from "@/global/i18n";
import { formatDate, getDisplayTimestamp } from "@/global/utils/date";
import { createColumnHelper } from "@tanstack/react-table";
import type { UserRoleDoc } from "convex/constants";
import type { TFunction } from "i18next";
import { RoleBadge } from "./RoleBadge";

type UserRole = UserRoleDoc;
const columnHelper = createColumnHelper<UserRole>();

/**
 * Built per render rather than as a module constant because every header is
 * translated, and `t` and the date `locale` follow the active language.
 */
export function buildUserColumns(t: TFunction, locale: string) {
	return [
		columnHelper.accessor("userId", {
			header: t(UsersKeys.COLUMN_USER_ID),
			cell: (info) => <CopyableId id={info.getValue()} />,
		}),
		columnHelper.accessor("email", {
			header: t(UsersKeys.COLUMN_EMAIL),
			cell: (info) => {
				const value = info.getValue();
				return value ? (
					<span className="text-sm text-foreground">{value}</span>
				) : (
					<span className="text-faint-foreground">—</span>
				);
			},
		}),
		columnHelper.accessor("roles", {
			header: t(UsersKeys.COLUMN_ROLES),
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
			header: t(UsersKeys.COLUMN_ORGANIZATION),
			cell: (info) => {
				const value = info.getValue();
				return value ? (
					<span className="font-mono text-xs text-muted-foreground">{value.slice(0, 12)}...</span>
				) : (
					<span className="text-faint-foreground">—</span>
				);
			},
		}),
		columnHelper.accessor("createdAt", {
			header: t(UsersKeys.COLUMN_CREATED),
			cell: (info) => {
				const displayTimestamp = getDisplayTimestamp(
					info.getValue(),
					info.row.original._creationTime
				);
				return (
					<span className="text-sm text-muted-foreground">
						{formatDate(displayTimestamp, locale)}
					</span>
				);
			},
		}),
		columnHelper.accessor("updatedAt", {
			header: t(UsersKeys.COLUMN_UPDATED),
			cell: (info) => {
				const displayTimestamp = getDisplayTimestamp(
					info.getValue(),
					info.row.original._creationTime
				);
				return (
					<span className="text-sm text-muted-foreground">
						{formatDate(displayTimestamp, locale)}
					</span>
				);
			},
		}),
	];
}
