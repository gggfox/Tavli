import { Doc, Id } from "./_generated/dataModel";

export const TABLE = {
	ALL_EVENTS: "allEvents",
	USER_SETTINGS: "userSettings",
	USER_ROLES: "userRoles",
	ORGANIZATIONS: "organizations",
	FEATURE_FLAGS: "featureFlags",
	RESTAURANTS: "restaurants",
	MENUS: "menus",
	MENU_CATEGORIES: "menuCategories",
	MENU_ITEMS: "menuItems",
	MENU_ITEM_OPTION_GROUPS: "menuItemOptionGroups",
	OPTION_GROUPS: "optionGroups",
	OPTIONS: "options",
	TABLES: "tables",
	SECTIONS: "sections",
	SESSIONS: "sessions",
	ORDERS: "orders",
	ORDER_ITEMS: "orderItems",
	SUBSTITUTION_PROPOSALS: "substitutionProposals",
	PAYMENTS: "payments",
	STRIPE_WEBHOOK_EVENTS: "stripeWebhookEvents",
	STRIPE_DISPUTES: "stripeDisputes",
	STRIPE_CUSTOMERS: "stripeCustomers",
	RESERVATIONS: "reservations",
	TABLE_LOCKS: "tableLocks",
	RESERVATION_SETTINGS: "reservationSettings",
	ORDER_DAY_COUNTERS: "orderDayCounters",
	RESTAURANT_MEMBERS: "restaurantMembers",
	INVITATIONS: "invitations",
	SHIFTS: "shifts",
	SHIFT_TEMPLATES: "shiftTemplates",
	SHIFT_TABLE_ASSIGNMENTS: "shiftTableAssignments",
	SHIFT_SECTION_ASSIGNMENTS: "shiftSectionAssignments",
	CLOCK_EVENTS: "clockEvents",
	ABSENCES: "absences",
	SHIFT_ATTENDANCE: "shiftAttendance",
	TIP_POOLS: "tipPools",
	TIP_POOL_SHARES: "tipPoolShares",
	TIP_ENTRIES: "tipEntries",
	DASHBOARD_LAYOUTS: "dashboardLayouts",
	DASHBOARD_TEMPLATES: "dashboardTemplates",
	EMPLOYEE_ACCOUNTS: "employeeAccounts",
	RATE_LIMITS: "rateLimits",
	WHATSAPP_CHANNELS: "whatsappChannels",
	WHATSAPP_CONVERSATIONS: "whatsappConversations",
	WHATSAPP_MESSAGES: "whatsappMessages",
	WHATSAPP_PENDING_ACTIONS: "whatsappPendingActions",
} as const;

export type TableName = (typeof TABLE)[keyof typeof TABLE];

export type UserSettingsId = Id<typeof TABLE.USER_SETTINGS>;
export type UserRoleDoc = Doc<typeof TABLE.USER_ROLES>;
export type UserSettingsDoc = Doc<typeof TABLE.USER_SETTINGS>;
export type OrganizationDoc = Doc<typeof TABLE.ORGANIZATIONS>;

export const USER_ROLES = {
	ADMIN: "admin",
	OWNER: "owner",
	MANAGER: "manager",
	CUSTOMER: "customer",
	EMPLOYEE: "employee",
} as const;

export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];

/**
 * Roles considered "staff" — gated behind the admin layout and
 * staff-only sidebar entries. Derived from USER_ROLES so renaming a
 * role flows through automatically.
 */
export const STAFF_ROLES = [
	USER_ROLES.ADMIN,
	USER_ROLES.OWNER,
	USER_ROLES.MANAGER,
	USER_ROLES.EMPLOYEE,
] as const satisfies ReadonlyArray<UserRole>;

export type StaffRole = (typeof STAFF_ROLES)[number];

export const ORDER_STATUS = {
	DRAFT: "draft",
	/**
	 * Committed by the diner for in-person (cash) payment. Visible only to
	 * staff — never on the kitchen rail — until staff mark it paid and release
	 * it to "submitted". See ADR 008.
	 */
	AWAITING_PAYMENT: "awaiting_payment",
	SUBMITTED: "submitted",
	PREPARING: "preparing",
	READY: "ready",
	SERVED: "served",
	CANCELLED: "cancelled",
} as const;

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

/**
 * How often the per-restaurant order-number counter resets. Stored on
 * `restaurants.orderNumberResetFrequency`; missing rows behave as
 * `DEFAULT_ORDER_NUMBER_RESET_FREQUENCY`.
 */
export const ORDER_NUMBER_RESET_FREQUENCY = {
	DAILY: "daily",
	WEEKLY: "weekly",
	BIWEEKLY: "biweekly",
	MONTHLY: "monthly",
} as const;

export type OrderNumberResetFrequency =
	(typeof ORDER_NUMBER_RESET_FREQUENCY)[keyof typeof ORDER_NUMBER_RESET_FREQUENCY];

export const DEFAULT_ORDER_NUMBER_RESET_FREQUENCY: OrderNumberResetFrequency =
	ORDER_NUMBER_RESET_FREQUENCY.MONTHLY;

/** Default IANA timezone for restaurants when unset or invalid. */
export const DEFAULT_RESTAURANT_TIMEZONE = "America/Mexico_City";

/**
 * Operating-hours fallbacks when a restaurant leaves `openTime`/`closeTime`
 * unset. These bound the Timeline's rendered range *and* which start times are
 * bookable, so a restaurant that never configured hours still cannot take a
 * 03:00 reservation.
 */
export const DEFAULT_RESTAURANT_OPEN_TIME = "10:00";
export const DEFAULT_RESTAURANT_CLOSE_TIME = "23:00";

