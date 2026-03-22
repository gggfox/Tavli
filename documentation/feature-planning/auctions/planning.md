# Auctions Feature - Implementation Planning

## Overview

This document provides a phased implementation plan for the live auctions feature based on the [research document](./research.md). Each phase includes specific tasks across all layers: Convex backend, Effect-TS services, React components, and tests.

**Target Stack:**

- **Backend**: Convex (schema, mutations, queries, scheduled functions)
- **Services**: Effect-TS (services, schemas, error handling)
- **Frontend**: React + TanStack Router
- **Testing**: Vitest + Convex test utilities

---

## Phase 1: Foundation - Schema & Core Tables

### 1.1 Convex Schema - Reference Tables

**Files to create/modify:**

- `convex/schema.ts`
- `convex/_seed/categories.ts`
- `convex/_seed/forms.ts`
- `convex/_seed/finishes.ts`
- `convex/_seed/choices.ts`

**Tasks:**

- [ ] **1.1.1** Add `categories` table with indexes
- [ ] **1.1.2** Add `forms` table with indexes
- [ ] **1.1.3** Add `finishes` table with indexes
- [ ] **1.1.4** Add `choices` table with indexes
- [ ] **1.1.5** Create seed data mutation for reference tables
- [ ] **1.1.6** Add `userRoles` table with indexes

**Schema additions:**

```typescript
// convex/schema.ts additions for Phase 1.1
userRoles: defineTable({
  userId: v.string(),
  roles: v.array(v.union(v.literal("admin"), v.literal("seller"), v.literal("buyer"))),
  organizationId: v.optional(v.id("organizations")),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_organizationId", ["organizationId"]),

categories: defineTable({
  name: v.string(),
  groupTitle: v.string(),
  createdAt: v.number(),
})
  .index("by_group", ["groupTitle"])
  .index("by_name", ["name"]),

forms: defineTable({
  name: v.string(),
  createdAt: v.number(),
}).index("by_name", ["name"]),

finishes: defineTable({
  name: v.string(),
  createdAt: v.number(),
}).index("by_name", ["name"]),

choices: defineTable({
  name: v.string(),
  createdAt: v.number(),
}).index("by_name", ["name"]),
```

**Tests:**

- [ ] `convex/_tests/schema.test.ts` - Validate schema structure
- [ ] `convex/_tests/seed.test.ts` - Test seed data insertion

---

### 1.2 Convex Schema - Event Sourcing Tables

**Files to create:**

- `convex/schema.ts` (extend)

**Tasks:**

- [ ] **1.2.1** Add `auctionEvents` table with all event types
- [ ] **1.2.2** Add `auctionAggregates` table (CQRS read model)
- [ ] **1.2.3** Add `materialEvents` table
- [ ] **1.2.4** Add `materialAggregates` table
- [ ] **1.2.5** Add `bidEvents` table with concurrency control
- [ ] **1.2.6** Add `bidAggregates` table
- [ ] **1.2.7** Add junction tables (materialCategories, materialForms, materialFinishes, materialChoices)
- [ ] **1.2.8** Add `auctionMaterialEvents` and `auctionMaterialAggregates` tables

**Schema additions:**

