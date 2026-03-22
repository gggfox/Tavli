import { Pagination } from "@/global";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import {
	createColumnHelper,
	flexRender,
	getCoreRowModel,
	getFilteredRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	useReactTable,
	type ColumnFiltersState,
	type SortingState,
} from "@tanstack/react-table";
import { api } from "convex/_generated/api";
import type { AuctionId, MaterialDoc } from "convex/constants";
import { useConvex, useConvexAuth } from "convex/react";
import { Search } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { AuctionHeader } from "./AuctionHeader";
import { AuthLoadingState } from "./AuthLoadingState";
import { BidButton } from "./BidButton";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { LoadingSkeleton } from "./LoadingSkeleton";
import { NoActiveAuction } from "./NoActiveAuction";
import { NotAuthenticatedState } from "./NotAuthenticatedState";
import { ScheduledAuctionsSection } from "./ScheduledAuctionsSection";
import { SortIcon } from "./SortIcon";
import { formatCurrency, formatQuantity } from "./utils";

type Material = MaterialDoc;
type LiveAuctionMaterial = {
	material: Material;
	choices: string[];
	forms: string[];
	finishes: string[];
	highestBid: {
		amount: number;
		bidderId: string;
		totalBids: number;
		currentSequence: number;
	} | null;
};

const columnHelper = createColumnHelper<LiveAuctionMaterial>();

