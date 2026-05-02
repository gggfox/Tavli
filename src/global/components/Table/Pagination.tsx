import { Table } from "@tanstack/react-table";

export function Pagination<TData>({ table }: Readonly<{ table: Table<TData> }>) {
	// `table.getState()` and `table.getCanNextPage()` are mutating reads that
	// React Compiler would freeze; opt out so pagination updates render.
	"use no memo";

	return (
		<div
			className="mt-4 flex items-center justify-between text-muted-foreground"
			
		>
			<div className="text-sm">
				Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
			</div>
			<div className="flex gap-2">
				<button
					onClick={() => table.previousPage()}
					disabled={!table.getCanPreviousPage()}
					className="px-3 py-1.5 rounded-md text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-muted border border-border"
					
				>
					Previous
				</button>
				<button
					onClick={() => table.nextPage()}
					disabled={!table.getCanNextPage()}
					className="px-3 py-1.5 rounded-md text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-muted border border-border"
					
				>
					Next
				</button>
			</div>
		</div>
	);
}