/**
 * Payment state of a single **order**.
 *
 * Note this is a different aggregate from `PAYMENT_REFUND_STATUS`, which
 * describes the whole payment. An order covered by a tab can be `refunded`
 * while the tab payment is only `partial` — the order's share came back, the
 * rest of the tab did not. That combination is correct, not a bug: an order's
 * share is either refunded or it isn't, so this enum needs no `partial` member.
 */
export const ORDER_PAYMENT_STATE = {
	UNPAID: "unpaid",
	PENDING: "pending",
	PROCESSING: "processing",
	PAID: "paid",
	FAILED: "failed",
	REFUND_REQUESTED: "refund_requested",
	REFUNDED: "refunded",
	REFUND_FAILED: "refund_failed",
} as const;

export type OrderPaymentState = (typeof ORDER_PAYMENT_STATE)[keyof typeof ORDER_PAYMENT_STATE];

export const PAYMENT_STATUS = {
	PENDING: "pending",
	PROCESSING: "processing",
	SUCCEEDED: "succeeded",
	FAILED: "failed",
	SUPERSEDED: "superseded",
	CANCELLED: "cancelled",
} as const;

export type PaymentStatus = (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS];

export const PAYMENT_REFUND_STATUS = {
	NONE: "none",
	REQUESTED: "requested",
	/** The full captured amount has been refunded. */
	SUCCEEDED: "succeeded",
	/** Only part of the captured amount has been refunded (e.g. a manual partial refund). */
	PARTIAL: "partial",
	FAILED: "failed",
} as const;

export type PaymentRefundStatus =
	(typeof PAYMENT_REFUND_STATUS)[keyof typeof PAYMENT_REFUND_STATUS];

export const SESSION_STATUS = {
	ACTIVE: "active",
	CLOSED: "closed",
} as const;

export type SessionStatus = (typeof SESSION_STATUS)[keyof typeof SESSION_STATUS];

/**
 * Payment lifecycle of a Session's shared tab. The tab (Session) is the unit
 * a group pays for: one Stripe payment covers every payable order in the
 * session plus an optional tip.
 */
export const SESSION_PAYMENT_STATE = {
	UNPAID: "unpaid",
	PENDING: "pending",
	PROCESSING: "processing",
	PAID: "paid",
	FAILED: "failed",
} as const;

export type SessionPaymentState =
	(typeof SESSION_PAYMENT_STATE)[keyof typeof SESSION_PAYMENT_STATE];

/**
 * LEGACY TAB MODEL (pre-ADR-008): order statuses whose totals count toward a
 * tab balance. Kept for sessions opened before the pay-at-submit cutover,
 * whose unpaid balances still settle through the tab flow. Draft orders are
 * not yet sent to the kitchen; cancelled orders are excluded — and
 * `awaiting_payment` must NOT appear here: those orders are collected in
 * person, never through a tab payment.
 */
export const TAB_PAYABLE_ORDER_STATUSES = ["submitted", "preparing", "ready", "served"] as const;

/**
 * LEGACY TAB MODEL (pre-ADR-008): order statuses a tab payment is allowed to
 * settle. Kept for sessions opened before the pay-at-submit cutover.
 * Everything else on the tab is billed but blocks checkout until staff serve
 * it or cancel it.
 *
 * Deliberately an **allowlist**. Settling food the diner never received is the
 * only way a Stripe refund happens on the tab path (`served` is terminal in
 * `VALID_TRANSITIONS`, so delivered food can never be cancelled), and refunds
 * are fronted by the platform balance. A blocklist would silently permit a
 * newly-added status to be settled — the money-losing direction. The
 * `satisfies` clause makes "settleable but not payable" a compile error.
 */
export const TAB_SETTLEABLE_ORDER_STATUSES = [ORDER_STATUS.SERVED] as const satisfies ReadonlyArray<
	(typeof TAB_PAYABLE_ORDER_STATUSES)[number]
>;

/**
 * How long an order stays on the Orders dashboard's **Served** segment after
 * staff mark it served.
 *
 * `served` is terminal (see `VALID_TRANSITIONS`), so a served order is work
 * that is finished — but the segment used to accumulate every order the
 * restaurant had ever served, because the only time axis was the service-day
 * filter and its default is "all".
 *
 * Thirty minutes is the compromise. It is far longer than the undo affordances
 * around it (ADR 007's station-ready undo is seconds), which matters more here
 * because `served` has no undo at all: if staff mark the wrong order served,
 * the card staying put is the only way they notice. It also covers the lag
 * before a diner says "this isn't what I ordered". And it is short enough that
 * the segment is empty again well before the next service.
 *
 * Nothing is deleted — an aged-out order is still in the Payments ledger, the
 * exports, and the audit log.
 */
export const SERVED_VISIBLE_WINDOW_MS = 30 * 60 * 1000;

/** Alphabet for session join codes: no 0/O/1/I lookalikes. */
export const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const JOIN_CODE_LENGTH = 6;

/**
 * Tavli service fee, charged to the DINER on top of the order subtotal
 * (ADR 008 — reverses the pre-pivot restaurant-borne carve-out). Applied to
 * order subtotals and substitution deltas, never tips. The restaurant nets
 * the full subtotal.
 */
export const PLATFORM_APPLICATION_FEE_RATE = 0.12;

/** Tip selector presets (percent of the member's own spend at Visit close-out; skipping is the zero option). */
export const TIP_PERCENT_PRESETS = [10, 15, 20] as const;
export const DEFAULT_TIP_PERCENT = 10;

