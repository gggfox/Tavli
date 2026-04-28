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

export const ORDER_STATUS = {
	DRAFT: "draft",
	SUBMITTED: "submitted",
	PREPARING: "preparing",
	READY: "ready",
	SERVED: "served",
	CANCELLED: "cancelled",
} as const;

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

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
