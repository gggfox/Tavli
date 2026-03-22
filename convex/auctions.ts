/**
 * Auction mutations and queries.
 * Implements event sourcing + CQRS pattern for auction management.
 */
import { AUCTION_EVENT_TYPES, AUCTION_STATES, AuctionState } from "@/features/auctions/server";
import {
	InvalidAuctionStateError,
	InvalidAuctionStateErrorObject,
	NotAuthenticatedErrorObject,
	NotAuthorizedErrorObject,
	NotFoundError,
	NotFoundErrorObject,
	UserInputValidationError,
	UserInputValidationErrorObject,
} from "@/global/types/errors";
import { AsyncReturn } from "@/global/types/types";
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { getCurrentUserId, requireAdminRole } from "./_util/auth";
import { findExistingEventByKey, findExistingEventByKeyAndType } from "./_util/idempotency";
import type { AuctionDoc, AuctionId } from "./constants";
import { TABLE } from "./constants";

// ============================================================================
// Helper Functions
// ============================================================================

class AuctionStateManager {
	static async finishAuction(
		ctx: MutationCtx,
		activeAuctionId: AuctionId,
		userId: string
	): AsyncReturn<
		AuctionId,
		NotFoundErrorObject | InvalidAuctionStateErrorObject | NotAuthenticatedErrorObject
	> {
		// Fetch the auction to validate its state
		const auction = await ctx.db.get(activeAuctionId);
		if (!auction) {
			return [null, new NotFoundError("Auction not found").toObject()];
		}

		// Validate that the auction is in LIVE state before closing
		if (auction.status !== AUCTION_STATES.LIVE) {
			return [
				null,
				new InvalidAuctionStateError(
					`Auction must be in live state to be finished. Current state: ${auction.status}`
				).toObject(),
			];
		}

		const now = Date.now();

		// Create auction_finished event
		const eventId = await ctx.db.insert(TABLE.ALL_EVENTS, {
			eventType: AUCTION_EVENT_TYPES.AUCTION_FINISHED,
			aggregateType: TABLE.AUCTIONS,
			aggregateId: activeAuctionId,
			payload: {},
			userId,
			timestamp: now,
			createdAt: now,
		});

		if (!eventId) {
			return [
				null,
				new InvalidAuctionStateError("Failed to create auction_finished event").toObject(),
			];
		}

		// Update aggregate
		await ctx.db.patch(activeAuctionId, {
			status: AUCTION_STATES.FINISHED,
			lastUpdated: now,
		});

		return [activeAuctionId, null];
	}

	static async getAuctionsByStatus(
		ctx: QueryCtx | MutationCtx,
		status: AuctionState
	): AsyncReturn<AuctionDoc[], GetAuctionsByStatusErrors> {
		const [userId, userAuthenticationError] = await getCurrentUserId(ctx);
		if (userAuthenticationError) {
			return [null, userAuthenticationError];
		}

		const [_, userAuthorizationError] = await requireAdminRole(ctx, userId);
		if (userAuthorizationError) {
			return [null, userAuthorizationError];
		}
		const auctions = await ctx.db
			.query(TABLE.AUCTIONS)
			.withIndex("by_status", (q) => q.eq("status", status))
			.collect();

		const hasMultipleLiveAuctions = auctions.length > 1 && status === AUCTION_STATES.LIVE;
		if (hasMultipleLiveAuctions) {
			return [null, new InvalidAuctionStateError("Multiple live auctions found").toObject()];
		}
		return [auctions, null];
	}

