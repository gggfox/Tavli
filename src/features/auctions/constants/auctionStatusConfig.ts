/**
 * Auction status configuration constants
 */

export type AuctionStatus = "live" | "scheduled" | "draft" | "closed" | "cancelled";

export interface AuctionStatusConfig {
	bgColor: string;
	textColor: string;
}

export const auctionStatusConfig: Record<AuctionStatus, AuctionStatusConfig> = {
	live: {
		bgColor: "rgba(34, 197, 94, 0.15)",
		textColor: "rgb(34, 197, 94)",
	},
	scheduled: {
		bgColor: "rgba(59, 130, 246, 0.15)",
		textColor: "rgb(59, 130, 246)",
	},
	draft: {
		bgColor: "rgba(156, 163, 175, 0.15)",
		textColor: "rgb(156, 163, 175)",
	},
	closed: {
		bgColor: "rgba(107, 114, 128, 0.15)",
		textColor: "rgb(107, 114, 128)",
	},
	cancelled: {
		bgColor: "rgba(239, 68, 68, 0.15)",
		textColor: "rgb(239, 68, 68)",
	},
};

/**
 * Default fallback configuration for unknown auction statuses
 */
export const defaultAuctionStatusConfig: AuctionStatusConfig = {
	bgColor: "rgba(156, 163, 175, 0.15)",
	textColor: "rgb(156, 163, 175)",
};

/**
 * Get auction status configuration
 */
export function getAuctionStatusConfig(status: string): AuctionStatusConfig {
	return auctionStatusConfig[status as AuctionStatus] ?? defaultAuctionStatusConfig;
}
