/**
 * useAuctionHandlers - Custom hook for auction management operations
 *
 * Simplifies error handling and provides handlers for starting and ending auctions.
 */
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { AuctionId } from "convex/constants";
import { useCallback } from "react";
import type { useAuctions } from "../../hooks/useAuctions";

type UseAuctionsReturn = ReturnType<typeof useAuctions>;

/**
 * Extracts a user-friendly error message from various error types
 */
function extractErrorMessage(error: unknown, defaultMessage: string): string {
	if (error instanceof Error) {
		return error.message;
	}

	if (error && typeof error === "object") {
		// Handle AuctionsValidationError
		if (
			"_tag" in error &&
			(error as { _tag: string })._tag === "AuctionsValidationError" &&
			"errors" in error
		) {
			const validationError = error as { errors: unknown };
			if (validationError.errors && typeof validationError.errors === "object") {
				return "Validation failed. Please check your input.";
			}
			return String(validationError.errors);
		}

		// Handle errors with message property
		if ("message" in error) {
			return String((error as { message: unknown }).message);
		}

		// Fallback to JSON stringify
		return JSON.stringify(error);
	}

	return defaultMessage;
}

/**
 * Hook for managing auction operations with simplified error handling
 */
export function useAuctionHandlers(
	startAuction: UseAuctionsReturn["startAuction"],
	endAuction: UseAuctionsReturn["endAuction"]
) {
	// Get upcoming auctions query for refetching
	const { refetch: refetchUpcoming } = useQuery({
		...convexQuery(api.auctions.getAuctionsByStatus, { status: "upcoming" }),
	});

	const handleStartAuction = useCallback(
		async (auctionId: AuctionId): Promise<void> => {
			const result = await startAuction(auctionId);

			if (result.success) {
				await refetchUpcoming();
				return;
			}

			const errorMessage = extractErrorMessage(result.error, "Failed to start auction");
			throw new Error(errorMessage);
		},
		[startAuction, refetchUpcoming]
	);

	const handleEndAuction = useCallback(
		async (auctionId: AuctionId): Promise<void> => {
			const result = await endAuction(auctionId);

			if (!result.success) {
				const errorMessage = extractErrorMessage(result.error, "Failed to end auction");
				throw new Error(errorMessage);
			}
		},
		[endAuction]
	);

	return {
		handleStartAuction,
		handleEndAuction,
	};
}