	/**
	 * Finish expired live auctions and ensure no live auctions remain.
	 * This is used before starting a new auction to maintain the single live auction constraint.
	 */
	static async finishExpiredAuctionsAndValidateNoLiveAuctions(
		ctx: MutationCtx,
		userId: string
	): AsyncReturn<void, InvalidAuctionStateErrorObject | GetAuctionsByStatusErrors> {
		const now = Date.now();

		const [liveAuctions, liveAuctionsError] = await this.getAuctionsByStatus(
			ctx,
			AUCTION_STATES.LIVE
		);
		if (liveAuctionsError) {
			return [null, liveAuctionsError];
		}
		if (!liveAuctions) {
			return [undefined, null];
		}

		if (liveAuctions.length === 0) {
			return [undefined, null];
		}

		// Finish any expired live auctions
		const expiredAuctions = liveAuctions.filter((auction) => auction.endDate < now);
		for (const expiredAuction of expiredAuctions) {
			const [_, finishError] = await this.finishAuction(ctx, expiredAuction._id, userId);
			if (finishError) {
				// Log error but continue with other expired auctions
				console.error(`Failed to finish expired auction ${expiredAuction._id}:`, finishError);
			}
		}

		// Re-check for live auctions after finishing expired ones
		const [remainingLiveAuctions, remainingLiveAuctionsError] = await this.getAuctionsByStatus(
			ctx,
			AUCTION_STATES.LIVE
		);
		if (remainingLiveAuctionsError) {
			return [null, remainingLiveAuctionsError];
		}
		if (!remainingLiveAuctions) {
			return [undefined, null];
		}

		if (remainingLiveAuctions.length > 0) {
			return [
				null,
				new InvalidAuctionStateError(
					"Cannot start an auction while another auction is live"
				).toObject(),
			];
		}

		return [undefined, null];
	}
}

// ============================================================================
// Auction Queries
// ============================================================================

/**
 * Get a single auction by ID.
 */
export const getAuction = query({
	args: { auctionId: v.id(TABLE.AUCTIONS) },
	handler: async (ctx, args) => {
		return await ctx.db.get(args.auctionId);
	},
});

/**
 * Get auctions by status.
 */
type GetAuctionsByStatusErrors =
	| NotAuthenticatedErrorObject
	| NotAuthorizedErrorObject
	| InvalidAuctionStateErrorObject;

export const getAuctionsByStatus = query({
	args: {
		status: v.union(...Object.values(AUCTION_STATES).map((status) => v.literal(status))),
	},
	handler: async function (ctx, args): AsyncReturn<AuctionDoc[], GetAuctionsByStatusErrors> {
		return await AuctionStateManager.getAuctionsByStatus(ctx, args.status);
	},
});

/**
 * Get all auctions (for admin view).
 */
export const getAllAuctions = query({
	handler: async (ctx) => {
		return await ctx.db.query(TABLE.AUCTIONS).order("desc").collect();
	},
});

/**
 * Get the currently live/active auction.
 * Returns null if no auction is active.
 * Available to all authenticated users (not just admins).
 */
type GetLiveAuctionErrors = NotAuthenticatedErrorObject;

export const getLiveAuction = query({
	handler: async (ctx): AsyncReturn<AuctionDoc | null, GetLiveAuctionErrors> => {
		const [, userAuthenticationError] = await getCurrentUserId(ctx);
		if (userAuthenticationError) {
			return [null, userAuthenticationError];
		}

		// Direct query without admin role check - available to all authenticated users
		const liveAuction = await ctx.db
			.query(TABLE.AUCTIONS)
			.withIndex("by_status", (q) => q.eq("status", AUCTION_STATES.LIVE))
			.first();

		return [liveAuction, null];
	},
});

// ============================================================================
// Auction Mutations
// ============================================================================

/**
 * Create a new auction (admin only).
 * Uses Convex's built-in _id for identification.
 */

type CreateAuctionErrors =
	| NotAuthorizedErrorObject
	| NotFoundErrorObject
	| UserInputValidationErrorObject
	| GetAuctionsByStatusErrors;

