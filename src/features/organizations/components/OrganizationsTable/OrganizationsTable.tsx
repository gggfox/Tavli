import { AuthLoadingState, NotAuthenticatedState } from "@/features/auth";
import { Pagination, SearchInput } from "@/global/components";
import { flexRender } from "@tanstack/react-table";
import type { OrganizationDoc } from "convex/constants";
import { Building2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";
import { OrganizationFormDialog } from "./OrganizationFormDialog";
import { SortIcon } from "./SortIcon";
import { useAdminOrganizationsTable } from "./useAdminOrganizationsTable";

export function OrganizationsTable() {
	const {
		table,
		organizations,
		globalFilter,
		setGlobalFilter,
		isLoading,
		error,
		isError,
		refetch,
		isAuthLoading,
		isAuthenticated,
	} = useAdminOrganizationsTable();

	const [isFormOpen, setIsFormOpen] = useState(false);
	const [editingOrg, setEditingOrg] = useState<OrganizationDoc | null>(null);
	const [deletingOrg, setDeletingOrg] = useState<OrganizationDoc | null>(null);

	if (isAuthLoading) return <AuthLoadingState />;
	if (!isAuthenticated) {
		return <NotAuthenticatedState icon={Search} message="Please sign in to view organizations." />;
	}

	if (isLoading) {
		return (
			<div className="space-y-3">
				{Array.from({ length: 5 }, (_, i) => (
					<div
						key={`skeleton-row-${i}`}
						className="h-12 rounded-lg animate-pulse"
						style={{ backgroundColor: "var(--bg-hover)" }}
					/>
				))}
			</div>
		);
	}

	if (isError && error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		return (
			<div
				className="flex flex-col items-center justify-center py-12 rounded-lg"
				style={{ backgroundColor: "rgba(239, 68, 68, 0.1)" }}
			>
				<p className="text-lg font-medium" style={{ color: "rgb(239, 68, 68)" }}>
					Error loading organizations
				</p>
				<p className="text-sm mt-1 text-center max-w-md" style={{ color: "var(--text-secondary)" }}>
					{errorMessage}
				</p>
				<button
					onClick={() => refetch()}
					className="mt-4 px-4 py-2 rounded-lg text-sm transition-colors"
					style={{
						backgroundColor: "var(--bg-secondary)",
						color: "var(--text-primary)",
						border: "1px solid var(--border-default)",
					}}
				>
					Retry
				</button>
			</div>
		);
	}

	if (organizations === undefined) {
		return (
			<div className="space-y-3">
				{Array.from({ length: 5 }, (_, i) => (
					<div
						key={`skeleton-row-${i}`}
						className="h-12 rounded-lg animate-pulse"
						style={{ backgroundColor: "var(--bg-hover)" }}
					/>
				))}
			</div>
		);
	}

	function handleEdit(org: OrganizationDoc) {
		setEditingOrg(org);
		setIsFormOpen(true);
	}

	function handleCreate() {
		setEditingOrg(null);
		setIsFormOpen(true);
	}

	return (
		<div className="flex flex-col h-full">
			<div className="mb-4 flex gap-4 items-center">
				<SearchInput
					placeholder="Search organizations..."
					value={globalFilter}
					onChange={setGlobalFilter}
				/>
				<div className="text-sm" style={{ color: "var(--text-secondary)" }}>
					{table.getFilteredRowModel().rows.length} organization
					{table.getFilteredRowModel().rows.length === 1 ? "" : "s"}
				</div>
				<button
					onClick={handleCreate}
					className="ml-auto flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
					style={{
						backgroundColor: "var(--btn-primary-bg)",
						color: "var(--btn-primary-text)",
					}}
				>
					<Plus size={16} />
					New Organization
				</button>
			</div>

			{organizations.length === 0 ? (
				<div
					className="flex flex-col items-center justify-center py-16 rounded-lg"
					style={{ backgroundColor: "var(--bg-secondary)" }}
				>
					<Building2 size={48} style={{ color: "var(--text-muted)" }} />
					<p className="mt-4 text-lg font-medium" style={{ color: "var(--text-primary)" }}>
						No organizations yet
					</p>
					<p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
						Create your first organization to get started.
					</p>
				</div>
			) : (
				<>
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
										<td className="px-4 py-3">
											<div className="flex justify-end gap-2">
												<button
													onClick={() => handleEdit(row.original)}
													className="p-1.5 rounded-md transition-colors hover:opacity-80"
													style={{ color: "var(--text-secondary)" }}
													title="Edit"
												>
													<Pencil size={15} />
												</button>
												<button
													onClick={() => setDeletingOrg(row.original)}
													className="p-1.5 rounded-md transition-colors hover:opacity-80"
													style={{ color: "var(--accent-danger, #e53e3e)" }}
													title="Delete"
												>
													<Trash2 size={15} />
												</button>
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					<Pagination table={table} />
				</>
			)}

			<OrganizationFormDialog
				isOpen={isFormOpen}
				onClose={() => setIsFormOpen(false)}
				organization={editingOrg}
				onSuccess={() => refetch()}
			/>

			<DeleteConfirmDialog
				isOpen={!!deletingOrg}
				onClose={() => setDeletingOrg(null)}
				organization={deletingOrg}
				onSuccess={() => refetch()}
			/>
		</div>
	);
}
