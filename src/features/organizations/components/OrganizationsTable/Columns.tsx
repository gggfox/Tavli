import { CopyableId } from "@/global/components";
import { OrganizationsKeys } from "@/global/i18n";
import { formatDate, getDisplayTimestamp } from "@/global/utils/date";
import { createColumnHelper } from "@tanstack/react-table";
import type { OrganizationDoc } from "convex/constants";
import type { TFunction } from "i18next";

const columnHelper = createColumnHelper<OrganizationDoc>();

/**
 * Built per render rather than as a module constant because every header and
 * the status pill are translated, and `t` and the date `locale` follow the
 * active language.
 */
export function buildOrganizationColumns(t: TFunction, locale: string) {
	return [
		columnHelper.accessor("_id", {
			header: t(OrganizationsKeys.COLUMN_ID),
			cell: (info) => <CopyableId id={info.getValue()} />,
		}),
		columnHelper.accessor("name", {
			header: t(OrganizationsKeys.COLUMN_NAME),
			cell: (info) => (
				<span className="text-sm font-medium text-foreground">{info.getValue()}</span>
			),
		}),
		columnHelper.accessor("description", {
			header: t(OrganizationsKeys.COLUMN_DESCRIPTION),
			cell: (info) => {
				const value = info.getValue();
				return value ? (
					<span className="text-sm text-muted-foreground">
						{value.length > 60 ? `${value.slice(0, 60)}...` : value}
					</span>
				) : (
					<span className="text-faint-foreground">—</span>
				);
			},
		}),
		columnHelper.accessor("isActive", {
			header: t(OrganizationsKeys.COLUMN_STATUS),
			cell: (info) => {
				const active = info.getValue();
				return (
					<span
						className="px-2 py-0.5 rounded-full text-xs font-medium"
						style={{
							backgroundColor: active ? "var(--accent-success-light)" : "rgba(156, 163, 175, 0.15)",
							color: active ? "var(--accent-success)" : "var(--text-muted)",
						}}
					>
						{active ? t(OrganizationsKeys.STATUS_ACTIVE) : t(OrganizationsKeys.STATUS_INACTIVE)}
					</span>
				);
			},
		}),
		columnHelper.accessor("createdAt", {
			header: t(OrganizationsKeys.COLUMN_CREATED),
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
			header: t(OrganizationsKeys.COLUMN_UPDATED),
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