export const createAuction = mutation({
	args: {
		title: v.optional(v.string()),
		startDate: v.number(),
		endDate: v.number(),
		idempotencyKey: v.optional(v.string()),
	},
	handler: async function (ctx, args): AsyncReturn<AuctionId, CreateAuctionErrors> {
		const [userId, userAuthenticationError] = await getCurrentUserId(ctx);
		if (userAuthenticationError) {
			return [null, userAuthenticationError];
		}

		const [_, userAuthorizationError] = await requireAdminRole(ctx, userId);
		if (userAuthorizationError) {
			return [null, userAuthorizationError];
		}

		// Server-side validation
		if (args.endDate <= args.startDate) {
			return [
				null,
				new UserInputValidationError({
					fields: [
						{ field: "endDate", message: "End date must be after start date" },
						{ field: "startDate", message: "Start date must be before end date" },
					],
				}).toObject(),
			];
		}

		// Check idempotency before creating the auction
		if (args.idempotencyKey) {
			const [existing, existingError] = await findExistingEventByKeyAndType(
				ctx,
				TABLE.AUCTIONS,
				args.idempotencyKey
			);

			if (existingError) {
				// NotFoundError is expected when no existing event is found
				// Only return error if it's a different error type
				if (existingError.name !== "NOT_FOUND") {
					return [null, existingError];
				}
			}

			if (existing) {
				return [existing.aggregateId as AuctionId, null];
			}
		}

		const now = Date.now();

		// Create aggregate
		const auctionId = await ctx.db.insert(TABLE.AUCTIONS, {
			title: args.title,
			startDate: args.startDate,
			endDate: args.endDate,
			status: AUCTION_STATES.UPCOMING,
			createdBy: userId,
			createdAt: now,
			lastUpdated: now,
		});

		// Create auction_created event
		await ctx.db.insert(TABLE.ALL_EVENTS, {
			eventType: AUCTION_EVENT_TYPES.AUCTION_CREATED,
			aggregateType: TABLE.AUCTIONS,
			aggregateId: auctionId,
			payload: {
				title: args.title,
				startDate: args.startDate,
				endDate: args.endDate,
			},
			userId: userId,
			timestamp: now,
			idempotencyKey: args.idempotencyKey,
			createdAt: now,
		});

		return [auctionId, null];
	},
});

/**
 * Start an auction (transition from upcoming to active).
 */

type SetAuctionStateToLiveErrors =
	| NotAuthenticatedErrorObject
	| NotAuthorizedErrorObject
	| NotFoundErrorObject
	| UserInputValidationErrorObject
	| InvalidAuctionStateErrorObject;

export const setAuctionStateToLive = mutation({
	args: {
		auctionId: v.id(TABLE.AUCTIONS),
		idempotencyKey: v.optional(v.string()),
	},
	handler: async function (ctx, args): AsyncReturn<AuctionId, SetAuctionStateToLiveErrors> {
		const [userId, userAuthenticationError] = await getCurrentUserId(ctx);
		if (userAuthenticationError) {
			return [null, userAuthenticationError];
		}

		const [, userAuthorizationError] = await requireAdminRole(ctx, userId);
		if (userAuthorizationError) {
			return [null, userAuthorizationError];
		}

		const auction = await ctx.db.get(args.auctionId);
		if (!auction) {
			return [null, new NotFoundError("Auction not found").toObject()];
		}

		if (auction.status !== AUCTION_STATES.UPCOMING) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "auctionId", message: "Auction must be in upcoming status to start" }],
				}).toObject(),
			];
		}

		const now = Date.now();

		// Finish expired auctions and ensure no live auctions remain
		const [, validationError] =
			await AuctionStateManager.finishExpiredAuctionsAndValidateNoLiveAuctions(ctx, userId);
		if (validationError) {
			return [null, validationError];
		}

		// Check idempotency
		if (args.idempotencyKey) {
			const [existing, existingError] = await findExistingEventByKey(
				ctx,
				TABLE.AUCTIONS,
				args.auctionId as string,
				args.idempotencyKey
			);

			if (existingError) {
				// NotFoundError is expected when no existing event is found
				// Only return error if it's a different error type
				if (existingError.name !== "NOT_FOUND") {
					return [null, existingError];
				}
			}

			if (existing) {
				return [args.auctionId, null];
			}
		}

		// Create auction_started event
		await ctx.db.insert(TABLE.ALL_EVENTS, {
			eventType: AUCTION_EVENT_TYPES.AUCTION_STARTED,
			aggregateType: TABLE.AUCTIONS,
			aggregateId: args.auctionId,
			payload: {},
			userId: userId,
			timestamp: now,
			idempotencyKey: args.idempotencyKey,
			createdAt: now,
		});

		// Update aggregate
		await ctx.db.patch(args.auctionId, {
			status: AUCTION_STATES.LIVE,
			lastUpdated: now,
		});

		return [args.auctionId, null];
	},
});

/**
 * Close an auction (transition from active to finished).
 * Automatically creates the next upcoming auction based on frequency.
 */

