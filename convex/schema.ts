import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
	ABSENCE_REQUEST_STATUS,
	ABSENCE_TYPE,
	ATTENDANCE_STATUS,
	CLOCK_EVENT_SOURCE,
	CLOCK_EVENT_TYPE,
	INVITATION_STATUS,
	ORDER_PAYMENT_STATE,
	PAYMENT_KIND,
	PAYMENT_REFUND_STATUS,
	PAYMENT_STATUS,
	PREP_STATION,
	RESERVATION_SOURCE,
	RESERVATION_STATUS,
	RESTAURANT_MEMBER_ROLE,
	SESSION_PAYMENT_STATE,
	SHIFT_STATUS,
	SUBSTITUTION_PROPOSAL_STATUS,
	TABLE,
	TIP_DISTRIBUTION_RULE,
	TIP_ENTRY_SOURCE,
	TIP_POOL_STATUS,
	USER_ROLES,
	WHATSAPP_CONVERSATION_STATUS,
	WHATSAPP_PENDING_ACTION,
	WHATSAPP_MESSAGE_DIRECTION,
} from "./constants";

const structuredName = {
	firstName: v.optional(v.string()),
	paternalLastname: v.optional(v.string()),
	maternalLastname: v.optional(v.string()),
};

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
		// Single order status the OrderDashboard should display (ADR 008).
		// `draft` is intentionally excluded: drafts are pre-submission state
		// and never belong on the kitchen dashboard. `awaiting_payment` is a
		// staff-facing status, so it IS a valid filter here.
		orderDashboardStatusFilter: v.optional(
			v.union(
				v.literal("awaiting_payment"),
				v.literal("submitted"),
				v.literal("preparing"),
				v.literal("ready"),
				v.literal("served"),
				v.literal("cancelled")
			)
		),
		// LEGACY multi-select predecessor of `orderDashboardStatusFilter`.
		// Removed after `migrations/backfillOrderDashboardStatusFilter` has run
		// in every environment.
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
		// Subset of prep stations the OrderDashboard should display.
		// Empty array means "show all stations" (no filter applied) — matches
		// the existing pattern of `orderDashboardStatusFilters`. Persisted per
		// user; manual; default = all stations (no auth coupling).
		orderDashboardPrepStationFilters: v.optional(
			v.array(v.union(v.literal("kitchen"), v.literal("bar")))
		),
		// Service-day window the OrderDashboard should display. "today" means
		// the restaurant's current business day (its 04:00-style rollover, not
		// midnight UTC); "all" is every order ever, which is the pre-existing
		// behavior and so stays the default for a user who never picked.
		orderDashboardServiceDateFilter: v.optional(v.union(v.literal("today"), v.literal("all"))),
		// Whose orders the OrderDashboard shows: "all" is the whole floor,
		// "mine" only the tables the user covers right now through their active
		// shift's section assignments. Absent means the user has never touched
		// the toggle, so the dashboard picks the default from their shift (a
		// server on shift starts scoped; everyone else starts on "all").
		orderDashboardScope: v.optional(v.union(v.literal("all"), v.literal("mine"))),
		// Sidebar accordion groups the user has open. Identified by the group's
		// translationKey (e.g. "sidebar.team"). Unknown keys are ignored at
		// render time so removing groups later is safe.
		expandedSidebarGroups: v.optional(v.array(v.string())),
		updatedBy: v.optional(v.string()),
	}).index("by_user", ["userId"]),

	// ============================================================================
	// User Roles
	// ============================================================================
	[TABLE.USER_ROLES]: defineTable({
		userId: v.string(),
		email: v.optional(v.string()),
		...structuredName,
		clerkImageUrl: v.optional(v.string()),
		photoStorageId: v.optional(v.id("_storage")),
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
		updatedBy: v.optional(v.string()),
		// Legacy dev-role-switcher fields on older deployment data; safe to strip later.
		devSavedMembershipRoles: v.optional(
			v.array(
				v.object({
					restaurantId: v.string(),
					role: v.string(),
					synthetic: v.optional(v.boolean()),
				})
			)
		),
		devSimulateEmployeeTier: v.optional(v.boolean()),
	})
		.index("by_user", ["userId"])
		.index("by_organizationId", ["organizationId"])
		// Admin onboarding classifies a prospective invitee by email (does this
		// person already hold a role, and in which organization?). Without this
		// index a 500-row CSV preview would full-scan `userRoles` 500 times.
		// `email` is optional; rows without one simply sort under `undefined`.
		.index("by_email", ["email"]),

	// ============================================================================
	// Restaurant membership (per-location manager / employee)
	// ============================================================================
	// XOR invariant: exactly one of `userId` (Clerk-backed) or
	// `employeeAccountId` (managed, no Clerk identity) is set. See ADR 006.
	[TABLE.RESTAURANT_MEMBERS]: defineTable({
		userId: v.optional(v.string()),
		employeeAccountId: v.optional(v.id(TABLE.EMPLOYEE_ACCOUNTS)),
		restaurantId: v.id(TABLE.RESTAURANTS),
		organizationId: v.id(TABLE.ORGANIZATIONS),
		role: v.union(
			v.literal(RESTAURANT_MEMBER_ROLE.MANAGER),
			v.literal(RESTAURANT_MEMBER_ROLE.EMPLOYEE)
		),
		isActive: v.boolean(),
		addedBy: v.optional(v.string()),
		removedAt: v.optional(v.number()),
		removedBy: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
		updatedBy: v.optional(v.string()),
	})
		.index("by_user", ["userId"])
		.index("by_restaurant", ["restaurantId"])
		.index("by_restaurant_user", ["restaurantId", "userId"])
		.index("by_organization", ["organizationId"])
		.index("by_employee_account", ["employeeAccountId"]),

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
		updatedBy: v.optional(v.string()),
	}).index("by_name", ["name"]),

	// ============================================================================
	// Feature Flags
	// ============================================================================
	[TABLE.FEATURE_FLAGS]: defineTable({
		key: v.string(),
		enabled: v.boolean(),
		// Optional numeric tuning value for flags that represent a numeric knob
		// rather than a boolean toggle (e.g. soft-delete retention window).
		numericValue: v.optional(v.number()),
		description: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
		updatedBy: v.optional(v.string()),
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
		/**
		 * The restaurant's **Contact email** — one address doing four jobs: shown
		 * to diners on the menu page and the receipt footer, the receipt
		 * `reply_to`, the dashboard-error-report destination (TAVLI-2, falling
		 * back to the global SUPPORT_EMAIL default), and the platform-fee billing
		 * recipient. Field name kept for continuity; the concept is Contact email.
		 *
		 * Only published to diners once `publicProfileReviewedAt` is set — see
		 * that field.
		 */
		supportEmail: v.optional(v.string()),
		timezone: v.optional(v.string()),
		/** Minutes from local midnight (0–1439) when the business “order day” starts; default 240 (04:00) in app logic. */
		orderDayStartMinutesFromMidnight: v.optional(v.number()),
		/**
		 * Cadence at which the per-restaurant order-number counter resets.
		 * Missing → DEFAULT_ORDER_NUMBER_RESET_FREQUENCY (monthly).
		 */
		orderNumberResetFrequency: v.optional(
			v.union(v.literal("daily"), v.literal("weekly"), v.literal("biweekly"), v.literal("monthly"))
		),
		/**
		 * Cash policy (TAVLI-81, ADR 008 addendum). Default/missing = **off**,
		 * which is ADR 008 as written: an `awaiting_payment` round is money owed,
		 * never kitchen work, and staff must collect before the kitchen sees it.
		 *
		 * On, the debt stops blocking the workflow: the round is workable the
		 * moment the diner commits it, advances exactly like `submitted`, and the
		 * uncollected cash is carried by the order's `paymentState` (a persistent
		 * "to collect" badge) instead of by its `status`. Staff-only — deliberately
		 * NOT exposed by `toPublicRestaurant`; a diner has no use for it and it
		 * describes how this restaurant trusts its tables.
		 */
		releaseCashOrdersImmediately: v.optional(v.boolean()),
		/** HH:MM when the restaurant opens for service. Bounds the reservation timeline. */
		openTime: v.optional(v.string()),
		/** HH:MM when the restaurant closes. Bounds the reservation timeline. */
		closeTime: v.optional(v.string()),
		defaultLanguage: v.optional(v.string()),
		supportedLanguages: v.optional(v.array(v.string())),
		stripeAccountId: v.optional(v.string()),
		stripeOnboardingComplete: v.optional(v.boolean()),
		/**
		 * Receipt tax block (ADR 008): rendered verbatim on restaurant-branded
		 * receipt emails. Informational only — this is NOT CFDI e-invoicing.
		 */
		rfc: v.optional(v.string()),
		razonSocial: v.optional(v.string()),
		fiscalAddress: v.optional(v.string()),
		// ── Public profile: the diner-visible contact details. `supportEmail`
		//    above belongs to this group too. Normalized on write by
		//    `convex/publicProfileHelpers.ts` — these values are interpolated into
		//    `href`s on an anonymous page, so storage is always canonical.
		/**
		 * Diner-facing street address. Deliberately NOT `fiscalAddress`, which is
		 * the legal invoicing address and need not be where diners walk in.
		 */
		address: v.optional(v.string()),
		/** E.164 (`+` then 8–15 digits). Machine-consumed into `tel:` and `wa.me`. */
		phone: v.optional(v.string()),
		/** True when `phone` is reachable on WhatsApp. Never set without `phone`. */
		phoneHasWhatsApp: v.optional(v.boolean()),
		/** Canonical `https` profile URLs, host- and path-validated on write. */
		instagramUrl: v.optional(v.string()),
		facebookUrl: v.optional(v.string()),
		tiktokUrl: v.optional(v.string()),
		xUrl: v.optional(v.string()),
		youtubeUrl: v.optional(v.string()),
		/**
		 * Stamped the first time a manager saves the Public profile section.
		 *
		 * Gates publication of `supportEmail` to diners. Every row that predates
		 * the public profile had its support email entered under copy reading
		 * "Where dashboard error reports are sent", so some hold an internal alias
		 * or a personal address. Publishing those to an anonymous page is
		 * irreversible for anything scraped, so the address stays private until a
		 * human has seen the new wording. The other public-profile fields need no
		 * gate — they can only have been entered under the new copy.
		 */
		publicProfileReviewedAt: v.optional(v.number()),
		/** Per-restaurant flag gating the 2,000 MXN/month platform subscription (ADR 008). */
		platformSubscriptionEnabled: v.optional(v.boolean()),
		/** Stripe Billing Customer for the platform subscription (platform account, not Connect). */
		stripeBillingCustomerId: v.optional(v.string()),
		stripeSubscriptionId: v.optional(v.string()),
		/** Raw Stripe subscription status, cached from Billing webhooks (not narrowed: Stripe evolves these). */
		billingStatus: v.optional(v.string()),
		/** Epoch ms end of the current billing period, cached from Billing webhooks. */
		billingCurrentPeriodEnd: v.optional(v.number()),
		/**
		 * Cached `cancel_at_period_end`: the subscription is scheduled to end at
		 * `billingCurrentPeriodEnd` but is still `active` until then. Without this
		 * the settings UI would show a plain "active" after a cancellation and
		 * only find out at the period boundary.
		 */
		billingCancelAtPeriodEnd: v.optional(v.boolean()),
		/**
		 * Geofence for customer ordering (TAVLI-6). When latitude/longitude are
		 * unset the geofence is skipped entirely. This is a soft UX gate — browser
		 * geolocation is spoofable; unpaid tabs are settled by staff in person.
		 */
		latitude: v.optional(v.number()),
		longitude: v.optional(v.number()),
		/** Meters; falls back to DEFAULT_GEOFENCE_RADIUS_METERS when unset. */
		geofenceRadiusMeters: v.optional(v.number()),
		/** Staff-shared code that bypasses the geofence when location is denied/unavailable. */
		geofenceBypassCode: v.optional(v.string()),
		isActive: v.boolean(),
		/** Clerk subject of the per-restaurant shared employee session. See ADR 006. */
		sharedEmployeeClerkSubject: v.optional(v.string()),
		/** Set when soft-deleted; absent means active. */
		deletedAt: v.optional(v.number()),
		deletedBy: v.optional(v.string()),
		/** Epoch ms after which the cron may hard-delete (typically deletedAt + 30d). */
		hardDeleteAfterAt: v.optional(v.number()),
		/** Public slug before soft delete; used on restore if still available. */
		slugBeforeSoftDelete: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
		updatedBy: v.optional(v.string()),
	})
		.index("by_slug", ["slug"])
		.index("by_owner", ["ownerId"])
		.index("by_organization", ["organizationId"])
		.index("by_stripe_account", ["stripeAccountId"])
		// Platform-subscription webhooks arrive keyed by Stripe Customer or
		// Subscription id and must resolve back to the restaurant without a
		// table scan. Two indexes because the two Billing event families carry
		// different handles: invoices carry the customer, subscription events
		// carry the subscription.
		.index("by_billing_customer", ["stripeBillingCustomerId"])
		.index("by_billing_subscription", ["stripeSubscriptionId"])
		.index("by_hard_delete_after", ["hardDeleteAfterAt"])
		.index("by_shared_employee_subject", ["sharedEmployeeClerkSubject"]),

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
		updatedBy: v.optional(v.string()),
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
		updatedBy: v.optional(v.string()),
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
		// Where this item is prepared. Drives the orders-dashboard station filter
		// and the per-station "ready" workflow. Optional during the rollout —
		// `migrations/backfillPrepStation.ts` populates pre-existing rows with
		// DEFAULT_PREP_STATION; new rows always set it via createMenuItem.
		// Treat unset values as DEFAULT_PREP_STATION at read time.
		prepStation: v.optional(v.union(v.literal(PREP_STATION.KITCHEN), v.literal(PREP_STATION.BAR))),
		createdAt: v.number(),
		updatedAt: v.number(),
		updatedBy: v.optional(v.string()),
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
		updatedBy: v.optional(v.string()),
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
		updatedAt: v.optional(v.number()),
		updatedBy: v.optional(v.string()),
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
		// Optional during the section rollout (Phase 1). New rows always set it
		// (`tables.create` requires it once the restaurant has a Default section);
		// existing rows are backfilled by `sections.backfillDefault`. Phase 2 will
		// tighten this to non-optional.
		sectionId: v.optional(v.id(TABLE.SECTIONS)),
		isActive: v.boolean(),
		createdAt: v.number(),
		// Soft-delete fields: present when the row is in the "recently deleted"
		// window. A cron sweep hard-purges rows whose `hardDeleteAfterAt` has
		// elapsed (see `softDeletePurge.ts`).
		deletedAt: v.optional(v.number()),
		deletedBy: v.optional(v.string()),
		hardDeleteAfterAt: v.optional(v.number()),
		// When this table was soft-deleted as part of a section cascade, this
		// points at the parent section so restoring the section can pair the
		// children back. Standalone table deletes leave this undefined.
		softDeleteParentSectionId: v.optional(v.id(TABLE.SECTIONS)),
	})
		.index("by_restaurant_number", ["restaurantId", "tableNumber"])
		.index("by_restaurant", ["restaurantId"])
		.index("by_section", ["sectionId"])
		.index("by_hard_delete_after", ["hardDeleteAfterAt"])
		.index("by_soft_delete_parent", ["softDeleteParentSectionId"]),

	// Floor sections (zones) tables belong to. A waiter is assigned to a
	// section for the duration of (a sub-window of) a shift via
	// `shiftSectionAssignments`. `isSystem` is a deprecated flag retained for
	// schema compatibility with rows created before the flag was dropped; the
	// `sections.removeSystemFlag` admin migration clears it everywhere.
	[TABLE.SECTIONS]: defineTable({
		restaurantId: v.id(TABLE.RESTAURANTS),
		name: v.optional(v.string()),
		displayOrder: v.number(),
		isActive: v.boolean(),
		isSystem: v.optional(v.boolean()),
		createdAt: v.number(),
		updatedAt: v.number(),
		updatedBy: v.optional(v.string()),
		// Soft-delete fields: present when the row is in the "recently deleted"
		// window. A cron sweep hard-purges rows whose `hardDeleteAfterAt` has
		// elapsed (see `softDeletePurge.ts`).
		deletedAt: v.optional(v.number()),
		deletedBy: v.optional(v.string()),
		hardDeleteAfterAt: v.optional(v.number()),
	})
		.index("by_restaurant", ["restaurantId"])
		.index("by_hard_delete_after", ["hardDeleteAfterAt"]),

	// A Session doubles as the group's shared tab (TAVLI-6): orders accumulate
	// unpaid and one Stripe payment settles the whole tab (subtotal + tip).
	[TABLE.SESSIONS]: defineTable({
		restaurantId: v.id(TABLE.RESTAURANTS),
		tableId: v.optional(v.id(TABLE.TABLES)),
		/** Clerk subject of the diner who opened this session/tab (required for ordering). */
		userId: v.optional(v.string()),
		status: v.union(v.literal("active"), v.literal("closed")),
		startedAt: v.number(),
		closedAt: v.optional(v.number()),
		/** Fallback server attribution when shift table assignment does not cover the table. */
		serverMemberId: v.optional(v.id(TABLE.RESTAURANT_MEMBERS)),
		/** Short shareable code friends use to join this tab. */
		joinCode: v.optional(v.string()),
		/** Clerk subjects of diners who joined via joinCode (the opener is `userId`). */
		memberUserIds: v.optional(v.array(v.string())),
		/** Set while a tab payment is in flight; blocks new/edited orders until cleared. */
		lockedForPaymentAt: v.optional(v.number()),
		paymentState: v.optional(
			v.union(
				v.literal(SESSION_PAYMENT_STATE.UNPAID),
				v.literal(SESSION_PAYMENT_STATE.PENDING),
				v.literal(SESSION_PAYMENT_STATE.PROCESSING),
				v.literal(SESSION_PAYMENT_STATE.PAID),
				v.literal(SESSION_PAYMENT_STATE.FAILED)
			)
		),
		activePaymentId: v.optional(v.id(TABLE.PAYMENTS)),
		/** Tip in smallest currency unit, recorded when the tab payment succeeds. */
		tipAmount: v.optional(v.number()),
		paidAt: v.optional(v.number()),
		/** How the tab was settled: "stripe" (in-app) or "staff" (in person). */
		settledBy: v.optional(v.union(v.literal("stripe"), v.literal("staff"))),
		/** Stamped by the stale-tab sweep when the tab lingers with an unpaid balance. */
		flaggedStaleAt: v.optional(v.number()),
	})
		.index("by_table_status", ["tableId", "status"])
		.index("by_restaurant", ["restaurantId"])
		.index("by_restaurant_status", ["restaurantId", "status"])
		.index("by_restaurant_join_code", ["restaurantId", "joinCode"])
		// Bounds the stuck-tab reconciliation scan to tabs currently locked for
		// payment (unlocked tabs have `lockedForPaymentAt` undefined, which sorts
		// below every timestamp and is excluded by the `gt(0)` lower bound).
		.index("by_locked_for_payment", ["lockedForPaymentAt"])
		// Bounds the hourly stale-tab sweep to active tabs inside a fixed
		// `startedAt` window. Without this the sweep collected every session row
		// ever written and filtered status/age in JS.
		.index("by_status_started", ["status", "startedAt"])
		.index("by_user", ["userId"]),

	[TABLE.ORDERS]: defineTable({
		sessionId: v.id(TABLE.SESSIONS),
		restaurantId: v.id(TABLE.RESTAURANTS),
		tableId: v.id(TABLE.TABLES),
		status: v.union(
			v.literal("draft"),
			// Committed by the diner for in-person payment; staff-only until
			// released to "submitted" by "mark paid in person". See ADR 008.
			v.literal("awaiting_payment"),
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
		/** Clerk subject of the session member who paid for this order (ADR 008). */
		paidByUserId: v.optional(v.string()),
		/** When the diner committed this order for in-person payment. */
		awaitingPaymentAt: v.optional(v.number()),
		/** How this order was settled: "stripe" (pay-at-submit) or "staff" (marked paid in person). Mirrors `sessions.settledBy`. */
		settledBy: v.optional(v.union(v.literal("stripe"), v.literal("staff"))),
		/**
		 * Per-station "ready" timestamps. Set by `markStationReady` when the
		 * staff at that station confirm their portion of the order is done.
		 * When *every* applicable station (= distinct prepStations across the
		 * order's items) has a non-null timestamp, the order's overall
		 * `status` is also flipped to "ready".
		 */
		kitchenReadyAt: v.optional(v.number()),
		barReadyAt: v.optional(v.number()),
		/**
		 * When staff marked this order served. Written once, by
		 * `updateStatus` — the only path into that terminal status — and never
		 * cleared, because nothing transitions back out of `served`.
		 *
		 * Its own column rather than a reading of `updatedAt`: `updatedAt` moves
		 * on any later write (a refund outcome, a session sweep), which would
		 * silently pull an aged-out order back onto the dashboard's Served
		 * segment. Orders served before this field existed fall back to
		 * `updatedAt` at read time (`isServedOrderVisible`).
		 */
		servedAt: v.optional(v.number()),
		/** Monotonic per restaurant per business day; assigned in confirmPayment only. */
		dailyOrderNumber: v.optional(v.number()),
		/** YYYY-MM-DD business-day label at assignment time. */
		orderServiceDateKey: v.optional(v.string()),
		/** Server credit for performance / tips (resolved at payment confirmation). */
		attributedMemberId: v.optional(v.id(TABLE.RESTAURANT_MEMBERS)),
		createdAt: v.number(),
		updatedAt: v.number(),
		updatedBy: v.optional(v.string()),
	})
		.index("by_session", ["sessionId"])
		.index("by_restaurant", ["restaurantId"])
		.index("by_restaurant_status", ["restaurantId", "status"]),

	// One counter row per restaurant. `serviceDateKey` is a generic period key
	// derived from `restaurants.orderNumberResetFrequency` — for daily resets
	// this is `YYYY-MM-DD` (legacy shape), for monthly `YYYY-MM`, for weekly
	// `YYYY-Www` (ISO Mon-start), for bi-weekly `YYYY-Bnn`. The counter resets
	// to 1 whenever the key changes between two confirmPayment calls.
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
		/**
		 * Set by `orders.cancelOrderItem` (86). A cancelled line stays on the
		 * order for history but is excluded from totals, station applicability,
		 * and analytics. `undefined` means the line is live.
		 */
		cancelledAt: v.optional(v.number()),
		/** Clerk subject of the staff member who 86'd the line. */
		cancelledBy: v.optional(v.string()),
		/**
		 * Set when 86'ing this line on a *paid* order produced a Stripe refund
		 * (ADR 008). The tuple below is the per-line refund record — and the
		 * idempotency marker `stripe.refundOrderItem` checks so a replayed
		 * schedule can never refund the same line twice. `undefined` on lines
		 * cancelled while unpaid (no money ever moved for them).
		 */
		refundedAt: v.optional(v.number()),
		/** What came back to the diner for this line: lineTotal + its fee share, clamped/topped-up per `computeLineRefundAmount`. */
		refundAmount: v.optional(v.number()),
		/** Stripe refund id backing `refundAmount`. */
		stripeRefundId: v.optional(v.string()),
		createdAt: v.number(),
	}).index("by_order", ["orderId"]),

	// Kitchen-proposed replacement for a paid line that can't be made (ADR 008).
	// `deltaAmount >= 0` is enforced in app code (equal-or-higher rule);
	// `feeOnDelta` is the service-fee share on that delta. The proposed* fields
	// snapshot the replacement at proposal time, mirroring the `orderItems`
	// denormalization, so the offer the diner accepted stays legible after menu
	// edits.
	[TABLE.SUBSTITUTION_PROPOSALS]: defineTable({
		restaurantId: v.id(TABLE.RESTAURANTS),
		sessionId: v.id(TABLE.SESSIONS),
		orderId: v.id(TABLE.ORDERS),
		orderItemId: v.id(TABLE.ORDER_ITEMS),
		proposedMenuItemId: v.id(TABLE.MENU_ITEMS),
		proposedMenuItemName: v.string(),
		proposedUnitPrice: v.number(),
		quantity: v.number(),
		proposedLineTotal: v.number(),
		/** proposedLineTotal - original lineTotal; >= 0 by the equal-or-higher rule. */
		deltaAmount: v.number(),
		feeOnDelta: v.number(),
		status: v.union(
			v.literal(SUBSTITUTION_PROPOSAL_STATUS.PENDING),
			v.literal(SUBSTITUTION_PROPOSAL_STATUS.ACCEPTED),
			v.literal(SUBSTITUTION_PROPOSAL_STATUS.DECLINED),
			v.literal(SUBSTITUTION_PROPOSAL_STATUS.CANCELLED)
		),
		/** Payment covering deltaAmount + feeOnDelta; set when accepted with a positive delta. */
		supplementalPaymentId: v.optional(v.id(TABLE.PAYMENTS)),
		/** Clerk subject of the staff member who proposed the substitution. */
		proposedBy: v.string(),
		/** Clerk subject of the diner who accepted/declined. */
		respondedByUserId: v.optional(v.string()),
		respondedAt: v.optional(v.number()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_order", ["orderId"])
		.index("by_session_status", ["sessionId", "status"])
		.index("by_restaurant_status", ["restaurantId", "status"]),

	[TABLE.PAYMENTS]: defineTable({
		restaurantId: v.id(TABLE.RESTAURANTS),
		/** Set for legacy per-order payments. Tab payments set `sessionId` instead (XOR). */
		orderId: v.optional(v.id(TABLE.ORDERS)),
		/** Set for tab (session-level) payments covering every payable order in the session. */
		sessionId: v.optional(v.id(TABLE.SESSIONS)),
		amount: v.number(),
		/**
		 * ADR 008 breakdown. New rows satisfy `amount === subtotalAmount +
		 * feeAmount` (tip payments carry feeAmount 0 — the service fee never
		 * applies to tips). Absent on legacy rows.
		 */
		subtotalAmount: v.optional(v.number()),
		feeAmount: v.optional(v.number()),
		/** What this payment paid for (PAYMENT_KIND). Absent kind = legacy row (pre-pivot per-order or tab payment). */
		kind: v.optional(
			v.union(
				v.literal(PAYMENT_KIND.ORDER),
				v.literal(PAYMENT_KIND.TIP),
				v.literal(PAYMENT_KIND.SUBSTITUTION)
			)
		),
		/** Clerk subject of the session member this payment belongs to (ADR 008). */
		paidByUserId: v.optional(v.string()),
		/** Saved card used for one-tap tips / substitution deltas (setup_future_usage off_session). */
		stripePaymentMethodId: v.optional(v.string()),
		/** Set on kind "substitution" rows: the proposal whose delta this payment covers. */
		substitutionProposalId: v.optional(v.id(TABLE.SUBSTITUTION_PROPOSALS)),
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
			v.literal(PAYMENT_REFUND_STATUS.PARTIAL),
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
		/**
		 * Total amount refunded so far, in the smallest currency unit. Set by the
		 * `charge.refunded` webhook (covers both app-initiated refunds and manual
		 * Stripe-dashboard refunds). Equals the captured amount for a full refund;
		 * less than it for a partial refund.
		 */
		amountRefunded: v.optional(v.number()),
		/** Tip portion in smallest currency unit (e.g. cents). */
		gratuityAmount: v.optional(v.number()),
		createdAt: v.number(),
		updatedAt: v.number(),
		updatedBy: v.optional(v.string()),
	})
		.index("by_order", ["orderId"])
		.index("by_session", ["sessionId"])
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

	// Chargeback / dispute facts recorded from `charge.dispute.*` webhooks.
	// The platform is the `losses_collector` (destination charges live on the
	// platform account), so these events arrive on the standard webhook and are
	// persisted here so disputes are visible in-app instead of silently hitting
	// the Stripe balance. One row per Stripe dispute id (upserted: inserted on
	// `.created`, patched on `.closed`).
	[TABLE.STRIPE_DISPUTES]: defineTable({
		stripeDisputeId: v.string(),
		// Best-effort links back to our records, resolved via the charge's
		// PaymentIntent. Absent when the charge is not one we created.
		restaurantId: v.optional(v.id(TABLE.RESTAURANTS)),
		paymentId: v.optional(v.id(TABLE.PAYMENTS)),
		orderId: v.optional(v.id(TABLE.ORDERS)),
		sessionId: v.optional(v.id(TABLE.SESSIONS)),
		stripeChargeId: v.optional(v.string()),
		stripePaymentIntentId: v.optional(v.string()),
		// Raw Stripe dispute reason and status strings (not narrowed to a union:
		// Stripe evolves these and we only surface them for staff visibility).
		reason: v.string(),
		status: v.string(),
		/** Disputed amount in the smallest currency unit. */
		amount: v.number(),
		currency: v.string(),
		/** Event timestamp of the `charge.dispute.created` delivery (ms). */
		openedAt: v.optional(v.number()),
		/** Event timestamp of the `charge.dispute.closed` delivery (ms). */
		closedAt: v.optional(v.number()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_dispute_id", ["stripeDisputeId"])
		.index("by_payment", ["paymentId"])
		.index("by_restaurant", ["restaurantId"]),

	// Platform-level Stripe Customer per Clerk user (ADR 008). Needed so
	// `setup_future_usage: "off_session"` on a pay-at-submit charge can attach
	// the payment method somewhere reusable — one-tap tips and substitution
	// deltas charge it later. Not restaurant-scoped: the customer follows the
	// diner across restaurants.
	[TABLE.STRIPE_CUSTOMERS]: defineTable({
		userId: v.string(),
		stripeCustomerId: v.string(),
		createdAt: v.number(),
		updatedAt: v.number(),
	}).index("by_user", ["userId"]),

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
		updatedBy: v.optional(v.string()),
	})
		.index("by_restaurant_time", ["restaurantId", "startsAt"])
		.index("by_restaurant_status_time", ["restaurantId", "status", "startsAt"])
		.index("by_phone", ["restaurantId", "contact.phone"])
		.index("by_restaurant_idempotency", ["restaurantId", "idempotencyKey"])
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
		updatedBy: v.optional(v.string()),
	}).index("by_restaurant", ["restaurantId"]),

	// ============================================================================
	// Invitations (email → accept → membership rows)
	// ============================================================================
	[TABLE.INVITATIONS]: defineTable({
		token: v.string(),
		email: v.string(),
		...structuredName,
		organizationId: v.id(TABLE.ORGANIZATIONS),
		role: v.union(
			v.literal(USER_ROLES.OWNER),
			v.literal(RESTAURANT_MEMBER_ROLE.MANAGER),
			v.literal(RESTAURANT_MEMBER_ROLE.EMPLOYEE)
		),
		restaurantIds: v.array(v.id(TABLE.RESTAURANTS)),
		invitedBy: v.string(),
		status: v.union(
			v.literal(INVITATION_STATUS.PENDING),
			v.literal(INVITATION_STATUS.ACCEPTED),
			v.literal(INVITATION_STATUS.REVOKED),
			v.literal(INVITATION_STATUS.EXPIRED)
		),
		expiresAt: v.number(),
		acceptedAt: v.optional(v.number()),
		acceptedByUserId: v.optional(v.string()),
		revokedAt: v.optional(v.number()),
		revokedBy: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
		updatedBy: v.optional(v.string()),
	})
		.index("by_token", ["token"])
		.index("by_email", ["email"])
		.index("by_organization", ["organizationId"])
		.index("by_status_expires", ["status", "expiresAt"]),

	// ============================================================================
	// Shifts & floor coverage
	// ============================================================================
	[TABLE.SHIFTS]: defineTable({
		memberId: v.id(TABLE.RESTAURANT_MEMBERS),
		restaurantId: v.id(TABLE.RESTAURANTS),
		startsAt: v.number(),
		endsAt: v.number(),
		shiftRole: v.optional(v.string()),
		status: v.union(
			v.literal(SHIFT_STATUS.SCHEDULED),
			v.literal(SHIFT_STATUS.PUBLISHED),
			v.literal(SHIFT_STATUS.CANCELLED)
		),
		notes: v.optional(v.string()),
		/**
		 * When set, this shift was materialized from a `shiftTemplates` row and
		 * will be re-aligned by template edits. Edit / cancel detaches the row
		 * (clears `templateId`) so the override survives template changes.
		 */
		templateId: v.optional(v.id(TABLE.SHIFT_TEMPLATES)),
		/** Stamped on transition from SCHEDULED to PUBLISHED via `publishWeek`. */
		publishedAt: v.optional(v.number()),
		createdBy: v.string(),
		updatedBy: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_restaurant_time", ["restaurantId", "startsAt"])
		.index("by_member_time", ["memberId", "startsAt"])
		.index("by_restaurant_status_time", ["restaurantId", "status", "startsAt"])
		.index("by_template", ["templateId"]),

	// ============================================================================
	// Shift templates (weekly recurring patterns; cron-materialized into `shifts`)
	// ============================================================================
	//
	// One template = "Member M, every <dayOfWeek>, starting at
	// <startMinutesFromMidnight> in the restaurant's timezone, lasting
	// <durationMinutes>". Concrete `shifts` rows are inserted by
	// `shiftTemplates.materializeAllTemplates` (daily cron) and eagerly on save
	// for SHIFT_TEMPLATE_HORIZON_WEEKS weeks ahead. Editing a single concrete
	// instance detaches it from its template (clears `shifts.templateId`).
	[TABLE.SHIFT_TEMPLATES]: defineTable({
		memberId: v.id(TABLE.RESTAURANT_MEMBERS),
		restaurantId: v.id(TABLE.RESTAURANTS),
		organizationId: v.id(TABLE.ORGANIZATIONS),
		/** 0 = Monday … 6 = Sunday (Mon-start week). */
		dayOfWeek: v.number(),
		/** 0..1439 minutes after local midnight in the restaurant's timezone. */
		startMinutesFromMidnight: v.number(),
		/** Length of the shift in minutes; must be > 0 and ≤ 24h. */
		durationMinutes: v.number(),
		shiftRole: v.optional(v.string()),
		notes: v.optional(v.string()),
		/** Inclusive YYYY-MM-DD start date; weeks before this aren't materialized. */
		activeFromYmd: v.string(),
		/** Inclusive YYYY-MM-DD end date; null = open-ended (rolling horizon). */
		activeUntilYmd: v.optional(v.string()),
		isActive: v.boolean(),
		createdBy: v.string(),
		updatedBy: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_restaurant", ["restaurantId"])
		.index("by_member", ["memberId"])
		.index("by_restaurant_active", ["restaurantId", "isActive"]),

	[TABLE.SHIFT_TABLE_ASSIGNMENTS]: defineTable({
		shiftId: v.id(TABLE.SHIFTS),
		restaurantId: v.id(TABLE.RESTAURANTS),
		tableId: v.id(TABLE.TABLES),
		startsAt: v.number(),
		endsAt: v.number(),
		createdBy: v.string(),
		updatedBy: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_shift", ["shiftId"])
		.index("by_table_time", ["tableId", "startsAt"])
		.index("by_restaurant_time", ["restaurantId", "startsAt"]),

	// Time-windowed assignment of a shift's member to a section. The
	// authoritative source for waiter attribution at `confirmPayment`. Mirrors
	// the shape of `shiftTableAssignments`. Overlapping windows for the same
	// section are rejected at insert time.
	[TABLE.SHIFT_SECTION_ASSIGNMENTS]: defineTable({
		shiftId: v.id(TABLE.SHIFTS),
		restaurantId: v.id(TABLE.RESTAURANTS),
		sectionId: v.id(TABLE.SECTIONS),
		startsAt: v.number(),
		endsAt: v.number(),
		createdBy: v.string(),
		updatedBy: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_shift", ["shiftId"])
		.index("by_section_time", ["sectionId", "startsAt"])
		.index("by_restaurant_time", ["restaurantId", "startsAt"]),

	// ============================================================================
	// Attendance
	// ============================================================================
	[TABLE.CLOCK_EVENTS]: defineTable({
		memberId: v.id(TABLE.RESTAURANT_MEMBERS),
		restaurantId: v.id(TABLE.RESTAURANTS),
		type: v.union(v.literal(CLOCK_EVENT_TYPE.IN), v.literal(CLOCK_EVENT_TYPE.OUT)),
		at: v.number(),
		shiftId: v.optional(v.id(TABLE.SHIFTS)),
		source: v.union(
			v.literal(CLOCK_EVENT_SOURCE.WEB),
			v.literal(CLOCK_EVENT_SOURCE.KIOSK),
			v.literal(CLOCK_EVENT_SOURCE.API)
		),
		reason: v.optional(v.string()),
		correctedBy: v.optional(v.string()),
		originalAt: v.optional(v.number()),
		createdAt: v.number(),
	})
		.index("by_member_time", ["memberId", "at"])
		.index("by_restaurant_time", ["restaurantId", "at"]),

	[TABLE.ABSENCES]: defineTable({
		memberId: v.id(TABLE.RESTAURANT_MEMBERS),
		restaurantId: v.id(TABLE.RESTAURANTS),
		date: v.string(),
		type: v.union(
			v.literal(ABSENCE_TYPE.VACATION),
			v.literal(ABSENCE_TYPE.SICK),
			v.literal(ABSENCE_TYPE.UNEXCUSED),
			v.literal(ABSENCE_TYPE.OTHER)
		),
		reason: v.optional(v.string()),
		status: v.union(
			v.literal(ABSENCE_REQUEST_STATUS.PENDING),
			v.literal(ABSENCE_REQUEST_STATUS.APPROVED),
			v.literal(ABSENCE_REQUEST_STATUS.DENIED)
		),
		requestedAt: v.number(),
		decidedBy: v.optional(v.string()),
		decidedAt: v.optional(v.number()),
		createdBy: v.string(),
		updatedBy: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_member_date", ["memberId", "date"])
		.index("by_restaurant_date_status", ["restaurantId", "date", "status"]),

	[TABLE.SHIFT_ATTENDANCE]: defineTable({
		shiftId: v.id(TABLE.SHIFTS),
		restaurantId: v.id(TABLE.RESTAURANTS),
		memberId: v.id(TABLE.RESTAURANT_MEMBERS),
		status: v.union(
			v.literal(ATTENDANCE_STATUS.SCHEDULED),
			v.literal(ATTENDANCE_STATUS.PRESENT),
			v.literal(ATTENDANCE_STATUS.EARLY_DEPARTURE),
			v.literal(ATTENDANCE_STATUS.NO_CLOCKOUT),
			v.literal(ATTENDANCE_STATUS.ABSENT_EXCUSED),
			v.literal(ATTENDANCE_STATUS.ABSENT_UNEXCUSED)
		),
		scheduledStart: v.number(),
		scheduledEnd: v.number(),
		actualStart: v.optional(v.number()),
		actualEnd: v.optional(v.number()),
		lateMinutes: v.number(),
		earlyDepartureMinutes: v.number(),
		lastComputedAt: v.number(),
	})
		.index("by_shift", ["shiftId"])
		.index("by_restaurant_member_time", ["restaurantId", "memberId", "scheduledStart"]),

	// ============================================================================
	// Tips
	// ============================================================================
	[TABLE.TIP_POOLS]: defineTable({
		restaurantId: v.id(TABLE.RESTAURANTS),
		businessDate: v.string(),
		totalAmountCents: v.number(),
		distributionRule: v.union(
			v.literal(TIP_DISTRIBUTION_RULE.EQUAL),
			v.literal(TIP_DISTRIBUTION_RULE.EQUAL_BY_HOURS),
			v.literal(TIP_DISTRIBUTION_RULE.ROLE_WEIGHTED_POINTS),
			v.literal(TIP_DISTRIBUTION_RULE.MANUAL)
		),
		status: v.union(
			v.literal(TIP_POOL_STATUS.OPEN),
			v.literal(TIP_POOL_STATUS.FINALIZED),
			v.literal(TIP_POOL_STATUS.PAID)
		),
		finalizedBy: v.optional(v.string()),
		finalizedAt: v.optional(v.number()),
		createdBy: v.string(),
		updatedBy: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
	}).index("by_restaurant_date", ["restaurantId", "businessDate"]),

	[TABLE.TIP_POOL_SHARES]: defineTable({
		poolId: v.id(TABLE.TIP_POOLS),
		memberId: v.id(TABLE.RESTAURANT_MEMBERS),
		hoursWorked: v.number(),
		points: v.number(),
		sharePercent: v.number(),
		amountCents: v.number(),
		createdAt: v.number(),
		updatedAt: v.number(),
	}).index("by_pool", ["poolId"]),

	[TABLE.TIP_ENTRIES]: defineTable({
		restaurantId: v.id(TABLE.RESTAURANTS),
		memberId: v.optional(v.id(TABLE.RESTAURANT_MEMBERS)),
		shiftId: v.optional(v.id(TABLE.SHIFTS)),
		source: v.union(v.literal(TIP_ENTRY_SOURCE.CASH), v.literal(TIP_ENTRY_SOURCE.OTHER)),
		amountCents: v.number(),
		enteredBy: v.string(),
		enteredAt: v.number(),
		notes: v.optional(v.string()),
		businessDate: v.string(),
		createdAt: v.number(),
		updatedAt: v.number(),
		updatedBy: v.optional(v.string()),
	}).index("by_restaurant_date", ["restaurantId", "businessDate"]),

	// ============================================================================
	// Dashboard layouts & templates
	// ============================================================================
	//
	// Configurable per-user dashboard. A layout is owned by exactly one user
	// (`userId`) and bound to either a single restaurant (`scopeKind: "restaurant"`,
	// `restaurantId` set) or to the user's full restaurant portfolio
	// (`scopeKind: "portfolio"`, `restaurantId` absent). Each user may have many
	// layouts per restaurant; `position` orders the tabs.
	//
	// `config.widgets[].options` is widget-specific and parsed via per-widget
	// Zod schemas in the frontend registry.
	[TABLE.DASHBOARD_LAYOUTS]: defineTable({
		userId: v.string(),
		scopeKind: v.union(v.literal("restaurant"), v.literal("portfolio")),
		restaurantId: v.optional(v.id(TABLE.RESTAURANTS)),
		name: v.string(),
		position: v.number(),
		config: v.object({
			globalDateRange: v.string(),
			customRange: v.optional(v.object({ from: v.number(), to: v.number() })),
			compareToPrev: v.boolean(),
			widgets: v.array(
				v.object({
					instanceId: v.string(),
					widgetType: v.string(),
					gridPosition: v.object({
						x: v.number(),
						y: v.number(),
						w: v.number(),
						h: v.number(),
					}),
					options: v.any(),
					dateRangeOverride: v.optional(
						v.object({
							kind: v.string(),
							custom: v.optional(v.object({ from: v.number(), to: v.number() })),
						})
					),
				})
			),
		}),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_user_restaurant", ["userId", "restaurantId"])
		.index("by_user_scopeKind", ["userId", "scopeKind"])
		// Restaurant hard-purge cascade: find every layout bound to a restaurant
		// without scanning per user. Portfolio layouts (restaurantId unset) sort
		// under `undefined` and are never matched by an eq() on a real id.
		.index("by_restaurant", ["restaurantId"]),

	// Restaurant-scoped dashboard templates published by managers and cloneable
	// by any staff member with access to that restaurant. The cloned layout is
	// independent — later edits to the template do NOT propagate to clones.
	[TABLE.DASHBOARD_TEMPLATES]: defineTable({
		restaurantId: v.id(TABLE.RESTAURANTS),
		publishedBy: v.string(),
		name: v.string(),
		description: v.optional(v.string()),
		config: v.any(),
		createdAt: v.number(),
		updatedAt: v.number(),
	}).index("by_restaurant", ["restaurantId"]),

	// ============================================================================
	// Employee Accounts (managed profiles, no Clerk identity — ADR 006)
	// ============================================================================
	[TABLE.EMPLOYEE_ACCOUNTS]: defineTable({
		restaurantId: v.id(TABLE.RESTAURANTS),
		organizationId: v.id(TABLE.ORGANIZATIONS),
		firstName: v.string(),
		paternalLastname: v.string(),
		maternalLastname: v.string(),
		photoStorageId: v.optional(v.id("_storage")),
		pinHash: v.string(),
		pinSetAt: v.number(),
		pinResetCount: v.number(),
		failedPinAttempts: v.number(),
		lastPinAttemptAt: v.optional(v.number()),
		lockedUntil: v.optional(v.number()),
		removedAt: v.optional(v.number()),
		removedBy: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
		updatedBy: v.optional(v.string()),
	})
		.index("by_restaurant", ["restaurantId"])
		.index("by_organization", ["organizationId"]),

	// ============================================================================
	// Rate limiting
	// ============================================================================
	//
	// Fixed-window counters for abuse control on public, anonymous surfaces
	// (currently the reservation create paths). One row per `key`; the key
	// scopes the counter (e.g. per restaurant + contact identity). `windowStart`
	// marks the start of the active window and `count` is the number of hits
	// recorded in it. See `_util/rateLimit.ts` for the pure decision logic and
	// the read/increment helper. Not a substitute for edge-level protection --
	// it bounds work reachable through cheap authenticated-by-nothing calls.
	[TABLE.RATE_LIMITS]: defineTable({
		key: v.string(),
		windowStart: v.number(),
		count: v.number(),
		updatedAt: v.number(),
	}).index("by_key", ["key"]),

	// ============================================================================
	// WhatsApp Chatbot (Twilio) — see ADR 010
	// ============================================================================
	//
	// The assistant's tables. `whatsappChannels` maps a restaurant's
	// WhatsApp sender number (the Twilio "To") to a restaurant so an inbound
	// message can be routed. A `Conversation` is the thread with one customer
	// phone on one channel; `whatsappMessages` is the append-only in/out log,
	// deduped on Twilio's `messageSid`. Phone numbers are stored normalized to
	// E.164 (no "whatsapp:" prefix).
	[TABLE.WHATSAPP_CHANNELS]: defineTable({
		restaurantId: v.id(TABLE.RESTAURANTS),
		// Normalized E.164 of the WhatsApp sender number (Twilio "To").
		phoneNumber: v.string(),
		isActive: v.boolean(),
		// Fallback reply locale for this channel ("en" | "es") before per-message
		// detection; falls back further to restaurant.defaultLanguage.
		defaultLocale: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
		updatedBy: v.optional(v.string()),
	})
		.index("by_phone_number", ["phoneNumber"])
		.index("by_restaurant", ["restaurantId"]),

	[TABLE.WHATSAPP_CONVERSATIONS]: defineTable({
		channelId: v.id(TABLE.WHATSAPP_CHANNELS),
		// Denormalized for direct restaurant-scoped reads.
		restaurantId: v.id(TABLE.RESTAURANTS),
		// Normalized E.164 of the customer (Twilio "From").
		customerPhone: v.string(),
		status: v.union(
			v.literal(WHATSAPP_CONVERSATION_STATUS.ACTIVE),
			v.literal(WHATSAPP_CONVERSATION_STATUS.HANDOFF),
			v.literal(WHATSAPP_CONVERSATION_STATUS.CLOSED)
		),
		// Sticky reply locale once detected for this customer.
		locale: v.optional(v.string()),
		// Twilio's `ProfileName` for this customer — a display name only, never an
		// authorization input. Used so a reservation's required `contact.name` does
		// not have to be invented by the model.
		customerName: v.optional(v.string()),
		// Drives the retention purge and context ordering.
		lastMessageAt: v.number(),
		// Last inbound timestamp — WhatsApp 24h freeform-reply window bookkeeping.
		lastInboundAt: v.number(),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_channel_customer", ["channelId", "customerPhone"])
		.index("by_restaurant", ["restaurantId"])
		.index("by_last_message", ["lastMessageAt"]),

	[TABLE.WHATSAPP_MESSAGES]: defineTable({
		conversationId: v.id(TABLE.WHATSAPP_CONVERSATIONS),
		restaurantId: v.id(TABLE.RESTAURANTS),
		direction: v.union(
			v.literal(WHATSAPP_MESSAGE_DIRECTION.INBOUND),
			v.literal(WHATSAPP_MESSAGE_DIRECTION.OUTBOUND)
		),
		// Twilio SID: inbound MessageSid (dedupe) or the SID returned on send.
		messageSid: v.optional(v.string()),
		body: v.string(),
		/**
		 * Outbound only: the model's own words, without the server-composed notice
		 * lines `body` also carries. This is the ONLY thing replayed as context for
		 * an outbound row — replaying `body` taught the model to write its own ✅
		 * confirmations and to invent confirmation codes. Absent (a row from before
		 * this field) or empty (an entirely server-composed message) means the row
		 * is not replayed at all; there is no fallback to `body`.
		 */
		modelBody: v.optional(v.string()),
		mediaUrl: v.optional(v.string()),
		// Set when the Twilio send failed, so the row is kept for the message log
		// but excluded from the context replayed to the model — otherwise the
		// assistant is told it said something the customer never received.
		deliveryFailedAt: v.optional(v.number()),
		createdAt: v.number(),
	})
		.index("by_conversation", ["conversationId"])
		.index("by_message_sid", ["messageSid"])
		.index("by_created", ["createdAt"]),

	// A destructive action the customer has been offered but has NOT yet
	// authorized. `request_cancel` writes one of these and returns a code; the
	// cancellation only happens when the *next* inbound message carries that code,
	// matched deterministically in `processing.ts` before the model runs.
	//
	// This is what makes injected text unable to cancel a booking: a forwarded
	// message, a poisoned menu description, or an instruction buried in
	// conversation history can each influence one turn's tool calls, but none can
	// produce a second inbound message containing an unguessable code.
	[TABLE.WHATSAPP_PENDING_ACTIONS]: defineTable({
		conversationId: v.id(TABLE.WHATSAPP_CONVERSATIONS),
		restaurantId: v.id(TABLE.RESTAURANTS),
		// Re-checked on consume so a code minted for one phone cannot be redeemed
		// by another, even if the conversation row were somehow reused.
		customerPhone: v.string(),
		kind: v.union(
			v.literal(WHATSAPP_PENDING_ACTION.CANCEL_RESERVATION),
			v.literal(WHATSAPP_PENDING_ACTION.RESCHEDULE_RESERVATION)
		),
		reservationId: v.id(TABLE.RESERVATIONS),
		// Set only for `reschedule_reservation`: the move the code authorizes.
		// Stored rather than re-derived so the customer confirms the exact time
		// they were quoted, not whatever the model would say a second time.
		newStartsAt: v.optional(v.number()),
		newPartySize: v.optional(v.number()),
		/** Short numeric code the customer echoes back. Single-use. */
		code: v.string(),
		expiresAt: v.number(),
		consumedAt: v.optional(v.number()),
		createdAt: v.number(),
	})
		.index("by_conversation_code", ["conversationId", "code"])
		.index("by_conversation", ["conversationId"])
		.index("by_expires", ["expiresAt"]),

	// ============================================================================
	// Unified Event Store
	// ============================================================================
	[TABLE.ALL_EVENTS]: defineTable({
		eventType: v.string(),
		aggregateType: v.union(...Object.values(TABLE).map((table) => v.literal(table))),
		aggregateId: v.string(),
		// Restaurant the event belongs to; unset for org-level events (role
		// bootstrap, multi-restaurant invitations) and for rows predating the
		// column (backfilled best-effort by `migrations/backfillAllEventsRestaurantId`).
		// Deliberately allowed to dangle after a restaurant purge: events are the
		// surviving record, and this id is their correlation key.
		restaurantId: v.optional(v.id(TABLE.RESTAURANTS)),
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
		.index("by_aggregate_type", ["aggregateType"])
		// "Everything that happened at restaurant X (in a time range)" — the
		// forensic query that used to require payload scans.
		.index("by_restaurant_time", ["restaurantId", "timestamp"]),
});
