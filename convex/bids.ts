// /**
//  * Bid mutations and queries.
//  * Implements event sourcing + CQRS pattern for bidding system.
//  *
//  * Features:
//  * - Idempotency support (prevent duplicate bids)
//  * - Rate limiting (30 seconds per material)
//  * - Optimistic concurrency control (sequence numbers)
//  * - Real-time bid tracking via aggregates
//  */
// import { v } from "convex/values";
// import { mutation, query } from "./_generated/server";
// import { isSupportedCurrency, validateSingleLiveAuction } from "./_util/auctions";
// import { getAuthenticatedUser } from "./_util/authenticatedUser";
// import { generateEventId } from "./_util/idGenerator";
// import { TABLE } from "./constants";

// // ============================================================================
// // Bid Queries
// // ============================================================================

// /**
//  * Get the highest bid for a material in an auction.
//  */
// export const getHighestBid = query({
// 	args: {
// 		auctionId: v.id(TABLE.AUCTIONS),
// 		materialId: v.id("materialAggregates"),
// 	},
// 	handler: async (ctx, args) => {
// 		const aggregate = await ctx.db
// 			.query("bidAggregates")
// 			.withIndex("by_auction_material", (q) =>
// 				q.eq("auctionId", args.auctionId).eq("materialId", args.materialId)
// 			)
// 			.first();

// 		return aggregate;
// 	},
// });

// /**
//  * Get all bids for a material in an auction.
//  * Returns bids in descending order (most recent first).
//  */
// export const getMaterialBids = query({
// 	args: {
// 		auctionId: v.id(TABLE.AUCTIONS),
// 		materialId: v.id("materialAggregates"),
// 	},
// 	handler: async (ctx, args) => {
// 		const bids = await ctx.db
// 			.query(TABLE.BIDS)
// 			.withIndex("by_auction_material", (q) =>
// 				q.eq("auctionId", args.auctionId).eq("materialId", args.materialId)
// 			)
// 			.order("desc")
// 			.collect();

// 		return bids.map((bid) => ({
// 			bidderId: bid.bidderId,
// 			amount: bid.amount,
// 			currency: bid.currency,
// 			priceUnit: bid.priceUnit,
// 			timestamp: bid.timestamp,
// 			eventType: bid.eventType,
// 		}));
// 	},
// });

// /**
//  * Get a user's bid history.
//  */
// export const getUserBids = query({
// 	args: {
// 		limit: v.optional(v.number()),
// 	},
// 	handler: async (ctx, args) => {
// 		const identity = await ctx.auth.getUserIdentity();
// 		if (!identity) {
// 			return [];
// 		}

// 		const bids = await ctx.db
// 			.query("bidEvents")
// 			.withIndex("by_bidder", (q) => q.eq("bidderId", identity.subject))
// 			.order("desc")
// 			.take(args.limit ?? 50);

// 		return bids;
// 	},
// });

// /**
//  * Get bid aggregate for a material (includes current sequence for concurrency control).
//  */
// export const getBidAggregate = query({
// 	args: {
// 		auctionId: v.id(TABLE.AUCTIONS),
// 		materialId: v.id("materialAggregates"),
// 	},
// 	handler: async (ctx, args) => {
// 		return await ctx.db
// 			.query("bidAggregates")
// 			.withIndex("by_auction_material", (q) =>
// 				q.eq("auctionId", args.auctionId).eq("materialId", args.materialId)
// 			)
// 			.first();
// 	},
// });

// /**
//  * Get all bid aggregates for an auction.
//  */
// export const getAuctionBidAggregates = query({
// 	args: {
// 		auctionId: v.id(TABLE.AUCTIONS),
// 	},
// 	handler: async (ctx, args) => {
// 		return await ctx.db
// 			.query("bidAggregates")
// 			.withIndex("by_auction", (q) => q.eq("auctionId", args.auctionId))
// 			.collect();
// 	},
// });

// // ============================================================================
// // Bid Mutations
// // ============================================================================

// /**
//  * Place a bid on a material.
//  *
//  * Features:
//  * - Idempotency: Uses idempotencyKey to prevent duplicate bids
//  * - Rate limiting: 30 second cooldown per material
//  * - Concurrency control: Uses sequence numbers for optimistic locking
//  * - Validation: Bid must exceed current highest, auction must be live
//  */
// export const placeBid = mutation({
// 	args: {
// 		auctionId: v.id(TABLE.AUCTIONS),
// 		materialId: v.id("materialAggregates"),
// 		amount: v.number(),
// 		currency: v.string(),
// 		expectedSequence: v.number(),
// 		idempotencyKey: v.optional(v.string()),
// 	},
// 	handler: async (ctx, args) => {
// 		const identity = await getAuthenticatedUser(ctx);

// 		// Server-side validation
// 		if (args.amount <= 0) {
// 			throw new Error("Bid amount must be greater than 0");
// 		}

