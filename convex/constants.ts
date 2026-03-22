import { Doc, Id } from "./_generated/dataModel";

export const TABLE = {
	ALL_EVENTS: "allEvents",
	TASKS: "tasks",
	AUCTIONS: "auctions",
	MATERIALS: "materials",
	BIDS: "bids",
	CATEGORIES: "categories",
	FORMS: "forms",
	FINISHES: "finishes",
	CHOICES: "choices",
	USER_SETTINGS: "userSettings",
	USER_ROLES: "userRoles",
	FEATURE_FLAGS: "featureFlags",
} as const;

// Type helpers for table names
export type TableName = (typeof TABLE)[keyof typeof TABLE];

// Convenience type aliases for commonly used table IDs
export type AuctionId = Id<typeof TABLE.AUCTIONS>;
export type MaterialId = Id<typeof TABLE.MATERIALS>;
export type BidId = Id<typeof TABLE.BIDS>;
export type TaskId = Id<typeof TABLE.TASKS>;
export type UserSettingsId = Id<typeof TABLE.USER_SETTINGS>;
export type CategoryId = Id<typeof TABLE.CATEGORIES>;
export type FormId = Id<typeof TABLE.FORMS>;
export type FinishId = Id<typeof TABLE.FINISHES>;
export type ChoiceId = Id<typeof TABLE.CHOICES>;

// Convenience type aliases for commonly used table Docs
export type AuctionDoc = Doc<typeof TABLE.AUCTIONS>;
export type MaterialDoc = Doc<typeof TABLE.MATERIALS>;
export type BidDoc = Doc<typeof TABLE.BIDS>;
export type UserRoleDoc = Doc<typeof TABLE.USER_ROLES>;
export type TaskDoc = Doc<typeof TABLE.TASKS>;
export type UserSettingsDoc = Doc<typeof TABLE.USER_SETTINGS>;

export const EVENT_TYPES = {
	AUCTION_CREATED: "auction_created",
	AUCTION_STARTED: "auction_started",
	AUCTION_FINISHED: "auction_finished",
} as const;

export const USER_ROLES = {
	ADMIN: "admin",
	SELLER: "seller",
	BUYER: "buyer",
} as const;

export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

// Auction states (also defined in src/features/auctions/server/types.ts for frontend use)
export const AUCTION_STATES = {
	UPCOMING: "upcoming",
	LIVE: "live",
	FINISHED: "finished",
	CANCELLED: "cancelled",
} as const;

export type AuctionState = (typeof AUCTION_STATES)[keyof typeof AUCTION_STATES];