```typescript
// convex/schema.ts additions for Phase 1.2
auctionEvents: defineTable({
  eventId: v.string(),
  eventType: v.union(
    v.literal("auction_created"),
    v.literal("auction_scheduled"),
    v.literal("auction_started"),
    v.literal("auction_closed"),
    v.literal("auction_cancelled")
  ),
  auctionId: v.id("auctionAggregates"),
  title: v.optional(v.string()),
  startDate: v.optional(v.number()),
  endDate: v.optional(v.number()),
  frequency: v.optional(
    v.union(v.literal("weekly"), v.literal("biweekly"), v.literal("monthly"), v.literal("custom"))
  ),
  createdBy: v.optional(v.string()),
  schemaVersion: v.number(),
  syncedToUnified: v.optional(v.boolean()),
  idempotencyKey: v.optional(v.string()),
  timestamp: v.number(),
  createdAt: v.number(),
})
  .index("by_auction", ["auctionId"])
  .index("by_event_type", ["eventType"])
  .index("by_idempotency", ["auctionId", "idempotencyKey"])
  .index("by_timestamp", ["timestamp"]),

auctionAggregates: defineTable({
  title: v.optional(v.string()),
  startDate: v.number(),
  endDate: v.number(),
  frequency: v.union(
    v.literal("weekly"),
    v.literal("biweekly"),
    v.literal("monthly"),
    v.literal("custom")
  ),
  status: v.union(
    v.literal("draft"),
    v.literal("scheduled"),
    v.literal("live"),
    v.literal("closed"),
    v.literal("cancelled")
  ),
  createdBy: v.string(),
  createdAt: v.number(),
  lastEventId: v.string(),
  lastUpdated: v.number(),
})
  .index("by_status", ["status"])
  .index("by_date_range", ["startDate", "endDate"])
  .index("by_created_by", ["createdBy"]),

bidEvents: defineTable({
  eventId: v.string(),
  eventType: v.union(
    v.literal("bid_placed"),
    v.literal("bid_updated"),
    v.literal("bid_withdrawn")
  ),
  auctionId: v.id("auctionAggregates"),
  materialId: v.id("materialAggregates"),
  bidderId: v.string(),
  amount: v.number(),
  currency: v.string(),
  priceUnit: v.optional(v.string()),
  sequenceNumber: v.number(),
  schemaVersion: v.number(),
  idempotencyKey: v.optional(v.string()),
  timestamp: v.number(),
  createdAt: v.number(),
})
  .index("by_auction_material", ["auctionId", "materialId"])
  .index("by_bidder", ["bidderId"])
  .index("by_bidder_timestamp", ["bidderId", "timestamp"])
  .index("by_idempotency", ["bidderId", "idempotencyKey"])
  .index("by_timestamp", ["timestamp"]),

bidAggregates: defineTable({
  auctionId: v.id("auctionAggregates"),
  materialId: v.id("materialAggregates"),
  highestBidAmount: v.number(),
  highestBidderId: v.string(),
  highestBidEventId: v.string(),
  highestBidTimestamp: v.number(),
  currentSequence: v.number(),
  totalBids: v.number(),
  uniqueBidders: v.number(),
  lastUpdated: v.number(),
})
  .index("by_auction_material", ["auctionId", "materialId"])
  .index("by_auction", ["auctionId"]),
```

**Tests:**

- [ ] `convex/_tests/auctionEvents.test.ts` - Test event creation and indexes
- [ ] `convex/_tests/bidEvents.test.ts` - Test bid event creation with sequence numbers

---

### 1.3 Helper Utilities

**Files to create:**

- `convex/_util/roles.ts`
- `convex/_util/auctions.ts`
- `convex/_util/idGenerator.ts`

**Tasks:**

- [ ] **1.3.1** Create `requireAdminRole` helper
- [ ] **1.3.2** Create `requireSellerRole` helper
- [ ] **1.3.3** Create `hasRole` helper
- [ ] **1.3.4** Create `getMexicoCityTime` helper
- [ ] **1.3.5** Create `calculateNextAuctionDates` helper
- [ ] **1.3.6** Create `validateSingleLiveAuction` helper
- [ ] **1.3.7** Create ID generation utilities (material, template)

**Implementation:**

```typescript
// convex/_util/roles.ts
import { DatabaseReader, DatabaseWriter } from "./_generated/server";

export async function requireAdminRole(ctx: { db: DatabaseWriter }, userId: string): Promise<void> {
	const userRole = await ctx.db
		.query("userRoles")
		.withIndex("by_user", (q) => q.eq("userId", userId))
		.first();

	if (!userRole || !userRole.roles.includes("admin")) {
		throw new Error("Admin role required");
	}
}

export async function requireSellerRole(
	ctx: { db: DatabaseWriter },
	userId: string
): Promise<void> {
	const userRole = await ctx.db
		.query("userRoles")
		.withIndex("by_user", (q) => q.eq("userId", userId))
		.first();

	if (!userRole || !userRole.roles.includes("seller")) {
		throw new Error("Seller role required");
	}
}

export async function hasRole(
	ctx: { db: DatabaseReader },
	userId: string,
	role: "admin" | "seller" | "buyer"
): Promise<boolean> {
	const userRole = await ctx.db
		.query("userRoles")
		.withIndex("by_user", (q) => q.eq("userId", userId))
		.first();

	return userRole?.roles.includes(role) ?? false;
}
```

**Tests:**

- [ ] `convex/_tests/roles.test.ts` - Test role validation helpers
- [ ] `convex/_tests/auctions.util.test.ts` - Test auction utility functions

---

## Phase 2: Core Auction Backend

### 2.1 Auction Mutations

**Files to create:**

- `convex/auctions.ts`

**Tasks:**

- [ ] **2.1.1** Implement `createAuction` mutation (admin only)
- [ ] **2.1.2** Implement `scheduleAuction` mutation
- [ ] **2.1.3** Implement `startAuction` mutation
- [ ] **2.1.4** Implement `closeAuction` mutation with auto-creation of next auction
- [ ] **2.1.5** Implement `cancelAuction` mutation
- [ ] **2.1.6** Add idempotency support to all mutations

