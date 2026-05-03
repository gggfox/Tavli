import { unwrapResult } from "@/global/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import {
	type ColumnDef,
	type ColumnFiltersState,
	type FilterFn,
	getCoreRowModel,
	getFilteredRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	type SortingState,
	type Updater,
	useReactTable,
} from "@tanstack/react-table";
import { useConvexAuth } from "convex/react";
import { useCallback, useState } from "react";

function applyStringUpdater(updater: Updater<string>, previous: string): string {
	return typeof updater === "function" ? updater(previous) : updater;
}

interface UseAdminTableOptions<TData> {
	queryOptions: ReturnType<typeof convexQuery>;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	columns: ColumnDef<TData, any>[];
	enabled?: boolean;
	pageSize?: number;
	getRowId?: (originalRow: TData, index: number, parent?: unknown) => string;
	globalFilterFn?: FilterFn<TData>;
	/** When both are set, global filter is controlled by the parent (URL, etc.). */
	globalFilter?: string;
	onGlobalFilterChange?: (value: string) => void;
}

export function useAdminTable<TData>({
	queryOptions,
	columns,
	enabled,
	pageSize = 10,
	getRowId,
	globalFilterFn,
	globalFilter: controlledGlobalFilter,
	onGlobalFilterChange,
}: UseAdminTableOptions<TData>) {
	// React Compiler memoizes calls inside this hook, which freezes the
	// `useReactTable` row models so sorting and filtering only update when an
	// unrelated render is triggered. Opting this hook out keeps the table
	// reactive. See https://github.com/TanStack/table/issues/5567.
	"use no memo";

	const isControlled =
		controlledGlobalFilter !== undefined && onGlobalFilterChange !== undefined;

	const { isLoading: isAuthLoading, isAuthenticated } = useConvexAuth();
	const [sorting, setSorting] = useState<SortingState>([]);
	const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
	const [internalGlobalFilter, setInternalGlobalFilter] = useState("");

	const globalFilter = isControlled ? controlledGlobalFilter : internalGlobalFilter;

	const handleGlobalFilterChange = useCallback(
		(updater: Updater<string>) => {
			const next = applyStringUpdater(updater, globalFilter);
			if (isControlled) {
				onGlobalFilterChange!(next);
			} else {
				setInternalGlobalFilter(next);
			}
		},
		[isControlled, onGlobalFilterChange, globalFilter]
	);

	const { data, isLoading, error, isError, refetch } = useQuery({
		...queryOptions,
		enabled: enabled ?? isAuthenticated,
		select: unwrapResult<TData[]>,
	});

	const table = useReactTable({
		data: data ?? [],
		columns,
		...(getRowId ? { getRowId } : {}),
		...(globalFilterFn ? { globalFilterFn } : {}),
		state: {
			sorting,
			columnFilters,
			globalFilter,
		},
		onSortingChange: setSorting,
		onColumnFiltersChange: setColumnFilters,
		onGlobalFilterChange: handleGlobalFilterChange,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		getPaginationRowModel: getPaginationRowModel(),
		initialState: {
			pagination: { pageSize },
		},
	});

	return {
		table,
		data,
		isLoading,
		isAuthLoading,
		isAuthenticated,
		error,
		isError,
		refetch,
		globalFilter,
		setGlobalFilter: handleGlobalFilterChange,
	};
}