// 		// Validate currency
// 		if (!isSupportedCurrency(args.currency)) {
// 			throw new Error(`Unsupported currency: ${args.currency}. Supported: MXN, USD, EUR`);
// 		}

// 		// Check idempotency
// 		if (args.idempotencyKey) {
// 			const existing = await ctx.db
// 				.query("bidEvents")
// 				.withIndex("by_idempotency", (q) =>
// 					q.eq("bidderId", identity.subject).eq("idempotencyKey", args.idempotencyKey)
// 				)
// 				.first();

// 			if (existing) {
// 				return existing._id; // Idempotent return
// 			}
// 		}

// 		// Rate limiting: Check recent bids using indexed query + pagination
// 		const thirtySecondsAgo = Date.now() - 30000;
// 		const recentBidsPage = await ctx.db
// 			.query("bidEvents")
// 			.withIndex("by_bidder_timestamp", (q) =>
// 				q.eq("bidderId", identity.subject).gt("timestamp", thirtySecondsAgo)
// 			)
// 			.order("desc")
// 			.take(100);

// 		// Filter by materialId and eventType (only count bid_placed events, not bid_withdrawn)
// 		const recentBidsForMaterial = recentBidsPage.filter(
// 			(bid) => bid.materialId === args.materialId && bid.eventType === "bid_placed"
// 		);

// 		if (recentBidsForMaterial.length > 0) {
// 			throw new Error(
// 				"Rate limit: Please wait 30 seconds before placing another bid on this material"
// 			);
// 		}

// 		// Check auction is live
// 		const auction = await ctx.db.get(args.auctionId);
// 		if (!auction || auction.status !== "live") {
// 			throw new Error("Auction is not active");
// 		}

// 		// Validate single live auction constraint
// 		await validateSingleLiveAuction(ctx, args.auctionId);

// 		// Check material exists
// 		const material = await ctx.db.get(args.materialId);
// 		if (!material) {
// 			throw new Error("Material not found");
// 		}

// 		// Check material is approved
// 		if (material.status !== "approved") {
// 			throw new Error("Material is not approved for bidding");
// 		}

// 		// Check current highest bid and validate sequence for concurrency control
// 		const aggregate = await ctx.db
// 			.query("bidAggregates")
// 			.withIndex("by_auction_material", (q) =>
// 				q.eq("auctionId", args.auctionId).eq("materialId", args.materialId)
// 			)
// 			.first();

// 		// Optimistic concurrency control: validate sequence number
// 		const currentSequence = aggregate?.currentSequence ?? 0;
// 		if (args.expectedSequence !== currentSequence) {
// 			throw new Error(
// 				`Bid conflict: another bid was placed. Expected sequence ${args.expectedSequence}, current is ${currentSequence}. Please retry.`
// 			);
// 		}

// 		if (aggregate && args.amount <= aggregate.highestBidAmount) {
// 			throw new Error(
// 				`Bid must be higher than current highest bid of ${aggregate.highestBidAmount} ${args.currency}`
// 			);
// 		}

// 		const now = Date.now();
// 		const newSequence = currentSequence + 1;
// 		const eventId = generateEventId();

// 		// Create bid event with sequence number
// 		const bidEventId = await ctx.db.insert("bidEvents", {
// 			eventId,
// 			eventType: "bid_placed",
// 			auctionId: args.auctionId,
// 			materialId: args.materialId,
// 			bidderId: identity.subject,
// 			amount: args.amount,
// 			currency: args.currency,
// 			sequenceNumber: newSequence,
// 			schemaVersion: 1,
// 			syncedToUnified: false,
// 			idempotencyKey: args.idempotencyKey,
// 			timestamp: now,
// 			createdAt: now,
// 		});

// 		// Update aggregate (or create if doesn't exist) with new sequence
// 		if (aggregate) {
// 			// Check if this is a new unique bidder
// 			const isNewBidder = aggregate.highestBidderId !== identity.subject;

// 			await ctx.db.patch(aggregate._id, {
// 				highestBidAmount: args.amount,
// 				highestBidderId: identity.subject,
// 				highestBidEventId: eventId,
// 				highestBidTimestamp: now,
// 				currentSequence: newSequence,
// 				totalBids: aggregate.totalBids + 1,
// 				uniqueBidders: isNewBidder ? aggregate.uniqueBidders + 1 : aggregate.uniqueBidders,
// 				lastUpdated: now,
// 			});
// 		} else {
// 			await ctx.db.insert("bidAggregates", {
// 				auctionId: args.auctionId,
// 				materialId: args.materialId,
// 				highestBidAmount: args.amount,
// 				highestBidderId: identity.subject,
// 				highestBidEventId: eventId,
// 				highestBidTimestamp: now,
// 				currentSequence: newSequence,
// 				totalBids: 1,
// 				uniqueBidders: 1,
// 				lastUpdated: now,
// 			});
// 		}