/**
 * What a `payments` row paid for (ADR 008). Rows without a `kind` are legacy
 * (pre-pivot per-order or tab payments).
 */
export const PAYMENT_KIND = {
	/** Pay-at-submit charge for one order (subtotal + service fee). */
	ORDER: "order",
	/** A member's post-visit tip on a session; never carries a service fee. */
	TIP: "tip",
	/** The price delta (+ fee on delta) of an accepted substitution. */
	SUBSTITUTION: "substitution",
} as const;

export type PaymentKind = (typeof PAYMENT_KIND)[keyof typeof PAYMENT_KIND];

/**
 * How an Order / Session was settled (ADR 008). `stripe` means a `payments`
 * row backs it; `staff` means it was collected in person and there is **no**
 * `payments` row at all — analytics and exports must derive that money from
 * `orders.totalAmount`. Absent on pre-pivot orders settled through a tab.
 */
export const SETTLED_BY = {
	STRIPE: "stripe",
	STAFF: "staff",
} as const;

export type SettledBy = (typeof SETTLED_BY)[keyof typeof SETTLED_BY];

/**
 * Lifecycle of a kitchen-proposed substitution on a paid order (ADR 008).
 * `pending` awaits the diner's answer; `cancelled` is the kitchen retracting
 * its own proposal before the diner responds.
 */
export const SUBSTITUTION_PROPOSAL_STATUS = {
	PENDING: "pending",
	ACCEPTED: "accepted",
	DECLINED: "declined",
	CANCELLED: "cancelled",
} as const;

export type SubstitutionProposalStatus =
	(typeof SUBSTITUTION_PROPOSAL_STATUS)[keyof typeof SUBSTITUTION_PROPOSAL_STATUS];

/**
 * Monthly platform subscription (2,000 MXN) in centavos. Display only — the
 * Stripe Price object is authoritative for what Stripe Billing charges.
 */
export const PLATFORM_MONTHLY_FEE_MXN_CENTS = 200000;

/** Currency the platform subscription is priced in. The Stripe Price is authoritative. */
export const PLATFORM_SUBSCRIPTION_CURRENCY = "MXN";

/**
 * Stripe subscription statuses, cached verbatim on `restaurants.billingStatus`.
 * Listed here so app code and UI copy stop spelling them inline; Stripe may add
 * new ones, so readers must tolerate a status that is absent from this map.
 */
export const BILLING_STATUS = {
	INCOMPLETE: "incomplete",
	INCOMPLETE_EXPIRED: "incomplete_expired",
	TRIALING: "trialing",
	ACTIVE: "active",
	PAST_DUE: "past_due",
	CANCELED: "canceled",
	UNPAID: "unpaid",
	PAUSED: "paused",
} as const;

export type BillingStatus = (typeof BILLING_STATUS)[keyof typeof BILLING_STATUS];

/**
 * Statuses that mean a subscription already exists for this restaurant, so a
 * second Checkout Session would double-bill them. `past_due` / `unpaid` count:
 * the subscription is live and Stripe is retrying, and the fix is a new payment
 * method, not a second subscription.
 */
export const LIVE_BILLING_STATUSES: readonly string[] = [
	BILLING_STATUS.TRIALING,
	BILLING_STATUS.ACTIVE,
	BILLING_STATUS.PAST_DUE,
	BILLING_STATUS.UNPAID,
];

/** Whether `billingStatus` means the restaurant is currently subscribed. */
export function isLiveBillingStatus(status: string | undefined): boolean {
	return status !== undefined && LIVE_BILLING_STATUSES.includes(status);
}

/** Geofence radius fallback when a restaurant configured coordinates but no radius. */
export const DEFAULT_GEOFENCE_RADIUS_METERS = 150;

/** Active tabs older than this are swept: closed when settled, flagged when unpaid. */
export const STALE_TAB_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * How far back the stale-tab sweep looks. Together with STALE_TAB_MAX_AGE_MS
 * this makes the scan a fixed window instead of the whole sessions table: only
 * tabs that went stale within the last 30 days are examined.
 *
 * A tab still active after 30 days was flagged weeks ago and is a staff
 * conversation, not a cron one — the sweep has no further action to take on it.
 */
export const STALE_TAB_SWEEP_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Rows the stale-tab sweep will touch per run, newest-first.
 *
 * Newest-first matters: the actionable work is flagging tabs that *just* crossed
 * the 24h line. Already-flagged tabs sit at the old end of the window and their
 * only remaining sweep work is the close-if-settled pass, which re-runs every
 * hour and so tolerates being deferred a run. Oldest-first would let a backlog
 * of flagged tabs starve the flagging of new ones.
 */
export const STALE_TAB_SWEEP_BATCH_SIZE = 200;

/**
 * How far back the no-show sweep looks for un-flipped reservations. Must
 * comfortably exceed the largest `noShowGraceMinutes` any restaurant can set;
 * 7 days also absorbs a multi-day cron outage.
 *
 * Reservations older than this keep their last status. Previously the scan had
 * no lower bound at all, so every run re-read the restaurant's entire
 * reservation history.
 */
export const NO_SHOW_SWEEP_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Reservations the no-show sweep will flip per status, per restaurant, per run.
 *
 * Safe to cap: a flipped row moves to `no_show`, which drops it out of the
 * pending/confirmed index ranges, so a backlog drains over successive runs
 * rather than being skipped.
 */
export const NO_SHOW_SWEEP_BATCH_SIZE = 200;

/**
 * A tab locked for payment longer than this is reconciled against Stripe: the
 * `payment_intent.succeeded` webhook was likely dropped/delayed, so the cron
 * pulls the PaymentIntent directly and settles/unlocks accordingly.
 */