**Implementation:**

```typescript
// convex/auctions.ts
import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { getAuthenticatedUser } from "./_util/authenticatedUser";
import { requireAdminRole } from "./_util/roles";
import { validateSingleLiveAuction, calculateNextAuctionDates } from "./_util/auctions";

export const createAuction = mutation({
	args: {
		title: v.optional(v.string()),
		startDate: v.number(),
		endDate: v.number(),
		frequency: v.union(
			v.literal("weekly"),
			v.literal("biweekly"),
			v.literal("monthly"),
			v.literal("custom")
		),
		idempotencyKey: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const identity = await getAuthenticatedUser(ctx);
		await requireAdminRole(ctx, identity.subject);

		// Server-side validation
		if (args.endDate <= args.startDate) {
			throw new Error("End date must be after start date");
		}

		// Validate single live auction constraint
		await validateSingleLiveAuction(ctx);

		const now = Date.now();
		const eventId = crypto.randomUUID();

		// Create aggregate first to get the _id
		const auctionId = await ctx.db.insert("auctionAggregates", {
			title: args.title,
			startDate: args.startDate,
			endDate: args.endDate,
			frequency: args.frequency,
			status: "draft",
			createdBy: identity.subject,
			createdAt: now,
			lastEventId: eventId,
			lastUpdated: now,
		});

		// Check idempotency
		if (args.idempotencyKey) {
			const existing = await ctx.db
				.query("auctionEvents")
				.withIndex("by_idempotency", (q) =>
					q.eq("auctionId", auctionId).eq("idempotencyKey", args.idempotencyKey)
				)
				.first();

			if (existing) {
				await ctx.db.delete(auctionId);
				return existing.auctionId;
			}
		}

		// Create event
		await ctx.db.insert("auctionEvents", {
			eventId,
			eventType: "auction_created",
			auctionId,
			title: args.title,
			startDate: args.startDate,
			endDate: args.endDate,
			frequency: args.frequency,
			createdBy: identity.subject,
			schemaVersion: 1,
			syncedToUnified: false,
			idempotencyKey: args.idempotencyKey,
			timestamp: now,
			createdAt: now,
		});

		return auctionId;
	},
});
```

**Tests:**

- [ ] `convex/_tests/auctions.test.ts`
  - Test auction creation with valid inputs
  - Test auction creation fails without admin role
  - Test idempotency prevents duplicate auctions
  - Test validation (end date > start date)
  - Test single live auction constraint

---

### 2.2 Auction Queries

**Tasks:**

- [ ] **2.2.1** Implement `getActiveAuctions` query
- [ ] **2.2.2** Implement `getAuction` query (by ID)
- [ ] **2.2.3** Implement `getAuctionsByStatus` query
- [ ] **2.2.4** Implement `getAuctionEvents` query (for audit)

**Implementation:**

```typescript
// convex/auctions.ts (continued)
export const getActiveAuctions = query({
	handler: async (ctx) => {
		const now = Date.now();
		return await ctx.db
			.query("auctionAggregates")
			.withIndex("by_status", (q) => q.eq("status", "live"))
			.filter((q) => q.and(q.lte(q.field("startDate"), now), q.gte(q.field("endDate"), now)))
			.collect();
	},
});

export const getAuction = query({
	args: { auctionId: v.id("auctionAggregates") },
	handler: async (ctx, args) => {
		return await ctx.db.get(args.auctionId);
	},
});

export const getAuctionsByStatus = query({
	args: {
		status: v.union(
			v.literal("draft"),
			v.literal("scheduled"),
			v.literal("live"),
			v.literal("closed"),
			v.literal("cancelled")
		),
	},
	handler: async (ctx, args) => {
		return await ctx.db
			.query("auctionAggregates")
			.withIndex("by_status", (q) => q.eq("status", args.status))
			.collect();
	},
});
```

**Tests:**

- [ ] `convex/_tests/auctions.queries.test.ts`
  - Test getActiveAuctions returns only live auctions
  - Test getAuction returns correct auction
  - Test getAuctionsByStatus filtering

---

### 2.3 Scheduled Functions

**Files to create:**

- `convex/crons.ts`

**Tasks:**

- [ ] **2.3.1** Create `activateScheduledAuctions` internal mutation
- [ ] **2.3.2** Create `closeExpiredAuctions` internal mutation
- [ ] **2.3.3** Configure cron jobs in `crons.ts`

**Implementation:**

```typescript
// convex/crons.ts
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
	"activate scheduled auctions",
	{ minutes: 30 },
	internal.auctions.activateScheduledAuctions
);

crons.interval("close expired auctions", { minutes: 30 }, internal.auctions.closeExpiredAuctions);

export default crons;
```