export function LiveAuctionsTable() {
	const { isLoading: isAuthLoading, isAuthenticated } = useConvexAuth();
	const client = useConvex();
	const [sorting, setSorting] = useState<SortingState>([]);
	const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
	const [globalFilter, setGlobalFilter] = useState("");

	// Get user roles to check if admin
	// Extract the first element from the tuple [data, error] returned by AsyncReturn
	const { data: rawUserRoles } = useQuery({
		...convexQuery(api.admin.getCurrentUserRoles, {}),
		enabled: isAuthenticated,
	});
	const userRoles: string[] =
		Array.isArray(rawUserRoles) && rawUserRoles[0] !== null ? rawUserRoles[0] : [];

	const isAdmin = useMemo(() => userRoles.includes("admin"), [userRoles]);

	// Only run query when authenticated
	const {
		data: liveAuctionData,
		isLoading,
		error,
		isError,
		refetch,
	} = useQuery({
		...convexQuery(api.materials.getLiveAuctionMaterials, {}),
		enabled: isAuthenticated,
	});

	// Get scheduled auctions (for admin to start)
	const { data: rawScheduledAuctions, isLoading: isLoadingScheduled } = useQuery({
		...convexQuery(api.auctions.getAuctionsByStatus, { status: "upcoming" }),
		enabled: isAuthenticated && isAdmin,
	});
	// Extract scheduled auctions from AsyncReturn tuple [data, error]
	const scheduledAuctions = useMemo(
		() => (Array.isArray(rawScheduledAuctions) && rawScheduledAuctions[0] ? rawScheduledAuctions[0] : []),
		[rawScheduledAuctions]
	);

	// Start auction handler using direct Convex client (admin only)
	// This avoids using useAuctions() hook which has suspense queries that throw on unauthenticated users
	const handleStartAuction = useCallback(
		async (auctionId: AuctionId) => {
			try {
				const [value, error] = await client.mutation(api.auctions.setAuctionStateToLive, {
					auctionId,
				});

				if (error) {
					const errorMessage =
						error instanceof Error
							? error.message
							: typeof error === "object" && error !== null && "message" in error
								? String((error as { message: unknown }).message)
								: "Failed to start auction";
					throw new Error(errorMessage);
				}

				if (value) {
					// Refetch to update the table
					await refetch();
				}
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : "Failed to start auction";
				throw new Error(errorMessage);
			}
		},
		[client, refetch]
	);

	// Memoize columns creation to use auction data
	const columns = useMemo(() => {
		const auctionId = liveAuctionData?.auction?._id;

		return [
			columnHelper.accessor("material.materialId", {
				header: "Material ID",
				cell: (info) => {
					const materialId = info.getValue();
					return (
						<span
							className="font-mono text-xs font-medium"
							style={{ color: "var(--text-primary)" }}
						>
							{materialId}
						</span>
					);
				},
			}),
			columnHelper.accessor("choices", {
				header: "Choice",
				cell: (info) => {
					const choices = info.getValue();
					return (
						<span className="text-sm" style={{ color: "var(--text-primary)" }}>
							{choices.length > 0 ? choices.join(", ") : "—"}
						</span>
					);
				},
			}),
			columnHelper.accessor("finishes", {
				header: "Finish",
				cell: (info) => {
					const finishes = info.getValue();
					return (
						<span className="text-sm" style={{ color: "var(--text-primary)" }}>
							{finishes.length > 0 ? finishes.join(", ") : "—"}
						</span>
					);
				},
			}),
			columnHelper.accessor("forms", {
				header: "Form",
				cell: (info) => {
					const forms = info.getValue();
					return (
						<span className="text-sm" style={{ color: "var(--text-primary)" }}>
							{forms.length > 0 ? forms.join(", ") : "—"}
						</span>
					);
				},
			}),
			columnHelper.accessor("material.location", {
				header: "Location",
				cell: (info) => {
					const location = info.getValue();
					return (
						<span className="text-sm" style={{ color: "var(--text-secondary)" }}>
							{location}
						</span>
					);
				},
			}),
			columnHelper.accessor("material.normalizedQuantity", {
				header: "Quantity",
				cell: (info) => {
					const quantity = info.getValue();
					return (
						<span className="text-sm" style={{ color: "var(--text-secondary)" }}>
							{formatQuantity(quantity)}
						</span>
					);
				},
			}),
			columnHelper.accessor("highestBid", {
				header: "Highest Bid",
				cell: (info) => {
					const bid = info.getValue();
					if (!bid) {
						return (
							<span className="text-sm" style={{ color: "var(--text-muted)" }}>
								No bids
							</span>
						);
					}
					return (
						<div>
							<span className="text-sm font-semibold" style={{ color: "rgb(34, 197, 94)" }}>
								{formatCurrency(bid.amount)}
							</span>
							<span className="text-xs ml-1" style={{ color: "var(--text-muted)" }}>
								({bid.totalBids} bid{bid.totalBids !== 1 ? "s" : ""})
							</span>
						</div>
					);
				},
			}),
			columnHelper.display({
				id: "actions",
				header: "",
				cell: (info) => {
					const row = info.row.original;
					if (!auctionId) return null;
					return (
						<BidButton
							material={row.material}
							auctionId={auctionId}
							highestBid={row.highestBid}
							onBidPlaced={() => refetch()}
						/>
					);
				},
			}),
		];
	}, [liveAuctionData?.auction?._id, refetch]);

	const table = useReactTable({
		data: liveAuctionData?.materials ?? [],
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
	if (liveAuctionData === undefined) {
		return <LoadingSkeleton />;
	}

	// No active auction
	if (!liveAuctionData.auction) {
		return (
			<div className="flex flex-col h-full">
				{/* Scheduled Auctions Section (Admin Only) */}
				{isAdmin && !isLoadingScheduled && scheduledAuctions.length > 0 && (
					<ScheduledAuctionsSection
						scheduledAuctions={scheduledAuctions}
						onStartAuction={handleStartAuction}
					/>
				)}
				<NoActiveAuction />
			</div>
		);
	}

	return (
		<div className="flex flex-col h-full">
			{/* Scheduled Auctions Section (Admin Only) */}
			{isAdmin && !isLoadingScheduled && scheduledAuctions.length > 0 && (
				<ScheduledAuctionsSection
					scheduledAuctions={scheduledAuctions}
					onStartAuction={handleStartAuction}
				/>
			)}

			{/* Auction Header with End Time */}
			<AuctionHeader auction={liveAuctionData.auction} />

			{/* Show empty state if no materials, otherwise show table */}
			{liveAuctionData.materials.length === 0 ? (
				<EmptyState />
			) : (
				<>
					{/* Search and filters */}
					<div className="mb-4 flex gap-4 items-center">
						<div className="relative flex-1 max-w-md">
							<Search
								size={16}
								className="absolute left-3 top-1/2 -translate-y-1/2"
								style={{ color: "var(--text-muted)" }}
							/>
							<input
								type="text"
								placeholder="Search materials..."
								value={globalFilter}
								onChange={(e) => setGlobalFilter(e.target.value)}
								className="w-full pl-9 pr-4 py-2 rounded-lg text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-(--btn-primary-bg) focus:border-transparent"
								style={{
									backgroundColor: "var(--bg-secondary)",
									color: "var(--text-primary)",
									border: "1px solid var(--border-default)",
								}}
							/>
						</div>
						<div className="text-sm" style={{ color: "var(--text-secondary)" }}>
							{table.getFilteredRowModel().rows.length} material
							{table.getFilteredRowModel().rows.length === 1 ? "" : "s"}
						</div>
					</div>

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
													if (header.isPlaceholder || header.column.id === "actions") {
														return null;
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
										className="transition-colors hover:bg-(--bg-hover)"
										style={{
											borderBottom: "1px solid var(--border-default)",
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
				</>
			)}
		</div>
	);
}
