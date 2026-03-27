import { Doc, Id } from "./_generated/dataModel";

export const TABLE = {
	ALL_EVENTS: "allEvents",
	USER_SETTINGS: "userSettings",
	USER_ROLES: "userRoles",
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
} as const;

export type TableName = (typeof TABLE)[keyof typeof TABLE];

export type UserSettingsId = Id<typeof TABLE.USER_SETTINGS>;
export type UserRoleDoc = Doc<typeof TABLE.USER_ROLES>;
export type UserSettingsDoc = Doc<typeof TABLE.USER_SETTINGS>;

export const USER_ROLES = {
	ADMIN: "admin",
	SELLER: "seller",
	BUYER: "buyer",
	OWNER: "owner",
	STAFF: "staff",
} as const;

export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];

export const ORDER_STATUS = {
	DRAFT: "draft",
	SUBMITTED: "submitted",
	PREPARING: "preparing",
	READY: "ready",
	SERVED: "served",
	PAID: "paid",
	CANCELLED: "cancelled",
} as const;

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

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