// 		return bidEventId;
// 	},
// });

// /**
//  * Withdraw a bid (soft withdrawal - bid event remains immutable).
//  * Creates a bid_withdrawn event that marks the bid as withdrawn.
//  */
// export const withdrawBid = mutation({
// 	args: {
// 		auctionId: v.id(TABLE.AUCTIONS),
// 		materialId: v.id("materialAggregates"),
// 		idempotencyKey: v.optional(v.string()),
// 	},
// 	handler: async (ctx, args) => {
// 		const identity = await getAuthenticatedUser(ctx);

// 		// Check idempotency
// 		if (args.idempotencyKey) {
// 			const existing = await ctx.db
// 				.query(TABLE.ALL_EVENTS)
// 				.withIndex("by_idempotency", (q) =>
// 					q.eq("bidderId", identity.subject).eq("idempotencyKey", args.idempotencyKey)
// 				)
// 				.first();

// 			if (existing?.eventType === "bid_withdrawn") {
// 				return existing._id;
// 			}
// 		}

// 		// Get the user's latest bid for this material
// 		const userBids = await ctx.db
// 			.query(TABLE.ALL_EVENTS)
// 			.withIndex("by_auction_material", (q) =>
// 				q.eq("auctionId", args.auctionId).eq("materialId", args.materialId)
// 			)
// 			.order("desc")
// 			.collect();

// 		const latestUserBid = userBids.find(
// 			(bid) => bid.bidderId === identity.subject && bid.eventType === "bid_placed"
// 		);

// 		if (!latestUserBid) {
// 			throw new Error("No active bid found to withdraw");
// 		}

// 		// Check if already withdrawn
// 		const hasWithdrawn = userBids.some(
// 			(bid) =>
// 				bid.bidderId === identity.subject &&
// 				bid.eventType === "bid_withdrawn" &&
// 				bid.timestamp > latestUserBid.timestamp
// 		);

// 		if (hasWithdrawn) {
// 			throw new Error("Bid has already been withdrawn");
// 		}

// 		// Get current aggregate for sequence number
// 		const aggregate = await ctx.db
// 			.query(TABLE.BIDS)
// 			.withIndex("by_auction_material", (q) =>
// 				q.eq("auctionId", args.auctionId).eq("materialId", args.materialId)
// 			)
// 			.first();

// 		const currentSequence = aggregate?.currentSequence ?? 0;
// 		const newSequence = currentSequence + 1;

// 		const now = Date.now();
// 		const eventId = generateEventId();

// 		// Create bid_withdrawn event
// 		const withdrawEventId = await ctx.db.insert(TABLE.BIDS, {
// 			eventId,
// 			eventType: "bid_withdrawn",
// 			auctionId: args.auctionId,
// 			materialId: args.materialId,
// 			bidderId: identity.subject,
// 			amount: latestUserBid.amount,
// 			currency: latestUserBid.currency,
// 			sequenceNumber: newSequence,
// 			schemaVersion: 1,
// 			syncedToUnified: false,
// 			idempotencyKey: args.idempotencyKey,
// 			timestamp: now,
// 			createdAt: now,
// 		});

// 		// If this was the highest bidder, recalculate the aggregate
// 		if (aggregate && aggregate.highestBidderId === identity.subject) {
// 			// Find the next highest bid (excluding withdrawn bids from this user)
// 			const allBids = await ctx.db
// 				.query(TABLE.BIDS)
// 				.withIndex("by_auction_material", (q) =>
// 					q.eq("auctionId", args.auctionId).eq("materialId", args.materialId)
// 				)
// 				.order("desc")
// 				.collect();

// 			// Filter to only placed bids and exclude the withdrawing user
// 			const validBids = allBids.filter(
// 				(bid) => bid.eventType === "bid_placed" && bid.bidderId !== identity.subject
// 			);

// 			if (validBids.length > 0) {
// 				// Sort by amount to find highest
// 				const sortedBids = validBids.sort((a, b) => b.amount - a.amount);
// 				const newHighestBid = sortedBids[0];

// 				await ctx.db.patch(aggregate._id, {
// 					highestBidAmount: newHighestBid.amount,
// 					highestBidderId: newHighestBid.bidderId,
// 					highestBidEventId: newHighestBid.eventId,
// 					highestBidTimestamp: newHighestBid.timestamp,
// 					currentSequence: newSequence,
// 					lastUpdated: now,
// 				});
// 			} else {
// 				// No other bids - delete the aggregate
// 				await ctx.db.delete(aggregate._id);
// 			}
// 		} else if (aggregate) {
// 			// Just update the sequence number
// 			await ctx.db.patch(aggregate._id, {
// 				currentSequence: newSequence,
// 				lastUpdated: now,
// 			});
// 		}

// 		return withdrawEventId;
// 	},
// });