**Tests:**

- [ ] `convex/_tests/crons.test.ts`
  - Test scheduled auction activation
  - Test expired auction closing
  - Test automatic next auction creation

---

## Phase 3: Bidding System

### 3.1 Bid Mutations

**Files to create:**

- `convex/bids.ts`

**Tasks:**

- [ ] **3.1.1** Implement `placeBid` mutation with:
  - Idempotency support
  - Rate limiting (30 seconds per material)
  - Optimistic concurrency control (sequence numbers)
  - Auction live validation
  - Bid amount validation (> current highest)
- [ ] **3.1.2** Implement `withdrawBid` mutation (soft withdrawal)

**Implementation:**

```typescript
// convex/bids.ts
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthenticatedUser } from "./_util/authenticatedUser";
import { validateSingleLiveAuction } from "./_util/auctions";

export const placeBid = mutation({
	args: {
		auctionId: v.id("auctionAggregates"),
		materialId: v.id("materialAggregates"),
		amount: v.number(),
		currency: v.string(),
		expectedSequence: v.number(),
		idempotencyKey: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const identity = await getAuthenticatedUser(ctx);

		// Validation
		if (args.amount <= 0) {
			throw new Error("Bid amount must be greater than 0");
		}

		const SUPPORTED_CURRENCIES = ["MXN", "USD", "EUR"] as const;
		if (!SUPPORTED_CURRENCIES.includes(args.currency as any)) {
			throw new Error(`Unsupported currency: ${args.currency}`);
		}

		// Idempotency check
		if (args.idempotencyKey) {
			const existing = await ctx.db
				.query("bidEvents")
				.withIndex("by_idempotency", (q) =>
					q.eq("bidderId", identity.subject).eq("idempotencyKey", args.idempotencyKey)
				)
				.first();

			if (existing) {
				return existing._id;
			}
		}

		// Rate limiting
		const thirtySecondsAgo = Date.now() - 30000;
		const recentBids = await ctx.db
			.query("bidEvents")
			.withIndex("by_bidder_timestamp", (q) =>
				q.eq("bidderId", identity.subject).gt("timestamp", thirtySecondsAgo)
			)
			.take(100);

		const recentBidsForMaterial = recentBids.filter((bid) => bid.materialId === args.materialId);

		if (recentBidsForMaterial.length > 0) {
			throw new Error("Rate limit: Please wait before placing another bid");
		}

		// Auction validation
		const auction = await ctx.db.get(args.auctionId);
		if (!auction || auction.status !== "live") {
			throw new Error("Auction is not active");
		}

		await validateSingleLiveAuction(ctx, args.auctionId);

		// Concurrency control
		const aggregate = await ctx.db
			.query("bidAggregates")
			.withIndex("by_auction_material", (q) =>
				q.eq("auctionId", args.auctionId).eq("materialId", args.materialId)
			)
			.first();

		const currentSequence = aggregate?.currentSequence ?? 0;
		if (args.expectedSequence !== currentSequence) {
			throw new Error(
				`Bid conflict: another bid was placed. Expected sequence ${args.expectedSequence}, current is ${currentSequence}. Please retry.`
			);
		}

		if (aggregate && args.amount <= aggregate.highestBidAmount) {
			throw new Error("Bid must be higher than current highest bid");
		}

		const now = Date.now();
		const newSequence = currentSequence + 1;

		// Create event
		const eventId = await ctx.db.insert("bidEvents", {
			eventId: crypto.randomUUID(),
			eventType: "bid_placed",
			auctionId: args.auctionId,
			materialId: args.materialId,
			bidderId: identity.subject,
			amount: args.amount,
			currency: args.currency,
			sequenceNumber: newSequence,
			schemaVersion: 1,
			idempotencyKey: args.idempotencyKey,
			timestamp: now,
			createdAt: now,
		});

		// Update aggregate
		if (aggregate) {
			await ctx.db.patch(aggregate._id, {
				highestBidAmount: args.amount,
				highestBidderId: identity.subject,
				highestBidEventId: eventId,
				highestBidTimestamp: now,
				currentSequence: newSequence,
				totalBids: aggregate.totalBids + 1,
				uniqueBidders:
					aggregate.uniqueBidders + (aggregate.highestBidderId === identity.subject ? 0 : 1),
				lastUpdated: now,
			});
		} else {
			await ctx.db.insert("bidAggregates", {
				auctionId: args.auctionId,
				materialId: args.materialId,
				highestBidAmount: args.amount,
				highestBidderId: identity.subject,
				highestBidEventId: eventId,
				highestBidTimestamp: now,
				currentSequence: newSequence,
				totalBids: 1,
				uniqueBidders: 1,
				lastUpdated: now,
			});
		}

		return eventId;
	},
});
```

