import { flexRender } from "@tanstack/react-table";
import { CheckCircle, Loader2 } from "lucide-react";
import { SearchInput } from "../../../../global/components/SearchInput";
import { Pagination } from "../../../../global/components/Table";
import { AuthLoadingState } from "../../../auth/AuthLoadingState";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { LoadingSkeleton } from "./LoadingSkeleton";
import { NotAuthenticatedState } from "./NotAuthenticatedState";
import { SortIcon } from "./SortIcon";
import { useMaterialsApprovalTable } from "./useMaterialsApprovalTable";

export function MaterialsApprovalTable() {
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
		selectedMaterialIds,
		handleApproveSelected,
		isApproving,
		approvalError,
	} = useMaterialsApprovalTable();

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

	const selectedCount = selectedMaterialIds.length;

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
						{table.getFilteredRowModel().rows.length === 1 ? "" : "s"}
					</div>
				</div>

				{/* Approve button */}
				<div className="flex items-center gap-3">
					{selectedCount > 0 && (
						<span className="text-sm" style={{ color: "var(--text-secondary)" }}>
							{selectedCount} selected
						</span>
					)}
					<button
						onClick={handleApproveSelected}
						disabled={selectedCount === 0 || isApproving}
						className="inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
						style={{
							backgroundColor: selectedCount > 0 ? "rgb(16, 185, 129)" : "var(--bg-secondary)",
							color: selectedCount > 0 ? "white" : "var(--text-muted)",
							border: selectedCount > 0 ? "none" : "1px solid var(--border-default)",
						}}
					>
						{isApproving ? (
							<>
								<Loader2 size={16} className="animate-spin" />
								Approving...
							</>
						) : (
							<>
								<CheckCircle size={16} />
								Approve Selected
							</>
						)}
					</button>
				</div>
			</div>

			{/* Approval error */}
			{approvalError && (
				<div
					className="mb-4 p-3 rounded-lg flex items-center gap-2"
					style={{
						backgroundColor: "rgba(239, 68, 68, 0.1)",
						border: "1px solid rgba(239, 68, 68, 0.3)",
						color: "rgb(239, 68, 68)",
					}}
				>
					<span className="text-sm">
						{approvalError instanceof Error ? approvalError.message : "Failed to approve materials"}
					</span>
				</div>
			)}

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
										{(() => {
											if (header.isPlaceholder) {
												return null;
											}
											if (header.column.id === "select") {
												return flexRender(header.column.columnDef.header, header.getContext());
											}
											return (
												<button
													className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
													onClick={header.column.getToggleSortingHandler()}
												>
													{flexRender(header.column.columnDef.header, header.getContext())}
													<SortIcon column={header.column} />
												</button>
											);
										})()}
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
									backgroundColor: row.getIsSelected() ? "rgba(16, 185, 129, 0.08)" : "transparent",
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