export const TAB_RECONCILE_MIN_AGE_MS = 10 * 60 * 1000;

/**
 * A tab whose PaymentIntent is still `processing` after this long is logged
 * (console.error) so staff can chase it — Stripe is genuinely mid-flight, so
 * the cron leaves the lock in place rather than guessing.
 */
export const TAB_RECONCILE_ALERT_AGE_MS = 30 * 60 * 1000;

export const SELECTION_TYPE = {
	SINGLE: "single",
	MULTI: "multi",
} as const;

export type SelectionType = (typeof SELECTION_TYPE)[keyof typeof SELECTION_TYPE];

/**
 * Where a menu item is physically prepared. Drives the orders-tab station
 * filter and the per-station "ready" workflow on each order. Aligned with
 * SHIFT_ROLE.KITCHEN / SHIFT_ROLE.BARTENDER vocabulary.
 *
 * NOTE: a station is intentionally NOT the same as a content axis like
 * "food vs beverage" — a non-alcoholic latte may be prepared at the
 * KITCHEN, and an affogato dessert at the BAR. See ADR 005.
 */
export const PREP_STATION = {
	KITCHEN: "kitchen",
	BAR: "bar",
} as const;

export type PrepStation = (typeof PREP_STATION)[keyof typeof PREP_STATION];

/** All known prep stations, useful for iteration and default filter sets. */
export const ALL_PREP_STATIONS = [PREP_STATION.KITCHEN, PREP_STATION.BAR] as const;

/** Default prepStation backfilled onto pre-existing menuItems rows. */
export const DEFAULT_PREP_STATION: PrepStation = PREP_STATION.KITCHEN;

export const RESERVATION_STATUS = {
	PENDING: "pending",
	CONFIRMED: "confirmed",
	SEATED: "seated",
	COMPLETED: "completed",
	CANCELLED: "cancelled",
	NO_SHOW: "no_show",
} as const;

export type ReservationStatus = (typeof RESERVATION_STATUS)[keyof typeof RESERVATION_STATUS];

/**
 * Statuses that count as "active" for double-booking and capacity checks.
 * cancelled and no_show reservations free up the window.
 */
export const ACTIVE_RESERVATION_STATUSES: ReservationStatus[] = [
	RESERVATION_STATUS.PENDING,
	RESERVATION_STATUS.CONFIRMED,
	RESERVATION_STATUS.SEATED,
	RESERVATION_STATUS.COMPLETED,
];

export const RESERVATION_SOURCE = {
	UI: "ui",
	WHATSAPP: "whatsapp",
	STAFF: "staff",
} as const;

export type ReservationSource = (typeof RESERVATION_SOURCE)[keyof typeof RESERVATION_SOURCE];

/**
 * Default reservation settings used when a restaurant has not configured its own.
 * Mutable copies are written into the `reservationSettings` table on first read.
 */
export const DEFAULT_RESERVATION_SETTINGS = {
	defaultTurnMinutes: 90,
	turnMinutesByCapacity: [] as Array<{
		minPartySize: number;
		maxPartySize: number;
		turnMinutes: number;
	}>,
	minAdvanceMinutes: 30,
	maxAdvanceDays: 60,
	noShowGraceMinutes: 15,
	blackoutWindows: [] as Array<{ startsAt: number; endsAt: number; reason?: string }>,
	acceptingReservations: true,
} as const;

/**
 * Fallback capacity for table rows that predate the capacity field. Used by
 * availability checks until the backfill mutation has run.
 */
export const FALLBACK_TABLE_CAPACITY = 4;

/**
 * Ceiling on a reservation's turn time, clamped in `computeTurnMinutes`.
 *
 * This is load-bearing for the conflict read, not just a sanity bound.
 * `findOverlappingReservations` needs a *lower* bound on its index range to
 * avoid scanning a restaurant's entire reservation history, and the only rows
 * that can overlap `[startsAt, endsAt)` from the past are those starting within
 * one turn before it. That argument only holds if no turn can exceed this value,
 * so the clamp and the scan bound must stay in sync.
 */
export const MAX_RESERVATION_TURN_MINUTES = 12 * 60;

/** Per-restaurant roles (stored on restaurantMembers). Org-level owner/admin stay on userRoles. */
export const RESTAURANT_MEMBER_ROLE = {
	MANAGER: "manager",
	EMPLOYEE: "employee",
} as const;

export type RestaurantMemberRole =
	(typeof RESTAURANT_MEMBER_ROLE)[keyof typeof RESTAURANT_MEMBER_ROLE];

export const INVITATION_STATUS = {
	PENDING: "pending",
	ACCEPTED: "accepted",
	REVOKED: "revoked",
	EXPIRED: "expired",
} as const;

export type InvitationStatus = (typeof INVITATION_STATUS)[keyof typeof INVITATION_STATUS];

export const SHIFT_STATUS = {
	SCHEDULED: "scheduled",
	PUBLISHED: "published",
	CANCELLED: "cancelled",
} as const;

export type ShiftStatus = (typeof SHIFT_STATUS)[keyof typeof SHIFT_STATUS];

/**
 * Fixed taxonomy of shift roles. Stored as the literal string in `shifts.shiftRole`
 * and rendered with a role-specific chip color in the schedule grid.
 */
export const SHIFT_ROLE = {
	SERVER: "server",
	BARTENDER: "bartender",
	HOST: "host",
	KITCHEN: "kitchen",
	MANAGER: "manager",
} as const;

export type ShiftRole = (typeof SHIFT_ROLE)[keyof typeof SHIFT_ROLE];

