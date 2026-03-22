import { Table } from "@tanstack/react-table";

export function Pagination<TData>({ table }: Readonly<{ table: Table<TData> }>) {
	return (
		<div
			className="mt-4 flex items-center justify-between"
			style={{ color: "var(--text-secondary)" }}
		>
			<div className="text-sm">
				Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
			</div>
			<div className="flex gap-2">
				<button
					onClick={() => table.previousPage()}
					disabled={!table.getCanPreviousPage()}
					className="px-3 py-1.5 rounded-md text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
					style={{
						backgroundColor: "var(--bg-secondary)",
						border: "1px solid var(--border-default)",
					}}
				>
					Previous
				</button>
				<button
					onClick={() => table.nextPage()}
					disabled={!table.getCanNextPage()}
					className="px-3 py-1.5 rounded-md text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
					style={{
						backgroundColor: "var(--bg-secondary)",
						border: "1px solid var(--border-default)",
					}}
				>
					Next
				</button>
			</div>
		</div>
	);
}
