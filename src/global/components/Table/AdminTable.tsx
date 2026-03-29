import { AuthLoadingState, NotAuthenticatedState } from "@/features/auth";
import type { useAdminTable } from "@/global/hooks/useAdminTable";
import { flexRender } from "@tanstack/react-table";
import type { LucideIcon } from "lucide-react";
import { Search } from "lucide-react";
import type { ReactNode } from "react";
import { EmptyState } from "../EmptyState";
import { SearchInput } from "../SearchInput";
import { Pagination } from "./Pagination";
import { SortIcon } from "./SortIcon";
import { TableErrorState } from "./TableErrorState";
import { TableSkeleton } from "./TableSkeleton";

interface AdminTableProps<TData> {
	readonly tableState: ReturnType<typeof useAdminTable<TData>>;
	readonly searchPlaceholder?: string;
	readonly entityName: string;
	readonly emptyIcon?: LucideIcon;
	readonly emptyTitle?: string;
	readonly emptyDescription?: string;
	readonly notAuthenticatedMessage?: string;
	readonly actions?: ReactNode;
	readonly renderRowActions?: (row: TData) => ReactNode;
}

export function AdminTable<TData>({
	tableState,
	searchPlaceholder,
	entityName,
	emptyIcon: EmptyIcon = Search,
	emptyTitle,
	emptyDescription,
	notAuthenticatedMessage,
	actions,
	renderRowActions,
}: Readonly<AdminTableProps<TData>>) {
	const {
		table,
		data,
		globalFilter,
		setGlobalFilter,
		isLoading,
		error,
		isError,
		refetch,
		isAuthLoading,
		isAuthenticated,
	} = tableState;

	if (isAuthLoading) return <AuthLoadingState />;
	if (!isAuthenticated) {
		return (
			<NotAuthenticatedState
				icon={EmptyIcon}
				message={notAuthenticatedMessage ?? `Please sign in to view ${entityName}.`}
			/>
		);
	}

	if (isLoading) return <TableSkeleton />;
	if (isError && error) {
		const errorObj = error instanceof Error ? error : new Error(String(error));
		return <TableErrorState error={errorObj} entityName={entityName} onRetry={() => refetch()} />;
	}
	if (data === undefined || data === null) return <TableSkeleton />;

	if (data.length === 0) {
		return (
			<EmptyState
				icon={EmptyIcon}
				title={emptyTitle ?? `No ${entityName} found`}
				description={emptyDescription}
			/>
		);
	}

	const filteredCount = table.getFilteredRowModel().rows.length;
	const singular = entityName.endsWith("s") ? entityName.slice(0, -1) : entityName;
	const plural = entityName.endsWith("s") ? entityName : `${entityName}s`;

	return (
		<div className="flex flex-col h-full">
			<div className="mb-4 flex gap-4 items-center">
				<SearchInput
					placeholder={searchPlaceholder ?? `Search ${entityName}...`}
					value={globalFilter}
					onChange={setGlobalFilter}
				/>
				<div className="text-sm" style={{ color: "var(--text-secondary)" }}>
					{filteredCount} {filteredCount === 1 ? singular : plural}
				</div>
				{actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
			</div>

			<div
				className="flex-1 overflow-auto rounded-lg"
				style={{
					backgroundColor: "var(--bg-secondary)",
					border: "1px solid var(--border-default)",
				}}
			>
				<table className="w-full border-collapse">
					<thead>
						{table.getHeaderGroups().map((headerGroup) => (
							<tr key={headerGroup.id}>
								{headerGroup.headers.map((header) => (
									<th
										key={header.id}
										className="px-4 py-3 text-left text-sm font-medium sticky top-0"
										style={{
											backgroundColor: "var(--bg-secondary)",
											color: "var(--text-secondary)",
											borderBottom: "1px solid var(--border-default)",
										}}
									>
										{header.isPlaceholder ? null : (
											<button
												className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
												onClick={header.column.getToggleSortingHandler()}
											>
												{flexRender(header.column.columnDef.header, header.getContext())}
												<SortIcon column={header.column} />
											</button>
										)}
									</th>
								))}
								{renderRowActions && (
									<th
										className="px-4 py-3 text-right text-sm font-medium sticky top-0"
										style={{
											backgroundColor: "var(--bg-secondary)",
											color: "var(--text-secondary)",
											borderBottom: "1px solid var(--border-default)",
										}}
									>
										Actions
									</th>
								)}
							</tr>
						))}
					</thead>
					<tbody>
						{table.getRowModel().rows.map((row) => (
							<tr
								key={row.id}
								className="transition-colors"
								style={{ borderBottom: "1px solid var(--border-default)" }}
							>
								{row.getVisibleCells().map((cell) => (
									<td key={cell.id} className="px-4 py-3">
										{flexRender(cell.column.columnDef.cell, cell.getContext())}
									</td>
								))}
								{renderRowActions && (
									<td className="px-4 py-3">{renderRowActions(row.original)}</td>
								)}
							</tr>
						))}
					</tbody>
				</table>
			</div>

			<Pagination table={table} />
		</div>
	);
}