/** How many weeks ahead the cron + eager save materialize template-derived shifts. */
export const SHIFT_TEMPLATE_HORIZON_WEEKS = 4;

/**
 * Day-of-week index used by `shiftTemplates.dayOfWeek`. Monday-start, matching the
 * Mon→Sun layout of the manager schedule grid.
 */
export const SHIFT_TEMPLATE_DAY_OF_WEEK = {
	MONDAY: 0,
	TUESDAY: 1,
	WEDNESDAY: 2,
	THURSDAY: 3,
	FRIDAY: 4,
	SATURDAY: 5,
	SUNDAY: 6,
} as const;

export type ShiftTemplateDayOfWeek =
	(typeof SHIFT_TEMPLATE_DAY_OF_WEEK)[keyof typeof SHIFT_TEMPLATE_DAY_OF_WEEK];

export const CLOCK_EVENT_TYPE = {
	IN: "in",
	OUT: "out",
} as const;

export type ClockEventType = (typeof CLOCK_EVENT_TYPE)[keyof typeof CLOCK_EVENT_TYPE];

export const CLOCK_EVENT_SOURCE = {
	WEB: "web",
	KIOSK: "kiosk",
	API: "api",
} as const;

export type ClockEventSource = (typeof CLOCK_EVENT_SOURCE)[keyof typeof CLOCK_EVENT_SOURCE];

export const ABSENCE_TYPE = {
	VACATION: "vacation",
	SICK: "sick",
	UNEXCUSED: "unexcused",
	OTHER: "other",
} as const;

export type AbsenceType = (typeof ABSENCE_TYPE)[keyof typeof ABSENCE_TYPE];

export const ABSENCE_REQUEST_STATUS = {
	PENDING: "pending",
	APPROVED: "approved",
	DENIED: "denied",
} as const;

export type AbsenceRequestStatus =
	(typeof ABSENCE_REQUEST_STATUS)[keyof typeof ABSENCE_REQUEST_STATUS];

export const ATTENDANCE_STATUS = {
	SCHEDULED: "scheduled",
	PRESENT: "present",
	EARLY_DEPARTURE: "early_departure",
	NO_CLOCKOUT: "no_clockout",
	ABSENT_EXCUSED: "absent_excused",
	ABSENT_UNEXCUSED: "absent_unexcused",
} as const;

export type AttendanceStatus = (typeof ATTENDANCE_STATUS)[keyof typeof ATTENDANCE_STATUS];

export const TIP_DISTRIBUTION_RULE = {
	EQUAL: "equal",
	EQUAL_BY_HOURS: "equal_by_hours",
	ROLE_WEIGHTED_POINTS: "role_weighted_points",
	MANUAL: "manual",
} as const;

export type TipDistributionRule =
	(typeof TIP_DISTRIBUTION_RULE)[keyof typeof TIP_DISTRIBUTION_RULE];

export const TIP_POOL_STATUS = {
	OPEN: "open",
	FINALIZED: "finalized",
	PAID: "paid",
} as const;

export type TipPoolStatus = (typeof TIP_POOL_STATUS)[keyof typeof TIP_POOL_STATUS];

export const TIP_ENTRY_SOURCE = {
	CASH: "cash",
	OTHER: "other",
} as const;

export type TipEntrySource = (typeof TIP_ENTRY_SOURCE)[keyof typeof TIP_ENTRY_SOURCE];

/** PIN lockout parameters for employee accounts. See ADR 006. */
export const PIN_LOCKOUT = {
	MAX_ATTEMPTS: 5,
	WINDOW_MS: 10 * 60 * 1000,
	PIN_LENGTH: 6,
} as const;

/** System actor for migrations and webhooks when no Clerk user applies. */
export const AUDIT_SYSTEM_USER_ID = "system";

/**
 * Non-Clerk audit actors, used as `allEvents.userId` when a real person acted
 * but has no account.
 *
 * Kept distinct from `AUDIT_SYSTEM_USER_ID`: reusing "system" would make a
 * customer-initiated cancellation indistinguishable from the no-show cron in
 * `allEvents.by_user`, which is exactly the question asked when a cancellation
 * is disputed.
 *
 * Deliberately NOT the customer's phone number. `allEvents` is append-only,
 * indexed on `userId`, and has no purge path, so a phone there would be
 * permanently queryable PII that a data-erasure request could not reach. The
 * identifying details go in `payload` as `conversationId` / `messageSid`
 * pointers into the purgeable WhatsApp tables instead.
 */
export const AUDIT_ACTOR = {
	WHATSAPP_CUSTOMER: "whatsapp_customer",
} as const;

export type AuditActor = (typeof AUDIT_ACTOR)[keyof typeof AUDIT_ACTOR];

/**
 * Event names for `appendAuditEvent`. The `allEvents.eventType` column is a bare
 * `v.string()`, so nothing stops a typo from creating a silent second event
 * stream — this map is the guard.
 *
 * Naming follows the convention the existing call sites already use:
 * `<module>.<pastTenseVerb>`.
 *
 * Older modules (menus, shifts, restaurantMembers, …) still pass inline strings.
 * Retrofitting those is a separate, mechanical change; use this map for anything
 * new. Adding a name here is the cheap part — the expensive part is that every
 * event is append-only and permanent, so name it for what happened in the
 * domain, not for the function that emitted it.
 */
