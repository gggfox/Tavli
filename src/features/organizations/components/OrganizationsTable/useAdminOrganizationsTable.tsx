import { unwrapQuery } from "@/global/utils";
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

export function useAdminOrganizationsTable() {
	const { isLoading: isAuthLoading, isAuthenticated } = useConvexAuth();
	const [sorting, setSorting] = useState<SortingState>([]);
	const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
	const [globalFilter, setGlobalFilter] = useState("");

	const {
		data: rawOrgs,
		isLoading,
		error,
		isError,
		refetch,
	} = useQuery({
		...convexQuery(api.organizations.getAllOrganizations, {}),
		enabled: isAuthenticated,
	});
	const organizations = unwrapQuery(rawOrgs).data;

	const table = useReactTable({
		data: organizations ?? [],
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
			pagination: {
				pageSize: 10,
			},
		},
	});

	return {
		table,
		organizations,
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