**Tests:**

- [ ] `convex/_tests/bids.test.ts`
  - Test successful bid placement
  - Test idempotency
  - Test rate limiting
  - Test optimistic concurrency control (sequence validation)
  - Test bid amount validation (must exceed current highest)
  - Test auction status validation (must be live)

---

### 3.2 Bid Queries

**Tasks:**

- [ ] **3.2.1** Implement `getHighestBid` query
- [ ] **3.2.2** Implement `getMaterialBids` query (all bids for a material)
- [ ] **3.2.3** Implement `getUserBids` query (user's bid history)
- [ ] **3.2.4** Implement `getBidAggregate` query (for sequence number)

**Tests:**

- [ ] `convex/_tests/bids.queries.test.ts`
  - Test getHighestBid returns correct bid
  - Test getMaterialBids returns all bids in order
  - Test getUserBids filtered by user

---

## Phase 4: Materials System

### 4.1 Material Mutations

**Files to create:**

- `convex/materials.ts`

**Tasks:**

- [ ] **4.1.1** Implement `createMaterial` mutation (seller)
- [ ] **4.1.2** Implement `approveMaterial` mutation (admin)
- [ ] **4.1.3** Implement `rejectMaterial` mutation (admin)
- [ ] **4.1.4** Implement `archiveMaterial` mutation
- [ ] **4.1.5** Implement `addMaterialToAuction` mutation (admin)
- [ ] **4.1.6** Implement `removeMaterialFromAuction` mutation (admin)

**Tests:**

- [ ] `convex/_tests/materials.test.ts`
  - Test material creation by seller
  - Test admin approval workflow
  - Test rejection with reason
  - Test only approved materials can be added to auctions

---

### 4.2 Material Queries

**Tasks:**

- [ ] **4.2.1** Implement `getMaterial` query
- [ ] **4.2.2** Implement `getMaterialsByStatus` query
- [ ] **4.2.3** Implement `getAuctionMaterials` query
- [ ] **4.2.4** Implement `searchMaterials` query (full-text search)
- [ ] **4.2.5** Implement `getSellerMaterials` query

**Tests:**

- [ ] `convex/_tests/materials.queries.test.ts`
  - Test material search functionality
  - Test filtering by status
  - Test auction-material relationships

---

## Phase 5: Effect-TS Services

### 5.1 Error Types

**Files to create:**

- `src/lib/effect/services/AuctionsErrors.ts`

**Tasks:**

- [ ] **5.1.1** Define `NotFoundError`
- [ ] **5.1.2** Define `UnauthorizedError`
- [ ] **5.1.3** Define `InvalidStateError`
- [ ] **5.1.4** Define `ValidationError`
- [ ] **5.1.5** Define `RateLimitedError`
- [ ] **5.1.6** Define `BidConflictError`
- [ ] **5.1.7** Define `AuctionNotLiveError`
- [ ] **5.1.8** Define `BidTooLowError`

**Implementation:**

```typescript
// src/lib/effect/services/AuctionsErrors.ts
import { Data } from "effect";

export class NotFoundError extends Data.TaggedError("NotFoundError")<{
	readonly entity: "auction" | "material" | "bid" | "template";
	readonly id: string;
}> {}

export class UnauthorizedError extends Data.TaggedError("UnauthorizedError")<{
	readonly action: string;
	readonly requiredRole: "admin" | "seller" | "buyer";
}> {}

export class BidConflictError extends Data.TaggedError("BidConflictError")<{
	readonly expectedSequence: number;
	readonly actualSequence: number;
}> {}

export class AuctionNotLiveError extends Data.TaggedError("AuctionNotLiveError")<{
	readonly auctionId: string;
	readonly status: string;
}> {}

export class BidTooLowError extends Data.TaggedError("BidTooLowError")<{
	readonly currentHighest: number;
	readonly attempted: number;
}> {}

export class RateLimitedError extends Data.TaggedError("RateLimitedError")<{
	readonly retryAfterMs: number;
}> {}

export type AuctionsDomainError =
	| NotFoundError
	| UnauthorizedError
	| BidConflictError
	| AuctionNotLiveError
	| BidTooLowError
	| RateLimitedError;
```

**Tests:**

- [ ] `src/lib/effect/services/__tests__/AuctionsErrors.test.ts`
  - Test error construction
  - Test error discrimination via `_tag`

---

### 5.2 Validation Schemas

**Files to create:**

- `src/lib/effect/services/AuctionsSchemas.ts`

**Tasks:**

- [ ] **5.2.1** Create `CreateAuctionInputSchema`
- [ ] **5.2.2** Create `CreateMaterialInputSchema`
- [ ] **5.2.3** Create `PlaceBidInputSchema`
- [ ] **5.2.4** Create `CreateTemplateInputSchema`
- [ ] **5.2.5** Create validation constants file

**Implementation:**

```typescript
// src/lib/effect/services/AuctionsSchemas.ts
import { Schema } from "@effect/schema";

export const CreateAuctionInputSchema = Schema.Struct({
	title: Schema.optional(Schema.String.pipe(Schema.maxLength(200))),
	startDate: Schema.Number,
	endDate: Schema.Number,
	frequency: Schema.Union(
		Schema.Literal("weekly"),
		Schema.Literal("biweekly"),
		Schema.Literal("monthly"),
		Schema.Literal("custom")
	),
}).pipe(
	Schema.filter((input) => input.endDate > input.startDate, {
		message: () => "End date must be after start date",
	})
);

export const PlaceBidInputSchema = Schema.Struct({
	auctionId: Schema.String.pipe(Schema.minLength(1)),
	materialId: Schema.String.pipe(Schema.minLength(1)),
	amount: Schema.Number.pipe(
		Schema.greaterThan(0, { message: () => "Bid amount must be greater than 0" })
	),
	currency: Schema.String.pipe(Schema.minLength(1)),
	expectedSequence: Schema.Number,
	idempotencyKey: Schema.optional(Schema.String),
});

export type CreateAuctionInput = Schema.Schema.Type<typeof CreateAuctionInputSchema>;
export type PlaceBidInput = Schema.Schema.Type<typeof PlaceBidInputSchema>;
```

**Tests:**

- [ ] `src/lib/effect/services/__tests__/AuctionsSchemas.test.ts`
  - Test valid input passes validation
  - Test invalid input fails with correct error messages
  - Test date validation (end > start)
  - Test amount validation (> 0)

---

### 5.3 Auctions Service

**Files to create:**

- `src/lib/effect/services/AuctionsService.ts`

**Tasks:**

- [ ] **5.3.1** Define `AuctionsService` Context.Tag
- [ ] **5.3.2** Implement `createAuction` method
- [ ] **5.3.3** Implement `placeBid` method with retry logic
- [ ] **5.3.4** Implement `getActiveAuctions` method
- [ ] **5.3.5** Create `AuctionsServiceLive` layer

**Implementation:**

```typescript
// src/lib/effect/services/AuctionsService.ts
import { Context, Effect, Layer } from "effect";
import type { Id } from "convex/_generated/dataModel";
import { ConvexService } from "./ConvexService";
import { AuctionsDomainError, BidConflictError } from "./AuctionsErrors";
import { CreateAuctionInput, PlaceBidInput } from "./AuctionsSchemas";

export interface Auction {
	readonly _id: Id<"auctionAggregates">;
	readonly title?: string;
	readonly startDate: number;
	readonly endDate: number;
	readonly status: "draft" | "scheduled" | "live" | "closed" | "cancelled";
}

export class AuctionsService extends Context.Tag("AuctionsService")<
	AuctionsService,
	{
		createAuction: (
			input: CreateAuctionInput
		) => Effect.Effect<Id<"auctionAggregates">, AuctionsDomainError>;
		placeBid: (input: PlaceBidInput) => Effect.Effect<Id<"bidEvents">, AuctionsDomainError>;
		getActiveAuctions: () => Effect.Effect<readonly Auction[], AuctionsDomainError>;
	}
>() {}

export const AuctionsServiceLive = Layer.effect(
	AuctionsService,
	Effect.gen(function* () {
		const convex = yield* ConvexService;

		return {
			createAuction: (input) =>
				Effect.tryPromise({
					try: () => convex.client.mutation(api.auctions.createAuction, input),
					catch: (error) => new AuctionsError({ message: String(error) }),
				}),

			placeBid: (input) =>
				Effect.tryPromise({
					try: () => convex.client.mutation(api.bids.placeBid, input),
					catch: (error) => {
						const message = String(error);
						if (message.includes("Bid conflict")) {
							// Parse sequence numbers from error
							return new BidConflictError({
								expectedSequence: input.expectedSequence,
								actualSequence: input.expectedSequence + 1,
							});
						}
						return new AuctionsError({ message });
					},
				}),

			getActiveAuctions: () =>
				Effect.tryPromise({
					try: () => convex.client.query(api.auctions.getActiveAuctions, {}),
					catch: (error) => new AuctionsError({ message: String(error) }),
				}),
		};
	})
);
```

**Tests:**

- [ ] `src/lib/effect/services/__tests__/AuctionsService.test.ts`
  - Test service method types
  - Test error mapping from Convex errors to Effect errors

---

### 5.4 Auctions Hook

**Files to create:**

- `src/lib/effect/hooks/useAuctions.ts`

**Tasks:**

- [ ] **5.4.1** Create `useAuctions` hook with:
  - Real-time auction data via `useSuspenseQuery`
  - `placeBid` action with Exit-based return
  - Computed values (active auctions count, etc.)
- [ ] **5.4.2** Create `useBids` hook for bid-related operations

**Implementation:**

```typescript
// src/lib/effect/hooks/useAuctions.ts
import { useSuspenseQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "convex/_generated/api";
import { Effect, Exit } from "effect";
import { useCallback, useMemo } from "react";
import { useEffectRuntime } from "../EffectProvider";
import { AuctionsService, type Auction } from "../services/AuctionsService";
import type { PlaceBidInput } from "../services/AuctionsSchemas";
import type { AuctionsDomainError } from "../services/AuctionsErrors";

export type PlaceBidExit = Exit.Exit<Id<"bidEvents">, AuctionsDomainError>;

export function useAuctions() {
	const { runPromiseExit } = useEffectRuntime();

	const { data: rawAuctions } = useSuspenseQuery(convexQuery(api.auctions.getActiveAuctions, {}));

	const auctions = useMemo<readonly Auction[]>(() => rawAuctions as Auction[], [rawAuctions]);

	const placeBid = useCallback(
		(input: PlaceBidInput): Promise<PlaceBidExit> =>
			runPromiseExit(
				Effect.gen(function* () {
					const service = yield* AuctionsService;
					return yield* service.placeBid(input);
				})
			),
		[runPromiseExit]
	);

	return {
		auctions,
		placeBid,
		counts: {
			total: auctions.length,
		},
	};
}
```

**Tests:**

- [ ] `src/lib/effect/hooks/__tests__/useAuctions.test.ts`
  - Test hook returns auctions data
  - Test placeBid returns Exit type

---

## Phase 6: React Components

### 6.1 Live Auctions Page

**Files to create:**

- `src/routes/live-auctions/index.tsx` (enhance existing)
- `src/components/Auctions/AuctionFilters.tsx`
- `src/components/Auctions/AuctionTable.tsx`
- `src/components/Auctions/BidModal.tsx`
- `src/components/Auctions/MaterialCard.tsx`

**Tasks:**

- [ ] **6.1.1** Create filter component (categories, form, choice, seller, location, tags)
- [ ] **6.1.2** Create auction table with sortable columns
- [ ] **6.1.3** Create bid modal with:
  - Current highest bid display
  - Bid input with validation
  - Real-time updates
  - Optimistic UI updates
- [ ] **6.1.4** Add view toggle (Auction View / Material View)
- [ ] **6.1.5** Implement real-time bid updates via Convex subscriptions

**Tests:**

- [ ] `src/components/Auctions/__tests__/AuctionFilters.test.tsx`
- [ ] `src/components/Auctions/__tests__/BidModal.test.tsx`
  - Test bid validation
  - Test optimistic updates
  - Test error handling display

---

### 6.2 Admin Pages

**Files to create:**

- `src/routes/admin/auctions/index.tsx`
- `src/routes/admin/auctions/create.tsx`
- `src/routes/admin/materials/index.tsx`
- `src/components/Admin/AuctionForm.tsx`
- `src/components/Admin/MaterialApprovalQueue.tsx`

**Tasks:**

- [ ] **6.2.1** Create auction management page
- [ ] **6.2.2** Create auction creation form with date pickers
- [ ] **6.2.3** Create material approval queue
- [ ] **6.2.4** Add reject material modal with reason input

**Tests:**

- [ ] `src/components/Admin/__tests__/AuctionForm.test.tsx`
- [ ] `src/components/Admin/__tests__/MaterialApprovalQueue.test.tsx`

---

### 6.3 Seller Pages

**Files to create:**

- `src/routes/seller/materials/index.tsx`
- `src/routes/seller/materials/create.tsx`
- `src/routes/seller/templates/index.tsx`
- `src/components/Seller/MaterialForm.tsx`
- `src/components/Seller/TemplateSelector.tsx`

**Tasks:**

- [ ] **6.3.1** Create seller dashboard with material list
- [ ] **6.3.2** Create material upload form
- [ ] **6.3.3** Implement template selector component
- [ ] **6.3.4** Create "Save as Template" functionality
- [ ] **6.3.5** Implement "Create from Template" flow

**Tests:**

- [ ] `src/components/Seller/__tests__/MaterialForm.test.tsx`
- [ ] `src/components/Seller/__tests__/TemplateSelector.test.tsx`

---

## Phase 7: Integration & E2E Tests

### 7.1 Integration Tests

**Files to create:**

- `convex/_tests/integration/auction-lifecycle.test.ts`
- `convex/_tests/integration/bidding-flow.test.ts`
- `convex/_tests/integration/material-approval.test.ts`

**Tasks:**

- [ ] **7.1.1** Test complete auction lifecycle:
  - Create → Schedule → Start → Close → Auto-create next
- [ ] **7.1.2** Test bidding flow:
  - Place bid → Update aggregate → Real-time update
- [ ] **7.1.3** Test material approval flow:
  - Create → Approve → Add to auction → Available for bidding
- [ ] **7.1.4** Test concurrent bidding (optimistic locking)

---

### 7.2 E2E Tests (Playwright)

**Files to create:**

- `e2e/auctions/place-bid.spec.ts`
- `e2e/admin/create-auction.spec.ts`
- `e2e/seller/upload-material.spec.ts`

**Tasks:**

- [ ] **7.2.1** Test auction page loads with live auctions
- [ ] **7.2.2** Test placing a bid (happy path)
- [ ] **7.2.3** Test bid validation errors display
- [ ] **7.2.4** Test admin auction creation
- [ ] **7.2.5** Test material approval workflow

---

## Phase 8: Templates System

### 8.1 Template Backend

**Files to create:**

- `convex/templates.ts`

**Tasks:**

- [ ] **8.1.1** Add template events and aggregates to schema
- [ ] **8.1.2** Implement `createTemplate` mutation
- [ ] **8.1.3** Implement `createTemplateFromMaterial` mutation
- [ ] **8.1.4** Implement `createMaterialFromTemplate` mutation
- [ ] **8.1.5** Implement `updateTemplate` mutation
- [ ] **8.1.6** Implement `deleteTemplate` mutation (soft delete)
- [ ] **8.1.7** Implement template queries

**Tests:**

- [ ] `convex/_tests/templates.test.ts`
  - Test template creation
  - Test material creation from template
  - Test template usage tracking

---

## Dependency Graph

```
Phase 1 (Foundation)
    ↓
Phase 2 (Auction Backend) ──→ Phase 3 (Bidding)
    ↓                              ↓
Phase 4 (Materials) ←─────────────┘
    ↓
Phase 5 (Effect Services)
    ↓
Phase 6 (React Components)
    ↓
Phase 7 (Integration Tests)
    ↓
Phase 8 (Templates)
```

---

## Key Assumptions to Validate

| #   | Assumption                                      | Validation Test                                                |
| --- | ----------------------------------------------- | -------------------------------------------------------------- |
| 1   | Single live auction constraint works            | `convex/_tests/auctions.test.ts`                               |
| 2   | Optimistic concurrency prevents race conditions | `convex/_tests/bids.test.ts`                                   |
| 3   | Rate limiting prevents bid spam                 | `convex/_tests/bids.test.ts`                                   |
| 4   | Idempotency prevents duplicates                 | `convex/_tests/auctions.test.ts`, `convex/_tests/bids.test.ts` |
| 5   | Event sourcing allows aggregate rebuild         | `convex/_tests/integration/auction-lifecycle.test.ts`          |
| 6   | Mexico City time calculations are correct       | `convex/_tests/auctions.util.test.ts`                          |
| 7   | Scheduled functions activate/close auctions     | `convex/_tests/crons.test.ts`                                  |
| 8   | Only approved materials can be bid on           | `convex/_tests/materials.test.ts`                              |

---

## Estimated Timeline

| Phase   | Estimated Duration | Dependencies  |
| ------- | ------------------ | ------------- |
| Phase 1 | 2-3 days           | None          |
| Phase 2 | 3-4 days           | Phase 1       |
| Phase 3 | 3-4 days           | Phase 2       |
| Phase 4 | 3-4 days           | Phase 1       |
| Phase 5 | 2-3 days           | Phase 2, 3, 4 |
| Phase 6 | 5-7 days           | Phase 5       |
| Phase 7 | 3-4 days           | Phase 6       |
| Phase 8 | 3-4 days           | Phase 4       |

**Total: ~25-33 days**

---

## Next Steps

1. **Start with Phase 1.1** - Add reference tables to schema
2. **Run `npx convex dev`** to generate types
3. **Create seed data mutation** and populate reference tables
4. **Proceed to Phase 1.2** - Event sourcing tables

---

## References

- [Research Document](./research.md)
- [Convex Best Practices](https://docs.convex.dev/understanding/best-practices/)
- [Effect Schema Documentation](https://effect.website/docs/schema)
- [TDR-0004: Client-Side Validation](../../tech-debt/0004-client-side-validation-bypassable.md)


