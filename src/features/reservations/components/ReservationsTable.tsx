/**
 * Sortable, searchable table view for the reservations dashboard.
 */
import {
	getStatusToneStyle,
	StatusBadge,
	SortIcon,
	toneByValue,
} from "@/global/components";
import { SearchInput } from "@/global/components/SearchInput";
import { Pagination } from "@/global/components/Table/Pagination";
import { ReservationsKeys } from "@/global/i18n";
import type { Doc, Id } from "convex/_generated/dataModel";
import {
	flexRender,
	getCoreRowModel,
	getFilteredRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	useReactTable,
	type ColumnDef,
	type SortingState,
} from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	getReservationStatusConfig,
	RESERVATION_FALLBACK_TONE,
	RESERVATION_STATUS_CONFIG,
	type ReservationStatus,
} from "../statusConfig";
import { formatTimeOnly } from "../utils";

export type ReservationTableRow = Doc<"reservations"> & {
	readonly restaurantName?: string;
};

const STATUS_SORT_INDEX = Object.fromEntries(
	RESERVATION_STATUS_CONFIG.map((s, i) => [s.value, i])
) as Record<ReservationStatus, number>;

interface ReservationsTableProps {
	readonly data: readonly ReservationTableRow[];
	readonly isMultiRestaurant: boolean;
	readonly onOpen: (id: Id<"reservations">) => void;
}

