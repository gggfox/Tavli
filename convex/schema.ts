import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { TABLE } from "./constants";

export default defineSchema({
	// ============================================================================
	// User Settings
	// ============================================================================
	[TABLE.USER_SETTINGS]: defineTable({
		userId: v.string(),
		theme: v.optional(v.union(v.literal("light"), v.literal("dark"))),
		sidebarExpanded: v.optional(v.boolean()),
		language: v.optional(v.union(v.literal("en"), v.literal("es"))),
	}).index("by_user", ["userId"]),

	// ============================================================================
	// User Roles
	// ============================================================================
	[TABLE.USER_ROLES]: defineTable({
		userId: v.string(),
		roles: v.array(
			v.union(
				v.literal("admin"),
				v.literal("seller"),
				v.literal("buyer"),
				v.literal("owner"),
				v.literal("staff")
			)
		),
		organizationId: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_user", ["userId"])
		.index("by_organizationId", ["organizationId"]),

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
	// Restaurant & Ordering Tables
	// ============================================================================
	[TABLE.RESTAURANTS]: defineTable({
		ownerId: v.string(),
		name: v.string(),
		slug: v.string(),
		description: v.optional(v.string()),
		currency: v.string(),
		timezone: v.optional(v.string()),
		isActive: v.boolean(),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_slug", ["slug"])
		.index("by_owner", ["ownerId"]),

	[TABLE.MENUS]: defineTable({
		restaurantId: v.id(TABLE.RESTAURANTS),
		name: v.string(),
		description: v.optional(v.string()),
		isActive: v.boolean(),
		displayOrder: v.number(),
		createdAt: v.number(),
		updatedAt: v.number(),
	}).index("by_restaurant", ["restaurantId"]),

	[TABLE.MENU_CATEGORIES]: defineTable({
		menuId: v.id(TABLE.MENUS),
		restaurantId: v.id(TABLE.RESTAURANTS),
		name: v.string(),
		description: v.optional(v.string()),
		displayOrder: v.number(),
		createdAt: v.number(),
		updatedAt: v.number(),
	}).index("by_menu", ["menuId"]),

	[TABLE.MENU_ITEMS]: defineTable({
		categoryId: v.id(TABLE.MENU_CATEGORIES),
		restaurantId: v.id(TABLE.RESTAURANTS),
		name: v.string(),
		description: v.optional(v.string()),
		basePrice: v.number(),
		imageUrl: v.optional(v.string()),
		isAvailable: v.boolean(),
		unavailableReason: v.optional(v.string()),
		availableDays: v.optional(v.array(v.number())),
		displayOrder: v.number(),
		tags: v.optional(v.array(v.string())),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_category", ["categoryId"])
		.index("by_restaurant", ["restaurantId"]),

	[TABLE.OPTION_GROUPS]: defineTable({
		restaurantId: v.id(TABLE.RESTAURANTS),
		name: v.string(),
		selectionType: v.union(v.literal("single"), v.literal("multi")),
		isRequired: v.boolean(),
		minSelections: v.number(),
		maxSelections: v.number(),
		displayOrder: v.number(),
		createdAt: v.number(),
		updatedAt: v.number(),
	}).index("by_restaurant", ["restaurantId"]),

	[TABLE.OPTIONS]: defineTable({
		optionGroupId: v.id(TABLE.OPTION_GROUPS),
		restaurantId: v.id(TABLE.RESTAURANTS),
		name: v.string(),
		priceModifier: v.number(),
		isAvailable: v.boolean(),
		displayOrder: v.number(),
		createdAt: v.number(),
	}).index("by_optionGroup", ["optionGroupId"]),

	[TABLE.MENU_ITEM_OPTION_GROUPS]: defineTable({
		menuItemId: v.id(TABLE.MENU_ITEMS),
		optionGroupId: v.id(TABLE.OPTION_GROUPS),
		restaurantId: v.id(TABLE.RESTAURANTS),
		displayOrder: v.number(),
	})
		.index("by_menuItem", ["menuItemId"])
		.index("by_optionGroup", ["optionGroupId"]),

	[TABLE.TABLES]: defineTable({
		restaurantId: v.id(TABLE.RESTAURANTS),
		tableNumber: v.number(),
		label: v.optional(v.string()),
		isActive: v.boolean(),
		createdAt: v.number(),
	})
		.index("by_restaurant_number", ["restaurantId", "tableNumber"])
		.index("by_restaurant", ["restaurantId"]),

	[TABLE.SESSIONS]: defineTable({
		restaurantId: v.id(TABLE.RESTAURANTS),
		tableId: v.id(TABLE.TABLES),
		status: v.union(v.literal("active"), v.literal("closed")),
		startedAt: v.number(),
		closedAt: v.optional(v.number()),
	}).index("by_table_status", ["tableId", "status"]),

	[TABLE.ORDERS]: defineTable({
		sessionId: v.id(TABLE.SESSIONS),
		restaurantId: v.id(TABLE.RESTAURANTS),
		tableId: v.id(TABLE.TABLES),
		status: v.union(
			v.literal("draft"),
			v.literal("submitted"),
			v.literal("preparing"),
			v.literal("ready"),
			v.literal("served"),
			v.literal("paid"),
			v.literal("cancelled")
		),
		totalAmount: v.number(),
		specialInstructions: v.optional(v.string()),
		submittedAt: v.optional(v.number()),
		paidAt: v.optional(v.number()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_session", ["sessionId"])
		.index("by_restaurant", ["restaurantId"]),

	[TABLE.ORDER_ITEMS]: defineTable({
		orderId: v.id(TABLE.ORDERS),
		menuItemId: v.id(TABLE.MENU_ITEMS),
		menuItemName: v.string(),
		quantity: v.number(),
		unitPrice: v.number(),
		selectedOptions: v.array(
			v.object({
				optionGroupId: v.id(TABLE.OPTION_GROUPS),
				optionGroupName: v.string(),
				optionId: v.id(TABLE.OPTIONS),
				optionName: v.string(),
				priceModifier: v.number(),
			})
		),
		specialInstructions: v.optional(v.string()),
		lineTotal: v.number(),
		createdAt: v.number(),
	}).index("by_order", ["orderId"]),

	// ============================================================================
	// Unified Event Store
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
