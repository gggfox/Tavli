import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
	ORDER_PAYMENT_STATE,
	PAYMENT_REFUND_STATUS,
	PAYMENT_STATUS,
	RESERVATION_SOURCE,
	RESERVATION_STATUS,
	TABLE,
} from "./constants";

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
		reservationSoundEnabled: v.optional(v.boolean()),
		// Subset of order statuses the OrderDashboard should display.
		// `draft` is intentionally excluded: drafts are pre-submission state
		// and never belong on the kitchen dashboard.
		orderDashboardStatusFilters: v.optional(
			v.array(
				v.union(
					v.literal("submitted"),
					v.literal("preparing"),
					v.literal("ready"),
					v.literal("served"),
					v.literal("cancelled")
				)
			)
		),
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
		/** Minutes from local midnight (0–1439) when the business “order day” starts; default 240 (04:00) in app logic. */
		orderDayStartMinutesFromMidnight: v.optional(v.number()),
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
		.index("by_organization", ["organizationId"])
		.index("by_stripe_account", ["stripeAccountId"]),

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
		// Optional during the rollout. New rows always set it; existing rows
		// fall back to FALLBACK_TABLE_CAPACITY in availability checks until the
		// `tables.backfillCapacity` admin mutation has run.
		capacity: v.optional(v.number()),
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
		paymentState: v.optional(
			v.union(
				v.literal(ORDER_PAYMENT_STATE.UNPAID),
				v.literal(ORDER_PAYMENT_STATE.PENDING),
				v.literal(ORDER_PAYMENT_STATE.PROCESSING),
				v.literal(ORDER_PAYMENT_STATE.PAID),
				v.literal(ORDER_PAYMENT_STATE.FAILED),
				v.literal(ORDER_PAYMENT_STATE.REFUND_REQUESTED),
				v.literal(ORDER_PAYMENT_STATE.REFUNDED),
				v.literal(ORDER_PAYMENT_STATE.REFUND_FAILED)
			)
		),
		activePaymentId: v.optional(v.id(TABLE.PAYMENTS)),
		stripePaymentIntentId: v.optional(v.string()),
		submittedAt: v.optional(v.number()),
		paidAt: v.optional(v.number()),
		/** Monotonic per restaurant per business day; assigned in confirmPayment only. */
		dailyOrderNumber: v.optional(v.number()),
		/** YYYY-MM-DD business-day label at assignment time. */
		orderServiceDateKey: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_session", ["sessionId"])
		.index("by_restaurant", ["restaurantId"]),

	[TABLE.ORDER_DAY_COUNTERS]: defineTable({
		restaurantId: v.id(TABLE.RESTAURANTS),
		serviceDateKey: v.string(),
		lastIssuedNumber: v.number(),
		updatedAt: v.number(),
	}).index("by_restaurant", ["restaurantId"]),

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

	[TABLE.PAYMENTS]: defineTable({
		restaurantId: v.id(TABLE.RESTAURANTS),
		orderId: v.id(TABLE.ORDERS),
		amount: v.number(),
		currency: v.string(),
		status: v.union(
			v.literal(PAYMENT_STATUS.PENDING),
			v.literal(PAYMENT_STATUS.PROCESSING),
			v.literal(PAYMENT_STATUS.SUCCEEDED),
			v.literal(PAYMENT_STATUS.FAILED),
			v.literal(PAYMENT_STATUS.SUPERSEDED),
			v.literal(PAYMENT_STATUS.CANCELLED)
		),
		refundStatus: v.union(
			v.literal(PAYMENT_REFUND_STATUS.NONE),
			v.literal(PAYMENT_REFUND_STATUS.REQUESTED),
			v.literal(PAYMENT_REFUND_STATUS.SUCCEEDED),
			v.literal(PAYMENT_REFUND_STATUS.FAILED)
		),
		attemptNumber: v.number(),
		orderUpdatedAtSnapshot: v.optional(v.number()),
		stripePaymentIntentId: v.optional(v.string()),
		stripeChargeId: v.optional(v.string()),
		stripeRefundId: v.optional(v.string()),
		latestStripeEventId: v.optional(v.string()),
		failureCode: v.optional(v.string()),
		failureMessage: v.optional(v.string()),
		succeededAt: v.optional(v.number()),
		failedAt: v.optional(v.number()),
		refundRequestedAt: v.optional(v.number()),
		refundedAt: v.optional(v.number()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_order", ["orderId"])
		.index("by_restaurant", ["restaurantId"])
		.index("by_payment_intent", ["stripePaymentIntentId"]),

	[TABLE.STRIPE_WEBHOOK_EVENTS]: defineTable({
		eventId: v.string(),
		eventType: v.string(),
		paymentId: v.optional(v.id(TABLE.PAYMENTS)),
		processedAt: v.number(),
		createdAt: v.number(),
	})
		.index("by_event_id", ["eventId"])
		.index("by_payment", ["paymentId"]),

	// ============================================================================
	// Reservations
	// ============================================================================
	//
	// Capacity-based reservations. Customers (UI now, WhatsApp bot later)
	// submit `partySize + startsAt + contact`; staff confirm and assign one or
	// more `tableIds` at confirmation time. The reservation lifecycle lives in
	// `status` -- see RESERVATION_STATUS in constants.ts.
	//
	// Double-booking safety: any mutation that assigns a table reads
	// overlapping rows on `by_table_time` and rejects on conflict. Because the
	// read+write happens inside one Convex transaction, OCC retries handle
	// concurrent assignment without explicit locking.
	[TABLE.RESERVATIONS]: defineTable({
		restaurantId: v.id(TABLE.RESTAURANTS),
		partySize: v.number(),
		startsAt: v.number(),
		endsAt: v.number(),
		// Empty until staff confirm and pick tables. Multi-table to support
		// large parties spanning two or more physical tables.
		tableIds: v.array(v.id(TABLE.TABLES)),
		status: v.union(
			v.literal(RESERVATION_STATUS.PENDING),
			v.literal(RESERVATION_STATUS.CONFIRMED),
			v.literal(RESERVATION_STATUS.SEATED),
			v.literal(RESERVATION_STATUS.COMPLETED),
			v.literal(RESERVATION_STATUS.CANCELLED),
			v.literal(RESERVATION_STATUS.NO_SHOW)
		),
		source: v.union(
			v.literal(RESERVATION_SOURCE.UI),
			v.literal(RESERVATION_SOURCE.WHATSAPP),
			v.literal(RESERVATION_SOURCE.STAFF)
		),
		// Contact details work without a WorkOS account (WhatsApp bot only
		// has a phone number). userId is set when a signed-in user reserves.
		contact: v.object({
			name: v.string(),
			phone: v.string(),
			email: v.optional(v.string()),
		}),
		userId: v.optional(v.string()),
		notes: v.optional(v.string()),
		// Set on markSeated() to attach the existing ordering flow.
		sessionId: v.optional(v.id(TABLE.SESSIONS)),
		idempotencyKey: v.optional(v.string()),
		confirmedAt: v.optional(v.number()),
		seatedAt: v.optional(v.number()),
		completedAt: v.optional(v.number()),
		cancelledAt: v.optional(v.number()),
		cancelReason: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_restaurant_time", ["restaurantId", "startsAt"])
		.index("by_restaurant_status_time", ["restaurantId", "status", "startsAt"])
		.index("by_phone", ["restaurantId", "contact.phone"])
		.index("by_idempotency", ["idempotencyKey"])
		.index("by_session", ["sessionId"]),

	// Time-windowed locks marking a table unavailable. Stackable, auditable.
	// Both reservation overlap checks and the public availability query union
	// these in.
	[TABLE.TABLE_LOCKS]: defineTable({
		restaurantId: v.id(TABLE.RESTAURANTS),
		tableId: v.id(TABLE.TABLES),
		startsAt: v.number(),
		endsAt: v.number(),
		reason: v.optional(v.string()),
		lockedBy: v.string(),
		createdAt: v.number(),
	})
		.index("by_table_time", ["tableId", "startsAt"])
		.index("by_restaurant_time", ["restaurantId", "startsAt"]),

	// One row per restaurant. Auto-created on first read with the
	// DEFAULT_RESERVATION_SETTINGS values from constants.ts.
	[TABLE.RESERVATION_SETTINGS]: defineTable({
		restaurantId: v.id(TABLE.RESTAURANTS),
		defaultTurnMinutes: v.number(),
		// Per-capacity overrides. The first matching range wins. If no range
		// matches, defaultTurnMinutes is used.
		turnMinutesByCapacity: v.array(
			v.object({
				minPartySize: v.number(),
				maxPartySize: v.number(),
				turnMinutes: v.number(),
			})
		),
		minAdvanceMinutes: v.number(),
		maxAdvanceDays: v.number(),
		noShowGraceMinutes: v.number(),
		// Restaurant-wide closures. Used for holidays, private events, etc.
		blackoutWindows: v.array(
			v.object({
				startsAt: v.number(),
				endsAt: v.number(),
				reason: v.optional(v.string()),
			})
		),
		acceptingReservations: v.boolean(),
		createdAt: v.number(),
		updatedAt: v.number(),
	}).index("by_restaurant", ["restaurantId"]),

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
