/**
 * useAuctions - React hook for auction operations
 *
 * This hook provides:
 * - Real-time auction data via Convex subscriptions (convexQuery)
 * - Mutation operations with Zod validation
 */
import { fromErrorObject } from "@/global/types/errors";
import { convexQuery } from "@convex-dev/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { AuctionDoc, AuctionId, BidDoc, BidId, MaterialId } from "convex/constants";
import { useConvex } from "convex/react";
import { useCallback, useMemo } from "react";
import type { AuctionsDomainError } from "../AuctionsErrors";
import { AuctionsValidationError } from "../AuctionsErrors";
import { PlaceBidInputSchema, type PlaceBidInput } from "../AuctionsSchemas";

/**
 * Helper function to convert error objects to Error instances.
 * Used for consistent error handling across the hook.
 */
function toError(error: unknown): Error {
	if (error instanceof Error) {
		return error;
	}
	if (error && typeof error === "object" && "name" in error && "message" in error) {
		return fromErrorObject(error as { name: string; message: string });
	}
	return new Error(String(error));
}

// ============================================================================
// Domain Types - Derived from Convex schema
// ============================================================================

export type Auction = AuctionDoc;
export type BidAggregate = BidDoc;

// ============================================================================
// Types
// ============================================================================

export type AuctionResult<T> =
	| { success: true; value: T }
	| { success: false; error: AuctionsDomainError | AuctionsValidationError | Error };

export interface UseAuctionsReturn {
	/** Currently live auction (if any) */
	liveAuction: Auction | null;

	/** All active auctions */
	activeAuctions: readonly Auction[];

	/** Place a bid */
	placeBid: (input: PlaceBidInput) => Promise<AuctionResult<BidId>>;

	/** Withdraw a bid */
	withdrawBid: (
		auctionId: AuctionId,
		materialId: MaterialId,
		idempotencyKey?: string
	) => Promise<AuctionResult<BidId>>;

	/** Start an auction (admin only) */
	startAuction: (auctionId: AuctionId, idempotencyKey?: string) => Promise<AuctionResult<string>>;

	/** End an active auction early (admin only) - transitions from active to finished */
	endAuction: (auctionId: AuctionId, idempotencyKey?: string) => Promise<AuctionResult<string>>;

	/** Add a material to the current live auction (admin or seller only) */
	addMaterialToLiveAuction: (
		materialId: string,
		idempotencyKey?: string
	) => Promise<AuctionResult<string>>;

	/** Auction counts */
	counts: {
		active: number;
	};
}

/**
 * Hook for auction operations with real-time data.
 */
export function useAuctions(): UseAuctionsReturn {
	const client = useConvex();

	// Real-time subscription to live auction
	// getLiveAuction now returns [AuctionDoc | null, error] - available to all authenticated users
	const {
		data: [liveAuctionData, liveAuctionError],
	} = useSuspenseQuery(convexQuery(api.auctions.getLiveAuction, {}));

	// Convert error object to proper Error instance before throwing
	if (liveAuctionError) {
		throw toError(liveAuctionError);
	}

	// liveAuctionData is now AuctionDoc | null (not an array)
	const liveAuction = liveAuctionData ?? null;

	// Active auctions are the same as the live auction for now (single live auction constraint)
	// This avoids calling the admin-only getAuctionsByStatus endpoint
	const activeAuctions = useMemo<readonly Auction[]>(
		() => (liveAuction ? [liveAuction] : []),
		[liveAuction]
	);

	// Place a bid
	// TODO: Uncomment when bids.ts is implemented with AsyncReturn pattern
	const placeBid = useCallback(async (input: PlaceBidInput): Promise<AuctionResult<BidId>> => {
		// Validate input
		const validationResult = PlaceBidInputSchema.safeParse(input);
		if (!validationResult.success) {
			return {
				success: false,
				error: new AuctionsValidationError("placeBid", validationResult.error),
			};
		}

		// TODO: Implement when bids.ts is uncommented and uses AsyncReturn
		return {
			success: false,
			error: new Error("Bid functionality not yet implemented"),
		};
	}, []);

	// Withdraw a bid
	// TODO: Uncomment when bids.ts is implemented with AsyncReturn pattern
	const withdrawBid = useCallback(
		async (
			_auctionId: AuctionId,
			_materialId: MaterialId,
			_idempotencyKey?: string
		): Promise<AuctionResult<BidId>> => {
			// TODO: Implement when bids.ts is uncommented and uses AsyncReturn
			return {
				success: false,
				error: new Error("Bid withdrawal functionality not yet implemented"),
			};
		},
		[]
	);

	// Start an auction (admin only)
	const startAuction = useCallback(
		async (auctionId: AuctionId, idempotencyKey?: string): Promise<AuctionResult<string>> => {
			try {
				const [value, error] = await client.mutation(api.auctions.setAuctionStateToLive, {
					auctionId,
					idempotencyKey,
				});

				if (error) {
					return {
						success: false,
						error: error instanceof Error ? error : new Error(String(error)),
					};
				}

				return { success: true, value };
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error : new Error(String(error)),
				};
			}
		},
		[client]
	);

	// End an active auction early (admin only)
	const endAuction = useCallback(
		async (auctionId: AuctionId, idempotencyKey?: string): Promise<AuctionResult<string>> => {
			try {
				const [value, error] = await client.mutation(api.auctions.closeAuction, {
					auctionId,
					idempotencyKey,
				});

				if (error) {
					return {
						success: false,
						error: error instanceof Error ? error : new Error(String(error)),
					};
				}

				return { success: true, value };
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error : new Error(String(error)),
				};
			}
		},
		[client]
	);

	// Add a material to the current live auction (admin or seller only)
	const addMaterialToLiveAuction = useCallback(
		async (materialId: string, idempotencyKey?: string): Promise<AuctionResult<string>> => {
			try {
				const [value, error] = await client.mutation(api.materials.addMaterialToLiveAuction, {
					materialId,
					idempotencyKey,
				});

				if (error) {
					return {
						success: false,
						error: error instanceof Error ? error : new Error(String(error)),
					};
				}

				return { success: true, value };
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error : new Error(String(error)),
				};
			}
		},
		[client]
	);

	return {
		liveAuction,
		activeAuctions,
		placeBid,
		withdrawBid,
		startAuction,
		endAuction,
		addMaterialToLiveAuction,
		counts: {
			active: activeAuctions.length,
		},
	};
}

// ============================================================================
// Bid Aggregate Hook
// ============================================================================

export interface UseBidAggregateReturn {
	/** Bid aggregate for the material */
	bidAggregate: BidAggregate | null;

	/** Current sequence number (for optimistic concurrency) */
	currentSequence: number;

	/** Highest bid amount */
	highestBidAmount: number | null;

	/** Total number of bids */
	totalBids: number;
}

/**
 * Hook to get bid aggregate for a specific material in an auction.
 */
export function useBidAggregate(
	_auctionId: AuctionId | null,
	_materialId: MaterialId | null
): UseBidAggregateReturn {
	// TODO: Uncomment when bids.ts is implemented
	// const shouldQuery = auctionId !== null && materialId !== null;
	// const { data: bidAggregate } = useQuery({
	// 	...convexQuery(api.bids.getBidAggregate, shouldQuery ? { auctionId, materialId } : "skip"),
	// 	enabled: shouldQuery,
	// });
	const bidAggregate = null as BidAggregate | null;

	return {
		bidAggregate,
		currentSequence: bidAggregate?.currentSequence ?? 0,
		highestBidAmount: bidAggregate?.highestBidAmount ?? null,
		totalBids: bidAggregate?.totalBids ?? 0,
	};
}
