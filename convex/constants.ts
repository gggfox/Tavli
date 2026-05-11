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
	SESSIONS: "sessions",
	ORDERS: "orders",
	ORDER_ITEMS: "orderItems",
	PAYMENTS: "payments",
	STRIPE_WEBHOOK_EVENTS: "stripeWebhookEvents",
	RESERVATIONS: "reservations",
	TABLE_LOCKS: "tableLocks",
	RESERVATION_SETTINGS: "reservationSettings",
	ORDER_DAY_COUNTERS: "orderDayCounters",
	RESTAURANT_MEMBERS: "restaurantMembers",
	INVITATIONS: "invitations",
	SHIFTS: "shifts",
	SHIFT_TEMPLATES: "shiftTemplates",
	SHIFT_TABLE_ASSIGNMENTS: "shiftTableAssignments",
	CLOCK_EVENTS: "clockEvents",
	ABSENCES: "absences",
	SHIFT_ATTENDANCE: "shiftAttendance",
	TIP_POOLS: "tipPools",
	TIP_POOL_SHARES: "tipPoolShares",
	TIP_ENTRIES: "tipEntries",
	DASHBOARD_LAYOUTS: "dashboardLayouts",
	DASHBOARD_TEMPLATES: "dashboardTemplates",
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
	SUCCEEDED: "succeeded",
	FAILED: "failed",
} as const;

export type PaymentRefundStatus =
	(typeof PAYMENT_REFUND_STATUS)[keyof typeof PAYMENT_REFUND_STATUS];

export const SESSION_STATUS = {
	ACTIVE: "active",
	CLOSED: "closed",
} as const;

export type SessionStatus = (typeof SESSION_STATUS)[keyof typeof SESSION_STATUS];

export const SELECTION_TYPE = {
	SINGLE: "single",
	MULTI: "multi",
} as const;

export type SelectionType = (typeof SELECTION_TYPE)[keyof typeof SELECTION_TYPE];

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

/** System actor for migrations and webhooks when no Clerk user applies. */
export const AUDIT_SYSTEM_USER_ID = "system";

/** Soft-deleted restaurants become eligible for hard delete after this interval. */
export const RESTAURANT_SOFT_DELETE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