export const AUDIT_EVENT = {
	// -- Orders -------------------------------------------------------------
	ORDER_SUBMITTED: "orders.submitted",
	ORDER_STATUS_CHANGED: "orders.statusChanged",
	ORDER_PAYMENT_CONFIRMED: "orders.paymentConfirmed",
	ORDER_PAYMENT_FAILED: "orders.paymentFailed",
	/** Diner abandoned an in-flight card intent (e.g. switching to cash). */
	ORDER_PAYMENT_CANCELLED: "orders.paymentCancelled",
	ORDER_REFUND_SUCCEEDED: "orders.refundSucceeded",
	ORDER_REFUND_FAILED: "orders.refundFailed",
	ORDER_AWAITING_PAYMENT: "orders.awaitingPayment",
	ORDER_PAID_IN_PERSON: "orders.paidInPerson",
	ORDER_ITEM_REFUNDED: "orders.itemRefunded",

	// -- Substitutions (ADR 008) --------------------------------------------
	SUBSTITUTION_PROPOSED: "substitutions.proposed",
	SUBSTITUTION_ACCEPTED: "substitutions.accepted",
	SUBSTITUTION_DECLINED: "substitutions.declined",
	SUBSTITUTION_CANCELLED: "substitutions.cancelled",

	// -- Sessions (tabs) ----------------------------------------------------
	SESSION_OPENED: "sessions.opened",
	SESSION_JOINED: "sessions.joined",
	SESSION_CLOSED: "sessions.closed",
	SESSION_PAYMENT_LOCKED: "sessions.paymentLocked",
	SESSION_PAYMENT_SUCCEEDED: "sessions.paymentSucceeded",
	SESSION_PAYMENT_FAILED: "sessions.paymentFailed",
	SESSION_PAYMENT_CANCELLED: "sessions.paymentCancelled",
	SESSION_STALE_CLOSED: "sessions.staleClosed",
	SESSION_STALE_FLAGGED: "sessions.staleFlagged",
	SESSION_TIP_PAID: "sessions.tipPaid",

	// -- Restaurants (platform subscription, ADR 008) -----------------------
	RESTAURANT_SUBSCRIPTION_CREATED: "restaurants.subscriptionCreated",
	/** Stripe told us the subscription's status or period moved (created/updated webhooks). */
	RESTAURANT_SUBSCRIPTION_STATUS_CHANGED: "restaurants.subscriptionStatusChanged",
	/** Staff asked to cancel; the subscription runs to the end of the paid period. */
	RESTAURANT_SUBSCRIPTION_CANCEL_SCHEDULED: "restaurants.subscriptionCancelScheduled",
	/** Stripe ended the subscription for good (`customer.subscription.deleted`). */
	RESTAURANT_SUBSCRIPTION_CANCELLED: "restaurants.subscriptionCancelled",
	RESTAURANT_SUBSCRIPTION_INVOICE_PAID: "restaurants.subscriptionInvoicePaid",
	RESTAURANT_SUBSCRIPTION_PAYMENT_FAILED: "restaurants.subscriptionPaymentFailed",

	// -- Receipts -----------------------------------------------------------
	RECEIPT_EMAIL_SENT: "receipts.emailSent",

	// -- Invitations --------------------------------------------------------
	// NOTE: the three lifecycle strings below are HISTORICAL — `invitations.created`
	// and `invitations.accepted` were emitted as inline literals long before these
	// constants existed, and rows carrying them are already in `allEvents`. Rename
	// the constant freely; never change the value.
	INVITATION_CREATED: "invitations.created",
	INVITATION_ACCEPTED: "invitations.accepted",
	INVITATION_REVOKED: "invitations.revoked",
	/** One admin bulk CSV onboarding run — counts only, never the recipient list. */
	INVITATION_BULK_IMPORTED: "invitations.bulkImported",

	// -- Reservations -------------------------------------------------------
	RESERVATION_CREATED: "reservations.created",
	RESERVATION_CONFIRMED: "reservations.confirmed",
	RESERVATION_RESCHEDULED: "reservations.rescheduled",
	RESERVATION_RECONFIRMED: "reservations.reconfirmed",
	RESERVATION_CANCELLED: "reservations.cancelled",
	// Distinct from the staff cancel so the two are separable in `allEvents`:
	// same state transition, very different provenance and dispute story.
	RESERVATION_CANCELLED_BY_CUSTOMER: "reservations.cancelledByCustomer",
	RESERVATION_SEATED: "reservations.seated",
	RESERVATION_COMPLETED: "reservations.completed",
	RESERVATION_NO_SHOW: "reservations.noShow",
} as const;

export type AuditEvent = (typeof AUDIT_EVENT)[keyof typeof AUDIT_EVENT];

// =============================================================================
// Admin user onboarding — invitations (single + bulk CSV)
// =============================================================================

/** Longest email we will accept on an invitation (RFC 5321 path limit). */
export const INVITE_EMAIL_MAX_LENGTH = 254;

/**
 * Row cap for one uploaded CSV. 500 covers a whole-group onboarding in a single
 * file while keeping the preview payload (and the classification's per-row DB
 * lookups) inside one Convex query's budget.
 */
export const INVITE_CSV_MAX_ROWS = 500;

/**
 * Byte cap for the uploaded blob, checked before parsing. 500 rows of the widest
 * plausible record is well under 200 KB; 512 KB leaves generous headroom while
 * refusing an accidental multi-megabyte export outright.
 */
export const INVITE_CSV_MAX_BYTES = 512 * 1024;

/**
 * Rows one `commitBulkInvitations` call may create. The preview allows 500, so
 * the client walks the confirmed rows in chunks of this size. Each commit writes
 * up to 3 documents per row (invitation + audit event + rate-limit counters) and
 * schedules one email per row, so a bounded chunk keeps every transaction small
 * and makes a mid-run failure cost one chunk rather than the whole upload.
 */
