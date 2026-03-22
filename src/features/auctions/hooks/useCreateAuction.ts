/**
 * useCreateAuction - React hook for creating auctions
 *
 * This hook provides:
 * - Mutation operation with Zod validation for creating new auctions
 */
import {
	fromErrorObject,
	InvalidAuctionStateErrorObject,
	NotAuthenticatedErrorObject,
	NotAuthorizedErrorObject,
	NotFoundErrorObject,
	UserInputValidationError,
	UserInputValidationErrorObject,
} from "@/global/types/errors";
import { AsyncReturn } from "@/global/types/types";
import { api } from "convex/_generated/api";
import type { AuctionId } from "convex/constants";
import { ConvexReactClient, useConvex } from "convex/react";
import { useCallback } from "react";
import type { AuctionsDomainError } from "../AuctionsErrors";
import { AuctionsValidationError } from "../AuctionsErrors";
import { CreateAuctionInputSchema, type CreateAuctionInput } from "../AuctionsSchemas";

// ============================================================================
// Types
// ============================================================================

export type AuctionResult<T> =
	| { success: true; value: T }
	| { success: false; error: AuctionsDomainError | AuctionsValidationError | Error };

export interface UseCreateAuctionReturn {
	/** Create a new auction (admin only) */
	createAuction: (input: CreateAuctionInput) => Promise<AuctionResult<AuctionId>>;
}

type CreateAuctionErrors =
	| NotAuthenticatedErrorObject
	| NotAuthorizedErrorObject
	| NotFoundErrorObject
	| UserInputValidationErrorObject
	| InvalidAuctionStateErrorObject;

async function createUpcomingAuction(
	client: ConvexReactClient,
	input: CreateAuctionInput
): AsyncReturn<AuctionId, CreateAuctionErrors> {
	// Validate input
	const validationResult = CreateAuctionInputSchema.safeParse(input);
	if (!validationResult.success) {
		return [
			null,
			new UserInputValidationError({
				fields: validationResult.error.issues.map((issue) => ({
					field: issue.path.join("."),
					message: issue.message,
				})),
			}).toObject(),
		];
	}

	try {
		const [value, error] = await client.mutation(api.auctions.createAuction, {
			title: validationResult.data.title,
			startDate: validationResult.data.startDate,
			endDate: validationResult.data.endDate,
			idempotencyKey: validationResult.data.idempotencyKey,
		});

		if (error) {
			console.error("createUpcomingAuction try error", error);
			// Convert error object to Error instance
			let errorInstance: Error;
			if (error && typeof error === "object" && "name" in error && typeof error.name === "string") {
				// Error is an error object from Convex
				errorInstance = fromErrorObject(error);
			} else if (error instanceof Error) {
				errorInstance = error;
			} else {
				errorInstance = new Error(String(error));
			}
			return [null, errorInstance];
		}

		if (!value) {
			return [null, new Error("No value returned from mutation")];
		}

		return [value, null];
	} catch (error) {
		console.error("createUpcomingAuction catch error", error);
		return [null, error instanceof Error ? error : new Error(String(error))];
	}
}
/**
 * Hook for creating auctions with validation.
 */
export function useCreateAuction(): UseCreateAuctionReturn {
	const client = useConvex();

	// Create an auction (admin only)
	const createAuction = useCallback(
		(input: CreateAuctionInput) => createUpcomingAuction(client, input),
		[client]
	);

	return {
		createAuction,
	};
}
