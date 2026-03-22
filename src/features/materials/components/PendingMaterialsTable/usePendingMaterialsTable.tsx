import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import {
	ColumnFiltersState,
	getCoreRowModel,
	getFilteredRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	SortingState,
	useReactTable,
} from "@tanstack/react-table";
import { api } from "convex/_generated/api";
import { useConvexAuth } from "convex/react";
import { useState } from "react";
import { columns } from "./Columns";

export function usePendingMaterialsTable() {
	const { isLoading: isAuthLoading, isAuthenticated } = useConvexAuth();
	const [sorting, setSorting] = useState<SortingState>([]);
	const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
	const [globalFilter, setGlobalFilter] = useState("");

	// Only run query when authenticated
	const {
		data: materials,
		isLoading,
		error,
		isError,
		refetch,
	} = useQuery({
		...convexQuery(api.materials.getSellerPendingMaterials, {}),
		enabled: isAuthenticated,
	});

	const table = useReactTable({
		data: materials ?? [],
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
		getRowId: (row) => row.materialId,
		initialState: {
			pagination: {
				pageSize: 10,
			},
		},
	});

	return {
		table,
		materials,
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