export const INVITE_BULK_COMMIT_MAX_ROWS = 100;

/**
 * Invitation send budget per inviter, per hour. Sized to let one admin push a
 * full 500-row CSV through (5 chunks of 100) plus normal single invites, while
 * capping a runaway script or a compromised admin session at a few hundred
 * emails rather than unbounded.
 */
export const INVITE_SEND_RATE_LIMIT = { windowMs: 60 * 60 * 1000, max: 600 };

/**
 * Invitation budget per TARGET email address, per day — deliberately tight. The
 * per-inviter cap alone would still let one address be mailed 600 times; this
 * makes a single person un-spammable no matter how many admins or uploads are
 * involved, while leaving room for a legitimate resend or two.
 */
export const INVITE_TARGET_EMAIL_RATE_LIMIT = { windowMs: 24 * 60 * 60 * 1000, max: 5 };

/** Soft-deleted restaurants become eligible for hard delete after this interval. */
export const RESTAURANT_SOFT_DELETE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

// ============================================================================
// WhatsApp Chatbot (Twilio) — see ADR 010
// ============================================================================
//
// A first responder: customers message a restaurant's WhatsApp number and get
// automated menu / availability answers, and can request or cancel a booking on
// their own behalf. A WhatsApp thread is a `Conversation` (deliberately NOT
// reusing the ordering-domain word "Session"). Inbound routing maps the Twilio
// "To" number to a `whatsappChannels` row. Writes are scoped to the sender's
// verified phone number — see ADR 011.

/** Direction of a stored WhatsApp message relative to the restaurant. */
export const WHATSAPP_MESSAGE_DIRECTION = {
	INBOUND: "inbound",
	OUTBOUND: "outbound",
} as const;

export type WhatsappMessageDirection =
	(typeof WHATSAPP_MESSAGE_DIRECTION)[keyof typeof WHATSAPP_MESSAGE_DIRECTION];

/** Lifecycle of a WhatsApp `Conversation`. */
export const WHATSAPP_CONVERSATION_STATUS = {
	ACTIVE: "active",
	HANDOFF: "handoff",
	CLOSED: "closed",
} as const;

export type WhatsappConversationStatus =
	(typeof WHATSAPP_CONVERSATION_STATUS)[keyof typeof WHATSAPP_CONVERSATION_STATUS];

/** Hard cap on stored inbound message length (defensive bound on customer input). */
export const WHATSAPP_MAX_INBOUND_BODY_CHARS = 2000;

/**
 * Hard cap on an outbound reply body. Twilio rejects a WhatsApp body over 1600
 * characters outright (error 21617) — the whole message fails and the customer
 * gets nothing — so clamp below that with headroom rather than risk the send.
 */
export const WHATSAPP_MAX_OUTBOUND_BODY_CHARS = 1500;

/**
 * OpenRouter model slug for the WhatsApp assistant. Overridable via the
 * `WHATSAPP_MODEL` env var; shares `OPENROUTER_API_KEY` with menu import. A
 * cheap default keeps per-message cost low (set e.g. "anthropic/claude-3.5-haiku"
 * to prefer Claude).
 */
export const WHATSAPP_DEFAULT_MODEL = "openai/gpt-4o-mini";

/** How many recent messages are replayed to the model as conversation context. */
export const WHATSAPP_CONTEXT_MESSAGE_LIMIT = 12;

/** Upper bound on tool-calling steps per turn (cost + latency guardrail). */
export const WHATSAPP_MAX_LLM_STEPS = 5;

/** Kinds of destructive action that require an out-of-band confirmation code. */
export const WHATSAPP_PENDING_ACTION = {
	CANCEL_RESERVATION: "cancel_reservation",
} as const;

export type WhatsappPendingAction =
	(typeof WHATSAPP_PENDING_ACTION)[keyof typeof WHATSAPP_PENDING_ACTION];

/**
 * How long a cancellation code stays redeemable. Long enough for a customer to
 * read the message and reply, short enough that a stale code left in a chat does
 * not stay live.
 */
export const WHATSAPP_PENDING_ACTION_TTL_MS = 10 * 60 * 1000;

/**
 * Digits in a confirmation code. The security property is unguessability by
 * *injected text*, which cannot see the code at all — brute force is not the
 * threat model, since a code is single-use, expiring, and scoped to one
 * conversation and phone. Six digits keeps it easy to retype on a phone.
 */
export const WHATSAPP_CONFIRMATION_CODE_DIGITS = 6;

/**
 * Writes the assistant may perform in a single turn.
 *
 * `WHATSAPP_MAX_LLM_STEPS` is NOT a write budget: one step can contain many
 * parallel tool calls, so without this an injected loop could book or cancel
 * repeatedly inside one message.
 */
export const WHATSAPP_MAX_WRITES_PER_TURN = 1;

/** Assistant-driven reservation writes allowed per phone per hour. */
export const WHATSAPP_WRITE_RATE_LIMIT = { windowMs: 60 * 60 * 1000, max: 8 } as const;

/** Supported reply locales for the bot. */
export const WHATSAPP_LOCALE = {
	EN: "en",
	ES: "es",
} as const;

export type WhatsappLocale = (typeof WHATSAPP_LOCALE)[keyof typeof WHATSAPP_LOCALE];
/**
 * Longest public restaurant slug we will store. The slug is derived from the
 * restaurant name (see `convex/slugHelpers.ts`), and names can be arbitrarily
 * long, so the derivation caps them: 60 characters keeps `/r/<slug>/en/menu`
 * readable in a QR-code target and inside export filenames without truncating
 * any realistic restaurant name.
 */
