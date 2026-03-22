import { flexRender } from "@tanstack/react-table";
import { SearchInput } from "../../../../global/components/SearchInput";
import { Pagination } from "../../../../global/components/Table";
import { NotAuthenticatedState } from "../../../auth/NotAuthenticatedState";
import { SortIcon } from "../MaterialsApprovalTable/SortIcon";
import { AuthLoadingState } from "./AuthLoadingState";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { LoadingSkeleton } from "./LoadingSkeleton";
import { usePendingMaterialsTable } from "./usePendingMaterialsTable";

export function PendingMaterialsTable() {
	const {
		table,
		materials,
		globalFilter,
		setGlobalFilter,
		isLoading,
		error,
		isError,
		refetch,
		isAuthLoading,
		isAuthenticated,
	} = usePendingMaterialsTable();

	// Check authentication state first
	if (isAuthLoading) return <AuthLoadingState />;
	if (!isAuthenticated) return <NotAuthenticatedState />;

	// Check loading and error states
	if (isLoading) return <LoadingSkeleton />;
	if (isError && error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		return <ErrorState error={new Error(errorMessage)} onRetry={() => refetch()} />;
	}

	// Check if we have data
	if (materials === undefined) {
		return <LoadingSkeleton />;
	}

	if (materials.length === 0) {
		return <EmptyState />;
	}

	return (
		<div className="flex flex-col h-full">
			{/* Actions bar */}
			<div className="mb-4 flex gap-4 items-center justify-between flex-wrap">
				<div className="flex gap-4 items-center">
					<SearchInput
						placeholder="Search materials..."
						value={globalFilter}
						onChange={setGlobalFilter}
					/>
					<div className="text-sm" style={{ color: "var(--text-secondary)" }}>
						{table.getFilteredRowModel().rows.length} material
						{table.getFilteredRowModel().rows.length === 1 ? "" : "s"} pending approval
					</div>
				</div>
			</div>

			{/* Table */}
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
							</tr>
						))}
					</thead>
					<tbody>
						{table.getRowModel().rows.map((row) => (
							<tr
								key={row.id}
								className="transition-colors"
								style={{
									borderBottom: "1px solid var(--border-default)",
								}}
							>
								{row.getVisibleCells().map((cell) => (
									<td key={cell.id} className="px-4 py-3">
										{flexRender(cell.column.columnDef.cell, cell.getContext())}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>

			{/* Pagination */}
			<Pagination table={table} />
		</div>
	);
}