type CloseAuctionErrors =
	| NotAuthenticatedErrorObject
	| NotAuthorizedErrorObject
	| NotFoundErrorObject
	| UserInputValidationErrorObject
	| InvalidAuctionStateErrorObject;

export const closeAuction = mutation({
	args: {
		auctionId: v.id(TABLE.AUCTIONS),
		idempotencyKey: v.optional(v.string()),
	},
	handler: async function (ctx, args): AsyncReturn<AuctionId, CloseAuctionErrors> {
		const [userId, userAuthenticationError] = await getCurrentUserId(ctx);
		if (userAuthenticationError) {
			return [null, userAuthenticationError];
		}

		const [_, userAuthorizationError] = await requireAdminRole(ctx, userId);
		if (userAuthorizationError) {
			return [null, userAuthorizationError];
		}

		const auction = await ctx.db.get(args.auctionId);
		if (!auction) {
			return [null, new NotFoundError("Auction not found").toObject()];
		}

		if (auction.status !== AUCTION_STATES.LIVE) {
			return [
				null,
				new InvalidAuctionStateError("Auction must be in live status to close").toObject(),
			];
		}

		// Check idempotency
		if (args.idempotencyKey) {
			const [existing, existingError] = await findExistingEventByKey(
				ctx,
				TABLE.AUCTIONS,
				args.auctionId as string,
				args.idempotencyKey
			);

			if (existingError) {
				// NotFoundError is expected when no existing event is found
				// Only return error if it's a different error type
				if (existingError.name !== "NOT_FOUND") {
					return [null, existingError];
				}
			}

			if (existing) {
				return [args.auctionId, null];
			}
		}

		const [finishedAuctionId, finishedAuctionError] = await AuctionStateManager.finishAuction(
			ctx,
			args.auctionId,
			userId
		);
		if (finishedAuctionError) {
			return [null, finishedAuctionError];
		}

		return [finishedAuctionId, null];
	},
});

/**
 * Cancel an auction.
 */

type CancelAuctionErrors =
	| NotAuthenticatedErrorObject
	| NotAuthorizedErrorObject
	| NotFoundErrorObject
	| UserInputValidationErrorObject;

export const cancelAuction = mutation({
	args: {
		auctionId: v.id(TABLE.AUCTIONS),
		idempotencyKey: v.optional(v.string()),
	},
	handler: async function (ctx, args): AsyncReturn<boolean, CancelAuctionErrors> {
		const [userId, userAuthenticationError] = await getCurrentUserId(ctx);
		if (userAuthenticationError) {
			return [null, userAuthenticationError];
		}

		const [_, userAuthorizationError] = await requireAdminRole(ctx, userId);
		if (userAuthorizationError) {
			return [null, userAuthorizationError];
		}

		const auction = await ctx.db.get(args.auctionId);
		if (!auction) {
			return [null, new NotFoundError("Auction not found").toObject()];
		}

		if (auction.status === AUCTION_STATES.FINISHED) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "auctionId", message: "Cannot cancel a finished auction" }],
					message: "Cannot cancel a finished auction",
				}).toObject(),
			];
		}

		// Check idempotency
		if (args.idempotencyKey) {
			const [existing, existingError] = await findExistingEventByKey(
				ctx,
				TABLE.AUCTIONS,
				args.auctionId as string,
				args.idempotencyKey
			);

			if (existingError) {
				// NotFoundError is expected when no existing event is found
				// Only return error if it's a different error type
				if (existingError.name !== "NOT_FOUND") {
					return [null, existingError];
				}
			}

			if (existing) {
				return [true, null];
			}
		}

		const now = Date.now();

		// Create auction_cancelled event
		await ctx.db.insert(TABLE.ALL_EVENTS, {
			eventType: AUCTION_EVENT_TYPES.AUCTION_CANCELLED,
			aggregateType: TABLE.AUCTIONS,
			aggregateId: args.auctionId,
			payload: {},
			userId: userId,
			timestamp: now,
			idempotencyKey: args.idempotencyKey,
			createdAt: now,
		});

		// Update aggregate - mark as cancelled
		await ctx.db.patch(args.auctionId, {
			status: AUCTION_STATES.CANCELLED,
			lastUpdated: now,
		});

		return [true, null];
	},
});
