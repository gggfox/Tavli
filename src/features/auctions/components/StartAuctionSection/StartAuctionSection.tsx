/**
 * StartAuctionSection - Admin component for starting live auctions
 *
 * Displays scheduled auctions and allows admins to start them manually.
 * Also shows the current live auction status and allows creating new auctions.
 */
import { useCreateAuction } from "@/features";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { AuctionDoc, AuctionId } from "convex/constants";
import { useConvex, useConvexAuth } from "convex/react";
import { Loader2, Plus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { CreateAuctionInput } from "../../AuctionsSchemas";
import { CreateAuctionForm } from "./CreateAuctionForm";
import { LiveAuctionStatus } from "./LiveAuctionStatus";
import { ScheduledAuctionsList } from "./ScheduledAuctionsList";

export function StartAuctionSection() {
	const { isAuthenticated } = useConvexAuth();
	const client = useConvex();
	const { createAuction } = useCreateAuction();
	const [showCreateForm, setShowCreateForm] = useState(false);

	// Get live auction using regular query (not suspense) to avoid issues with unauthenticated users
	const { data: rawLiveAuctionData, refetch: refetchLiveAuction } = useQuery({
		...convexQuery(api.auctions.getLiveAuction, {}),
		enabled: isAuthenticated,
	});
	// Extract live auction from AsyncReturn tuple [data, error]
	const liveAuction: AuctionDoc | null = useMemo(
		() =>
			Array.isArray(rawLiveAuctionData) && rawLiveAuctionData[0] ? rawLiveAuctionData[0] : null,
		[rawLiveAuctionData]
	);

	// Get upcoming auctions
	const {
		data: rawUpcomingAuctions,
		isLoading: isLoadingUpcoming,
		refetch: refetchUpcoming,
	} = useQuery({
		...convexQuery(api.auctions.getAuctionsByStatus, { status: "upcoming" }),
		enabled: isAuthenticated,
	});
	// Extract the first element from the tuple [data, error] returned by AsyncReturn
	const upcomingAuctions: AuctionDoc[] = useMemo(
		() =>
			Array.isArray(rawUpcomingAuctions) && rawUpcomingAuctions[0] !== null
				? rawUpcomingAuctions[0]
				: [],
		[rawUpcomingAuctions]
	);

	// Start auction handler using direct Convex client
	const handleStartAuction = useCallback(
		async (auctionId: AuctionId) => {
			const [, error] = await client.mutation(api.auctions.setAuctionStateToLive, {
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
			await refetchUpcoming();
			await refetchLiveAuction();
		},
		[client, refetchUpcoming, refetchLiveAuction]
	);

	// End auction handler using direct Convex client
	const handleEndAuction = useCallback(
		async (auctionId: AuctionId) => {
			const [, error] = await client.mutation(api.auctions.closeAuction, {
				auctionId,
			});
			if (error) {
				const errorMessage =
					error instanceof Error
						? error.message
						: typeof error === "object" && error !== null && "message" in error
							? String((error as { message: unknown }).message)
							: "Failed to end auction";
				throw new Error(errorMessage);
			}
			await refetchLiveAuction();
		},
		[client, refetchLiveAuction]
	);

	const onCreateAuction = async (input: CreateAuctionInput): Promise<AuctionId> => {
		const result = await createAuction(input);

		if (result.success) {
			await refetchUpcoming();
			setShowCreateForm(false);
			return result.value;
		}

		let errorMessage = "Failed to create auction";
		if (result.error instanceof Error) {
			errorMessage = result.error.message;
		} else if (
			typeof result.error === "object" &&
			result.error !== null &&
			"message" in result.error
		) {
			errorMessage = String(result.error.message);
		}
		console.error({ errorMessage });
		throw new Error(errorMessage);
	};

	return (
		<div className="space-y-6">
			{/* Current Live Auction Status */}
			<div>
				<h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
					Current Status
				</h3>
				<LiveAuctionStatus liveAuction={liveAuction} onEndAuction={handleEndAuction} />
			</div>

			{/* Create New Auction */}
			<div>
				<div className="flex items-center justify-between mb-3">
					<h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
						Create New Auction
					</h3>
					{!showCreateForm && (
						<button
							onClick={() => setShowCreateForm(true)}
							className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors"
							style={{
								backgroundColor: "rgb(59, 130, 246)",
								color: "white",
							}}
						>
							<Plus size={14} />
							<span>New Auction</span>
						</button>
					)}
				</div>
				{showCreateForm && (
					<div
						className="p-4 rounded-lg border"
						style={{
							backgroundColor: "var(--bg-secondary)",
							borderColor: "var(--border-default)",
						}}
					>
						<CreateAuctionForm
							onCreate={onCreateAuction}
							onCancel={() => setShowCreateForm(false)}
						/>
					</div>
				)}
			</div>

			{/* Upcoming Auctions */}
			<div>
				<h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
					Upcoming Auctions
				</h3>
				{isLoadingUpcoming ? (
					<div
						className="p-4 rounded-lg border flex items-center justify-center"
						style={{
							backgroundColor: "var(--bg-secondary)",
							borderColor: "var(--border-default)",
						}}
					>
						<Loader2
							size={16}
							className="animate-spin"
							style={{ color: "var(--text-secondary)" }}
						/>
					</div>
				) : (
					<ScheduledAuctionsList
						scheduledAuctions={upcomingAuctions}
						onStartAuction={handleStartAuction}
					/>
				)}
			</div>
		</div>
	);
}
