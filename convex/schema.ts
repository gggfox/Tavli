import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { TABLE } from "./constants";

const nameDescTranslations = v.optional(
	v.record(
		v.string(),
		v.object({ name: v.optional(v.string()), description: v.optional(v.string()) })
	)
);
const nameOnlyTranslations = v.optional(
	v.record(v.string(), v.object({ name: v.optional(v.string()) }))
);

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
		email: v.optional(v.string()),
		roles: v.array(
			v.union(
				v.literal("admin"),
				v.literal("owner"),
				v.literal("manager"),
				v.literal("customer"),
				v.literal("employee")
			)
		),
		organizationId: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_user", ["userId"])
		.index("by_organizationId", ["organizationId"]),

	// ============================================================================
	// Organizations
	// ============================================================================
	[TABLE.ORGANIZATIONS]: defineTable({
		name: v.string(),
		slug: v.optional(v.string()),
		description: v.optional(v.string()),
		isActive: v.boolean(),
		createdAt: v.number(),
		updatedAt: v.number(),
	}).index("by_name", ["name"]),

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
		organizationId: v.id(TABLE.ORGANIZATIONS),
		name: v.string(),
		slug: v.string(),
		description: v.optional(v.string()),
		currency: v.string(),
		timezone: v.optional(v.string()),
		defaultLanguage: v.optional(v.string()),
		supportedLanguages: v.optional(v.array(v.string())),
		stripeAccountId: v.optional(v.string()),
		stripeOnboardingComplete: v.optional(v.boolean()),
		isActive: v.boolean(),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_slug", ["slug"])
		.index("by_owner", ["ownerId"])
		.index("by_organization", ["organizationId"]),

	[TABLE.MENUS]: defineTable({
		restaurantId: v.id(TABLE.RESTAURANTS),
		name: v.string(),
		description: v.optional(v.string()),
		translations: nameDescTranslations,
		defaultLanguage: v.optional(v.string()),
		supportedLanguages: v.optional(v.array(v.string())),
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
		translations: nameDescTranslations,
		displayOrder: v.number(),
		createdAt: v.number(),
		updatedAt: v.number(),
	}).index("by_menu", ["menuId"]),

	[TABLE.MENU_ITEMS]: defineTable({
		categoryId: v.id(TABLE.MENU_CATEGORIES),
		restaurantId: v.id(TABLE.RESTAURANTS),
		name: v.string(),
		description: v.optional(v.string()),
		translations: nameDescTranslations,
		basePrice: v.number(),
		imageStorageId: v.optional(v.id("_storage")),
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
		translations: nameOnlyTranslations,
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
		translations: nameOnlyTranslations,
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
		tableId: v.optional(v.id(TABLE.TABLES)),
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
			v.literal("cancelled")
		),
		totalAmount: v.number(),
		specialInstructions: v.optional(v.string()),
		stripePaymentIntentId: v.optional(v.string()),
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
	// Products (Stripe platform-level products mapped to connected accounts)
	// ============================================================================
	[TABLE.PRODUCTS]: defineTable({
		stripeProductId: v.string(),
		stripePriceId: v.string(),
		restaurantId: v.id(TABLE.RESTAURANTS),
		name: v.string(),
		description: v.optional(v.string()),
		priceInCents: v.number(),
		currency: v.string(),
		isActive: v.boolean(),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_restaurant", ["restaurantId"])
		.index("by_stripeProductId", ["stripeProductId"]),

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