export function ReservationsTable({
	data,
	isMultiRestaurant,
	onOpen,
}: Readonly<ReservationsTableProps>) {
	const { t, i18n } = useTranslation();
	const [sorting, setSorting] = useState<SortingState>([
		{ id: "startsAt", desc: false },
	]);
	const [globalFilter, setGlobalFilter] = useState("");

	const columns = useMemo<ColumnDef<ReservationTableRow>[]>(() => {
		const base: ColumnDef<ReservationTableRow>[] = [
			{
				id: "status",
				accessorFn: (row) => row.status,
				header: ({ column }) => (
					<button
						type="button"
						className="flex items-center gap-1.5 hover:opacity-80 transition-opacity text-left w-full"
						onClick={column.getToggleSortingHandler()}
					>
						{t(ReservationsKeys.COLUMN_STATUS)}
						<SortIcon column={column} />
					</button>
				),
				sortingFn: (rowA, rowB) => {
					const a =
						STATUS_SORT_INDEX[rowA.original.status as ReservationStatus] ?? 0;
					const b =
						STATUS_SORT_INDEX[rowB.original.status as ReservationStatus] ?? 0;
					return a - b;
				},
				cell: ({ row }) => {
					const r = row.original;
					const tone =
						toneByValue(RESERVATION_STATUS_CONFIG, r.status as ReservationStatus) ??
						RESERVATION_FALLBACK_TONE;
					const palette = getStatusToneStyle(tone);
					const config = getReservationStatusConfig(r.status);
					const label = config ? t(config.labelKey) : r.status;
					return (
						<StatusBadge bgColor={palette.solidBg} textColor={palette.solidFg} label={label} />
					);
				},
			},
			{
				id: "guest",
				accessorFn: (row) => row.contact.name,
				header: ({ column }) => (
					<button
						type="button"
						className="flex items-center gap-1.5 hover:opacity-80 transition-opacity text-left w-full"
						onClick={column.getToggleSortingHandler()}
					>
						{t(ReservationsKeys.COLUMN_GUEST)}
						<SortIcon column={column} />
					</button>
				),
				cell: ({ row }) => (
					<span className="text-sm font-medium text-foreground truncate max-w-[12rem] block">
						{row.original.contact.name}
					</span>
				),
			},
			{
				id: "party",
				accessorFn: (row) => row.partySize,
				header: ({ column }) => (
					<button
						type="button"
						className="flex items-center gap-1.5 hover:opacity-80 transition-opacity text-left w-full"
						onClick={column.getToggleSortingHandler()}
					>
						{t(ReservationsKeys.COLUMN_PARTY)}
						<SortIcon column={column} />
					</button>
				),
			},
			{
				id: "startsAt",
				accessorFn: (row) => row.startsAt,
				header: ({ column }) => (
					<button
						type="button"
						className="flex items-center gap-1.5 hover:opacity-80 transition-opacity text-left w-full"
						onClick={column.getToggleSortingHandler()}
					>
						{t(ReservationsKeys.COLUMN_DATE)}
						<SortIcon column={column} />
					</button>
				),
				cell: ({ row }) => (
					<span className="text-sm text-muted-foreground whitespace-nowrap">
						{new Date(row.original.startsAt).toLocaleDateString(i18n.language)}
					</span>
				),
			},
			{
				id: "time",
				accessorFn: (row) => row.startsAt,
				header: ({ column }) => (
					<button
						type="button"
						className="flex items-center gap-1.5 hover:opacity-80 transition-opacity text-left w-full"
						onClick={column.getToggleSortingHandler()}
					>
						{t(ReservationsKeys.COLUMN_TIME)}
						<SortIcon column={column} />
					</button>
				),
				cell: ({ row }) => (
					<span className="text-sm text-muted-foreground whitespace-nowrap">
						{formatTimeOnly(row.original.startsAt, i18n.language)}
					</span>
				),
			},
			{
				id: "source",
				accessorFn: (row) => row.source,
				enableSorting: false,
				header: () => <span>{t(ReservationsKeys.COLUMN_SOURCE)}</span>,
				cell: ({ row }) => {
					const src = row.original.source;
					let key = ReservationsKeys.SOURCE_UI;
					if (src === "whatsapp") key = ReservationsKeys.SOURCE_WHATSAPP;
					else if (src === "staff") key = ReservationsKeys.SOURCE_STAFF;
					return (
						<span className="text-sm text-muted-foreground capitalize">{t(key)}</span>
					);
				},
			},
			{
				id: "tables",
				accessorFn: (row) => row.tableIds.length,
				enableSorting: false,
				header: () => <span>{t(ReservationsKeys.COLUMN_TABLES)}</span>,
				cell: ({ row }) => {
					const n = row.original.tableIds.length;
					return (
						<span className="text-sm text-muted-foreground tabular-nums">
							{n === 0 ? "—" : String(n)}
						</span>
					);
				},
			},
			{
				id: "notes",
				accessorFn: (row) => row.notes ?? "",
				enableSorting: false,
				header: () => <span>{t(ReservationsKeys.COLUMN_NOTES)}</span>,
				cell: ({ row }) => {
					const notes = row.original.notes?.trim() ?? "";
					if (!notes) {
						return <span className="text-sm text-faint-foreground">—</span>;
					}
					const short = notes.length > 48 ? `${notes.slice(0, 45)}…` : notes;
					return (
						<span className="text-sm text-muted-foreground truncate max-w-[14rem] block" title={notes}>
							{short}
						</span>
					);
				},
			},
		];

		if (isMultiRestaurant) {
			base.push({
				id: "restaurant",
				accessorFn: (row) => row.restaurantName ?? "",
				header: ({ column }) => (
					<button
						type="button"
						className="flex items-center gap-1.5 hover:opacity-80 transition-opacity text-left w-full"
						onClick={column.getToggleSortingHandler()}
					>
						{t(ReservationsKeys.COLUMN_RESTAURANT)}
						<SortIcon column={column} />
					</button>
				),
				cell: ({ row }) => (
					<span className="text-sm text-muted-foreground truncate max-w-[10rem] block">
						{row.original.restaurantName ?? "—"}
					</span>
				),
			});
		}

		return base;
	}, [t, i18n.language, isMultiRestaurant]);

	const table = useReactTable({
		data: data as ReservationTableRow[],
		columns,
		state: { sorting, globalFilter },
		onSortingChange: setSorting,
		onGlobalFilterChange: setGlobalFilter,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		getPaginationRowModel: getPaginationRowModel(),
		globalFilterFn: (row, _columnId, filterValue) => {
			const q = String(filterValue ?? "")
				.toLowerCase()
				.trim()
				.replace(/\s/g, "");
			if (!q) return true;
			const r = row.original;
			const name = r.contact.name.toLowerCase();
			const phone = r.contact.phone.replace(/\s/g, "").toLowerCase();
			return name.includes(q) || phone.includes(q);
		},
		initialState: {
			pagination: { pageSize: 25 },
		},
	});

	const filteredCount = table.getFilteredRowModel().rows.length;

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap gap-4 items-center">
				<SearchInput
					placeholder={t(ReservationsKeys.TABLE_SEARCH_PLACEHOLDER)}
					value={globalFilter}
					onChange={setGlobalFilter}
				/>
				<div className="text-sm text-muted-foreground">
					{filteredCount}{" "}
					{filteredCount === 1 ? "reservation" : "reservations"}
				</div>
			</div>

			<div className="overflow-auto rounded-lg bg-muted border border-border">
				<table className="w-full border-collapse min-w-[56rem]">
					<thead>
						{table.getHeaderGroups().map((headerGroup) => (
							<tr key={headerGroup.id}>
								{headerGroup.headers.map((header) => (
									<th
										key={header.id}
										className="px-4 py-3 text-left text-sm font-medium sticky top-0 bg-muted text-muted-foreground border-b border-border"
									>
										{header.isPlaceholder
											? null
											: flexRender(header.column.columnDef.header, header.getContext())}
									</th>
								))}
							</tr>
						))}
					</thead>
					<tbody>
						{table.getRowModel().rows.map((row) => (
							<tr
								key={row.id}
								className="border-b border-border transition-colors cursor-pointer hover:bg-background/50"
								onClick={() => onOpen(row.original._id)}
							>
								{row.getVisibleCells().map((cell) => (
									<td key={cell.id} className="px-4 py-3 align-middle">
										{flexRender(cell.column.columnDef.cell, cell.getContext())}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>

			<Pagination table={table} />
		</div>
	);
}
