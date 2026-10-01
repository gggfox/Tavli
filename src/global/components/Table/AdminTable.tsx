import { AuthLoadingState, NotAuthenticatedState } from "@/features/auth";
import type { useAdminTable } from "@/global/hooks/useAdminTable";
import { CommonKeys } from "@/global/i18n";
import { flexRender, type Row } from "@tanstack/react-table";
import type { LucideIcon } from "lucide-react";
import { Search } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../EmptyState";
import { SearchInput } from "../SearchInput";
import { Pagination } from "./Pagination";
import { SortIcon } from "./SortIcon";
import { TableErrorState } from "./TableErrorState";
import { TableSkeleton } from "./TableSkeleton";

/**
 * Every piece of copy AdminTable renders is either passed in already translated
 * by the caller or falls back to an entity-neutral `common.table.*` string. The
 * table never builds a sentence out of an entity noun: the old `entityName`
 * prop produced English plurals ("{noun}s") and "No {noun} found" inside the
 * Spanish UI. A caller that wants entity-specific wording passes it — count
 * text via `getResultCountText` backed by an i18next `_one`/`_other` key.
 */
interface AdminTableProps<TData> {
	readonly tableState: ReturnType<typeof useAdminTable<TData>>;
	/** Defaults to `common.table.searchPlaceholder` ("Search…"). */
	readonly searchPlaceholder?: string;
	/**
	 * Filtered-row count line, e.g.
	 * `(count) => t(AlertsKeys.PAGE_RESULT_COUNT, { count })`. Defaults to the
	 * pluralized `common.table.resultCount` ("N results").
	 */
	readonly getResultCountText?: (filteredCount: number) => string;
	/** Load-failure title, e.g. `t(ErrorKeys.LOAD_FAILED_ALERTS)`. */
	readonly errorTitle?: string;
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
	/**
	 * When provided, clicking a row body invokes this handler and the row gets
	 * a hover/pointer affordance. Row-action buttons rendered in cells must
	 * call `e.stopPropagation()` so they don't also trigger this.
	 */
	readonly onRowClick?: (row: TData) => void;
}

export function AdminTable<TData>({
	tableState,
	searchPlaceholder,
	getResultCountText,
	errorTitle,
	emptyIcon: EmptyIcon = Search,
	emptyTitle,
	emptyDescription,
	filteredEmptyIcon: FilteredEmptyIcon = Search,
	filteredEmptyTitle,
	filteredEmptyDescription,
	notAuthenticatedMessage,
	actions,
	renderRowActions,
	onRowClick,
}: Readonly<AdminTableProps<TData>>) {
	// `table.getRowModel()` etc. are read during render and rely on internal
	// mutation, which React Compiler would otherwise memoize. Without this opt
	// out, sorting/filtering state changes never reach the rendered rows until
	// some other prop forces a re-render.
	"use no memo";
	const { t } = useTranslation();

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
				message={notAuthenticatedMessage ?? t(CommonKeys.TABLE_SIGN_IN_REQUIRED)}
			/>
		);
	}

	if (isLoading) return <TableSkeleton />;
	if (isError && error) {
		const errorObj = error instanceof Error ? error : new Error(String(error));
		return (
			<div className="flex flex-col flex-1 h-full min-h-0">
				<TableErrorState error={errorObj} title={errorTitle} onRetry={() => refetch()} fill />
			</div>
		);
	}
	if (data === undefined || data === null) return <TableSkeleton />;

	const isEmpty = data.length === 0;
	const filteredCount = table.getFilteredRowModel().rows.length;
	const isFilteredEmpty = !isEmpty && filteredCount === 0;
	const resultCountLabel = getResultCountText
		? getResultCountText(filteredCount)
		: t(CommonKeys.TABLE_RESULT_COUNT, { count: filteredCount });

	let tableSection: ReactNode;
	if (isEmpty) {
		tableSection = (
			<EmptyState
				icon={EmptyIcon}
				title={emptyTitle ?? t(CommonKeys.TABLE_EMPTY_TITLE)}
				description={emptyDescription}
				fill
			/>
		);
	} else if (isFilteredEmpty) {
		tableSection = (
			<EmptyState
				icon={FilteredEmptyIcon}
				title={filteredEmptyTitle ?? t(CommonKeys.TABLE_FILTERED_EMPTY_TITLE)}
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
											{t(CommonKeys.TABLE_ACTIONS)}
										</th>
									)}
								</tr>
							))}
						</thead>
						<tbody>
							{table.getRowModel().rows.map((row) => (
								<AdminTableRow
									key={row.id}
									row={row}
									onRowClick={onRowClick}
									renderRowActions={renderRowActions}
								/>
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
					placeholder={searchPlaceholder ?? t(CommonKeys.TABLE_SEARCH_PLACEHOLDER)}
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

interface AdminTableRowProps<TData> {
	readonly row: Row<TData>;
	readonly onRowClick?: (row: TData) => void;
	readonly renderRowActions?: (row: TData) => ReactNode;
}

function AdminTableRow<TData>({
	row,
	onRowClick,
	renderRowActions,
}: Readonly<AdminTableRowProps<TData>>) {
	"use no memo";
	const clickable = Boolean(onRowClick);
	const className = clickable
		? "transition-colors border-b border-border cursor-pointer hover:bg-(--bg-hover) focus:bg-(--bg-hover) outline-none"
		: "transition-colors border-b border-border";

	const handleKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
		if (!onRowClick) return;
		if (event.key !== "Enter" && event.key !== " ") return;
		event.preventDefault();
		onRowClick(row.original);
	};

	return (
		<tr
			className={className}
			onClick={clickable ? () => onRowClick?.(row.original) : undefined}
			onKeyDown={clickable ? handleKeyDown : undefined}
			tabIndex={clickable ? 0 : undefined}
		>
			{row.getVisibleCells().map((cell) => (
				<td key={cell.id} className="px-4 py-3">
					{flexRender(cell.column.columnDef.cell, cell.getContext())}
				</td>
			))}
			{renderRowActions && <td className="px-4 py-3">{renderRowActions(row.original)}</td>}
		</tr>
	);
}
