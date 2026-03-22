import { convexQuery } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	ColumnFiltersState,
	getCoreRowModel,
	getFilteredRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	RowSelectionState,
	SortingState,
	useReactTable,
} from "@tanstack/react-table";
import { api } from "convex/_generated/api";
import { useConvex, useConvexAuth } from "convex/react";
import { useCallback, useState } from "react";
import { columns } from "./Columns";

export function useMaterialsApprovalTable() {
	const { isLoading: isAuthLoading, isAuthenticated } = useConvexAuth();
	const convex = useConvex();
	const [sorting, setSorting] = useState<SortingState>([]);
	const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
	const [globalFilter, setGlobalFilter] = useState("");
	const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

	// Only run query when authenticated
	const {
		data: materials,
		isLoading,
		error,
		isError,
		refetch,
	} = useQuery({
		...convexQuery(api.materials.getPendingMaterials, {}),
		enabled: isAuthenticated,
	});

	// Approval mutation
	const approveMutation = useMutation({
		mutationFn: async (materialIds: string[]) => {
			// Approve all selected materials in parallel
			const results = await Promise.allSettled(
				materialIds.map((materialId) =>
					convex.mutation(api.materials.approveMaterial, {
						materialId,
						idempotencyKey: `approve-${materialId}-${Date.now()}`,
					})
				)
			);

			const failures = results.filter((r) => r.status === "rejected");
			if (failures.length > 0) {
				throw new Error(`Failed to approve ${failures.length} material(s)`);
			}

			return results;
		},
		onSuccess: () => {
			// Clear selection and refetch
			setRowSelection({});
			refetch();
		},
	});

	const table = useReactTable({
		data: materials ?? [],
		columns,
		state: {
			sorting,
			columnFilters,
			globalFilter,
			rowSelection,
		},
		enableRowSelection: true,
		onRowSelectionChange: setRowSelection,
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

	const selectedMaterialIds = Object.keys(rowSelection).filter((key) => rowSelection[key]);

	const handleApproveSelected = useCallback(() => {
		if (selectedMaterialIds.length > 0) {
			approveMutation.mutate(selectedMaterialIds);
		}
	}, [selectedMaterialIds, approveMutation]);

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
		rowSelection,
		selectedMaterialIds,
		handleApproveSelected,
		isApproving: approveMutation.isPending,
		approvalError: approveMutation.error,
	};
}



