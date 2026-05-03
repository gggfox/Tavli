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
	/** When set, replaces the default "{n} {entity}" filtered-row count line. */
	readonly getResultCountText?: (filteredCount: number) => string;
	readonly entityName: string;
	readonly emptyIcon?: LucideIcon;
	readonly emptyTitle?: string;
	readonly emptyDescription?: string;
	/** Shown when `data` is non-empty but the global filter hides every row. */
	readonly filteredEmptyIcon?: LucideIcon;
	readonly filteredEmptyTitle?: string;
	readonly filteredEmptyDescription?: string;
	readonly notAuthenticatedMessage?: string;
	readonly actions?: ReactNode;
	readonly renderRowActions?: (row: TData) => ReactNode;
}

export function AdminTable<TData>({
	tableState,
	searchPlaceholder,
	getResultCountText,
	entityName,
	emptyIcon: EmptyIcon = Search,
	emptyTitle,
	emptyDescription,
	filteredEmptyIcon: FilteredEmptyIcon = Search,
	filteredEmptyTitle,
	filteredEmptyDescription,
	notAuthenticatedMessage,
	actions,
	renderRowActions,
}: Readonly<AdminTableProps<TData>>) {
	// `table.getRowModel()` etc. are read during render and rely on internal
	// mutation, which React Compiler would otherwise memoize. Without this opt
	// out, sorting/filtering state changes never reach the rendered rows until
	// some other prop forces a re-render.
	"use no memo";

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
		return (
			<div className="flex flex-col flex-1 h-full min-h-0">
				<TableErrorState error={errorObj} entityName={entityName} onRetry={() => refetch()} fill />
			</div>
		);
	}
	if (data === undefined || data === null) return <TableSkeleton />;

	const isEmpty = data.length === 0;
	const filteredCount = table.getFilteredRowModel().rows.length;
	const isFilteredEmpty = !isEmpty && filteredCount === 0;
	const singular = entityName.endsWith("s") ? entityName.slice(0, -1) : entityName;
	const plural = entityName.endsWith("s") ? entityName : `${entityName}s`;
	const defaultResultCountText = `${filteredCount} ${filteredCount === 1 ? singular : plural}`;
	const resultCountLabel = getResultCountText
		? getResultCountText(filteredCount)
		: defaultResultCountText;

	let tableSection: ReactNode;
	if (isEmpty) {
		tableSection = (
			<EmptyState
				icon={EmptyIcon}
				title={emptyTitle ?? `No ${entityName} found`}
				description={emptyDescription}
				fill
			/>
		);
	} else if (isFilteredEmpty) {
		tableSection = (
			<EmptyState
				icon={FilteredEmptyIcon}
				title={filteredEmptyTitle ?? `No matching ${entityName}`}
				description={filteredEmptyDescription}
				fill
			/>
		);
	} else {
		tableSection = (
			<>
				<div className="flex-1 overflow-auto rounded-lg bg-muted border border-border">
					<table className="w-full border-collapse">
						<thead>
							{table.getHeaderGroups().map((headerGroup) => (
								<tr key={headerGroup.id}>
									{headerGroup.headers.map((header) => (
										<th
											key={header.id}
											className="px-4 py-3 text-left text-sm font-medium sticky top-0 bg-muted text-muted-foreground border-b border-border"
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
										<th className="px-4 py-3 text-right text-sm font-medium sticky top-0 bg-muted text-muted-foreground border-b border-border">
											Actions
										</th>
									)}
								</tr>
							))}
						</thead>
						<tbody>
							{table.getRowModel().rows.map((row) => (
								<tr key={row.id} className="transition-colors border-b border-border">
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
			</>
		);
	}

	return (
		<div className="flex flex-col flex-1 h-full min-h-0">
			<div className="mb-4 flex gap-4 items-center">
				<SearchInput
					placeholder={searchPlaceholder ?? `Search ${entityName}...`}
					value={globalFilter}
					onChange={setGlobalFilter}
				/>
				<div className="text-sm text-muted-foreground">{resultCountLabel}</div>
				{actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
			</div>

			{tableSection}
		</div>
	);
}