export const RESTAURANT_SLUG_MAX_LENGTH = 60;

/**
 * Base used when a name yields nothing slug-able (all emoji / CJK / punctuation).
 * Deliberately a plain word rather than a random string: the collision counter
 * then produces `restaurant`, `restaurant-2`, … which is guessable and easy to
 * rename, instead of an opaque hash the operator would have to copy.
 */
export const RESTAURANT_SLUG_FALLBACK_BASE = "restaurant";

/**
 * How many `-2`, `-3`, … candidates the create mutation tries before giving up.
 * Bounds the loop so a pathological data set cannot spin a mutation forever;
 * 50 same-named live restaurants in one deployment is already implausible.
 */
export const RESTAURANT_SLUG_MAX_COLLISION_ATTEMPTS = 50;

/**
 * Restaurant hard-purge coverage (TAVLI-66).
 *
 * Every table holding restaurant-scoped rows must appear in exactly one of the
 * three lists below. `restaurantPurgeCoverage.test.ts` introspects `schema.ts`
 * and fails when a table carrying a `restaurantId` field (or any
 * `v.id("restaurants")` reference) is missing from all of them — so adding a
 * restaurant-scoped table without deciding its purge behavior is a red build,
 * not silent drift. (`stripeDisputes` was orphaned for months exactly this way:
 * added after the purge was written, nothing failed.)
 *
 * `restaurantPurge.hardDeleteRestaurantDataTyped` types its per-table deletion
 * counters as `Record<RestaurantPurgeDeletedTable, number>`, so a table added
 * here without matching cascade code fails to typecheck.
 */
export const RESTAURANT_PURGE_DELETED_TABLES = [
	// Membership & staff
	TABLE.RESTAURANT_MEMBERS,
	TABLE.EMPLOYEE_ACCOUNTS,
	// Menu tree
	TABLE.MENUS,
	TABLE.MENU_CATEGORIES,
	TABLE.MENU_ITEMS,
	TABLE.OPTION_GROUPS,
	TABLE.OPTIONS,
	TABLE.MENU_ITEM_OPTION_GROUPS,
	// Floor plan
	TABLE.TABLES,
	TABLE.SECTIONS,
	// Dining & ordering
	TABLE.SESSIONS,
	TABLE.ORDERS,
	TABLE.ORDER_ITEMS,
	TABLE.ORDER_DAY_COUNTERS,
	TABLE.SUBSTITUTION_PROPOSALS,
	// Payments
	TABLE.PAYMENTS,
	TABLE.STRIPE_WEBHOOK_EVENTS,
	TABLE.STRIPE_DISPUTES,
	// Reservations
	TABLE.RESERVATIONS,
	TABLE.TABLE_LOCKS,
	TABLE.RESERVATION_SETTINGS,
	// Scheduling & attendance
	TABLE.SHIFTS,
	TABLE.SHIFT_TEMPLATES,
	TABLE.SHIFT_TABLE_ASSIGNMENTS,
	TABLE.SHIFT_SECTION_ASSIGNMENTS,
	TABLE.SHIFT_ATTENDANCE,
	TABLE.CLOCK_EVENTS,
	TABLE.ABSENCES,
	// Tips
	TABLE.TIP_POOLS,
	TABLE.TIP_POOL_SHARES,
	TABLE.TIP_ENTRIES,
	// Dashboards
	TABLE.DASHBOARD_LAYOUTS,
	TABLE.DASHBOARD_TEMPLATES,
	// WhatsApp assistant (ADR 010/011) — customer phone numbers and message
	// bodies, so a purged restaurant must not leave them behind.
	TABLE.WHATSAPP_CHANNELS,
	TABLE.WHATSAPP_CONVERSATIONS,
	TABLE.WHATSAPP_MESSAGES,
	TABLE.WHATSAPP_PENDING_ACTIONS,
] as const;

export type RestaurantPurgeDeletedTable = (typeof RESTAURANT_PURGE_DELETED_TABLES)[number];

/**
 * Tables the purge patches instead of deleting — their rows can span several
 * restaurants, so only references to the purged restaurant are removed:
 * - `invitations`: the `restaurantIds` array may cover other restaurants; the
 *   purged id is filtered out and the invitation revoked only when none remain.
 * - `userRoles`: org-scoped — a user's roles outlive any one restaurant, so
 *   rows are never deleted. The single restaurant reference is the legacy
 *   dev-role-switcher array `devSavedMembershipRoles`; entries pointing at the
 *   purged restaurant are scrubbed.
 */
export const RESTAURANT_PURGE_PATCHED_TABLES = [TABLE.INVITATIONS, TABLE.USER_ROLES] as const;

export type RestaurantPurgePatchedTable = (typeof RESTAURANT_PURGE_PATCHED_TABLES)[number];

/**
 * Restaurant-linked tables the purge intentionally leaves untouched, keyed by
 * table name with the reason. Add entries deliberately — never to silence the
 * coverage test.
 */
export const RESTAURANT_PURGE_EXEMPT_TABLES: Partial<Record<TableName, string>> = {
	[TABLE.ALL_EVENTS]:
		"Append-only audit trail. Carries an indexed `restaurantId` for querying a " +
		"restaurant's history, but events must survive the purge — they are the only " +
		"remaining record of it. The id is deliberately left dangling afterwards.",
	[TABLE.RATE_LIMITS]:
		"Fixed-window abuse counters whose string keys may embed restaurant ids. " +
		"Rows are ephemeral and expire with their window; not worth a scan to purge.",
};
