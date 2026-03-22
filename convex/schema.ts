import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { AUCTION_STATES, TABLE } from "./constants";

export default defineSchema({
	// ============================================================================
	// Existing Tables
	// ============================================================================
	[TABLE.TASKS]: defineTable({
		text: v.string(),
		isCompleted: v.optional(v.boolean()),
		userId: v.string(),
		idempotencyKey: v.optional(v.string()),
	})
		.index("by_user", ["userId"])
		.index("by_idempotency", ["userId", "idempotencyKey"]),

	[TABLE.USER_SETTINGS]: defineTable({
		userId: v.string(),
		theme: v.optional(v.union(v.literal("light"), v.literal("dark"))),
		sidebarExpanded: v.optional(v.boolean()),
		language: v.optional(v.union(v.literal("en"), v.literal("es"))),
	}).index("by_user", ["userId"]),

	// ============================================================================
	// User Roles (Phase 1.1)
	// ============================================================================
	[TABLE.USER_ROLES]: defineTable({
		userId: v.string(),
		roles: v.array(v.union(v.literal("admin"), v.literal("seller"), v.literal("buyer"))),
		organizationId: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_user", ["userId"])
		.index("by_organizationId", ["organizationId"]),

	// ============================================================================
	// Reference Tables (Phase 1.1)
	// ============================================================================
	[TABLE.CATEGORIES]: defineTable({
		name: v.string(),
		groupTitle: v.string(),
		icon: v.optional(v.string()),
		createdAt: v.number(),
	})
		.index("by_group", ["groupTitle"])
		.index("by_name", ["name"]),

	[TABLE.FORMS]: defineTable({
		name: v.string(),
		icon: v.optional(v.string()),
		createdAt: v.number(),
	}).index("by_name", ["name"]),

	[TABLE.FINISHES]: defineTable({
		name: v.string(),
		createdAt: v.number(),
	}).index("by_name", ["name"]),

	[TABLE.CHOICES]: defineTable({
		name: v.string(),
		icon: v.optional(v.string()),
		createdAt: v.number(),
	}).index("by_name", ["name"]),

	// ============================================================================
	// Auction (CQRS Read Model - Phase 1.2)
	// ============================================================================
	[TABLE.AUCTIONS]: defineTable({
		title: v.optional(v.string()),
		startDate: v.number(),
		endDate: v.number(),
		status: v.union(...Object.values(AUCTION_STATES).map((status) => v.literal(status))),
		createdBy: v.string(),
		createdAt: v.number(),
		lastUpdated: v.number(),
	}).index("by_status", ["status"]),

	// ============================================================================
	// Material (CQRS Read Model - Phase 1.2)
	// ============================================================================
	[TABLE.MATERIALS]: defineTable({
		materialId: v.string(),
		totalWeight: v.optional(v.number()),
		normalizedQuantity: v.object({
			quantity: v.number(),
			unit: v.string(),
			baseUnit: v.string(),
			baseQuantity: v.number(),
		}),
		attributes: v.optional(v.any()),
		location: v.string(),
		sellerId: v.string(),
		searchableText: v.string(),
		status: v.union(
			v.literal("pending"),
			v.literal("approved"),
			v.literal("rejected"),
			v.literal("archived")
		),
		approvedBy: v.optional(v.string()),
		approvedAt: v.optional(v.number()),
		rejectionReason: v.optional(v.string()),
		createdAt: v.number(),
		lastEventId: v.string(),
		lastUpdated: v.number(),
	})
		.index("by_seller", ["sellerId"])
		.index("by_status", ["status"])
		.index("by_approval", ["status", "approvedAt"])
		.index("by_material", ["materialId"])
		.searchIndex("by_searchable_text", {
			searchField: "searchableText",
		}),

	// ============================================================================
	// Junction Tables for Materials (Phase 1.2)
	// ============================================================================
	materialCategories: defineTable({
		materialId: v.string(),
		categoryId: v.id("categories"),
		createdAt: v.number(),
	})
		.index("by_material", ["materialId"])
		.index("by_category", ["categoryId"])
		.index("by_material_category", ["materialId", "categoryId"]),

	materialForms: defineTable({
		materialId: v.string(),
		formId: v.id("forms"),
		createdAt: v.number(),
	})
		.index("by_material", ["materialId"])
		.index("by_form", ["formId"])
		.index("by_material_form", ["materialId", "formId"]),

	materialFinishes: defineTable({
		materialId: v.string(),
		finishId: v.id("finishes"),
		createdAt: v.number(),
	})
		.index("by_material", ["materialId"])
		.index("by_finish", ["finishId"])
		.index("by_material_finish", ["materialId", "finishId"]),

	materialChoices: defineTable({
		materialId: v.string(),
		choiceId: v.id("choices"),
		createdAt: v.number(),
	})
		.index("by_material", ["materialId"])
		.index("by_choice", ["choiceId"])
		.index("by_material_choice", ["materialId", "choiceId"]),

	// ============================================================================
	// Bid Aggregates (CQRS Read Model - Phase 1.2)
	// ============================================================================
	[TABLE.BIDS]: defineTable({
		auctionId: v.id(TABLE.AUCTIONS),
		materialId: v.id(TABLE.MATERIALS),
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

	// ============================================================================
	// Feature Flags
	// ============================================================================
	[TABLE.FEATURE_FLAGS]: defineTable({
		key: v.string(),
		enabled: v.boolean(),
		description: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
	}).index("by_key", ["key"]),

	// ============================================================================
	// Unified Event Store (Optional - Global Event Stream)
	// ============================================================================
	[TABLE.ALL_EVENTS]: defineTable({
		eventType: v.string(),
		aggregateType: v.union(...Object.values(TABLE).map((table) => v.literal(table))),
		aggregateId: v.string(),
		payload: v.any(),
		userId: v.string(),
		timestamp: v.number(),
		idempotencyKey: v.optional(v.string()),
		createdAt: v.number(),
	})
		.index("by_event_type", ["eventType"])
		.index("by_aggregate", ["aggregateType", "aggregateId"])
		.index("by_timestamp", ["timestamp"])
		.index("by_user", ["userId"])
		.index("by_aggregate_type", ["aggregateType"]),
});
