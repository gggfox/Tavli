import { Pagination } from "@/global/components";
import { SearchInput } from "@/global/components/SearchInput";
import { flexRender } from "@tanstack/react-table";
import { AuthLoadingState } from "./AuthLoadingState";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { LoadingSkeleton } from "./LoadingSkeleton";
import { NotAuthenticatedState } from "./NotAuthenticatedState";
import { SortIcon } from "./SortIcon";
import { useAdminUsersTable } from "./useAdminUsersTable";

export function UsersTable() {
	const {
		table,
		users,
		globalFilter,
		setGlobalFilter,
		isLoading,
		error,
		isError,
		refetch,
		isAuthLoading,
		isAuthenticated,
	} = useAdminUsersTable();

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
	if (users === undefined) {
		return <LoadingSkeleton />;
	}

	if (users.length === 0) {
		return <EmptyState />;
	}

	return (
		<div className="flex flex-col h-full">
			{/* Search and filters */}
			<div className="mb-4 flex gap-4 items-center">
				<SearchInput
					placeholder="Search users..."
					value={globalFilter}
					onChange={setGlobalFilter}
				/>
				<div className="text-sm" style={{ color: "var(--text-secondary)" }}>
					{table.getFilteredRowModel().rows.length} user
					{table.getFilteredRowModel().rows.length === 1 ? "" : "s"}
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
