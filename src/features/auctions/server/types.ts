export const AUCTION_STATES = {
	UPCOMING: "upcoming",
	LIVE: "live",
	FINISHED: "finished",
	CANCELLED: "cancelled",
} as const;

export type AuctionState = (typeof AUCTION_STATES)[keyof typeof AUCTION_STATES];

export const AUCTION_EVENT_TYPES = {
	AUCTION_CREATED: "auction_created",
	AUCTION_STARTED: "auction_started",
	AUCTION_FINISHED: "auction_finished",
	AUCTION_CANCELLED: "auction_cancelled",
} as const;
