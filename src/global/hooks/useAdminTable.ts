import { unwrapQuery } from "@/global/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import {
	type ColumnDef,
	type ColumnFiltersState,
	getCoreRowModel,
	getFilteredRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	type SortingState,
	useReactTable,
} from "@tanstack/react-table";
import { useConvexAuth } from "convex/react";
import { useState } from "react";

interface UseAdminTableOptions<TData> {
	queryOptions: ReturnType<typeof convexQuery>;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	columns: ColumnDef<TData, any>[];
	enabled?: boolean;
	pageSize?: number;
}

export function useAdminTable<TData>({
	queryOptions,
	columns,
	enabled,
	pageSize = 10,
}: UseAdminTableOptions<TData>) {
	const { isLoading: isAuthLoading, isAuthenticated } = useConvexAuth();
	const [sorting, setSorting] = useState<SortingState>([]);
	const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
	const [globalFilter, setGlobalFilter] = useState("");

	const {
		data: rawData,
		isLoading,
		error,
		isError,
		refetch,
	} = useQuery({
		...queryOptions,
		enabled: enabled ?? isAuthenticated,
	});
	const data = unwrapQuery(rawData).data as TData[] | null;

	const table = useReactTable({
		data: data ?? [],
		columns,
		state: {
			sorting,
			columnFilters,
			globalFilter,
		},
		onSortingChange: setSorting,
		onColumnFiltersChange: setColumnFilters,
		onGlobalFilterChange: setGlobalFilter,
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
		setGlobalFilter,
	};
}
