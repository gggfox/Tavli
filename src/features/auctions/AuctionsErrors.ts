/**
 * AuctionsErrors - Domain error types for auctions
 *
 * These error classes represent domain-level errors that can occur
 * during auction operations. They are used for type-safe error handling.
 */

// ============================================================================
// Base Error
// ============================================================================

export class AuctionsError extends Error {
	constructor(readonly data: { message: string }) {
		super(data.message);
		this.name = "AuctionsError";
	}
}

// ============================================================================
// Validation Error Type
// ============================================================================

export class AuctionsValidationError {
	readonly _tag = "AuctionsValidationError";
	constructor(
		readonly operation: string,
		readonly errors: z.ZodError
	) {}
}

// ============================================================================
// Domain Errors
// ============================================================================

export class NotFoundError extends Error {
	readonly _tag = "NotFoundError" as const;
	constructor(readonly data: { entity: "auction" | "material" | "bid"; id: string }) {
		super(`${data.entity} not found: ${data.id}`);
		this.name = "NotFoundError";
	}
}

export class UnauthorizedError extends Error {
	readonly _tag = "UnauthorizedError" as const;
	constructor(
		readonly data: {
			action: string;
			requiredRole: "admin" | "seller" | "buyer";
		}
	) {
		super(`Unauthorized: ${data.action} requires ${data.requiredRole} role`);
		this.name = "UnauthorizedError";
	}
}

export class ValidationError extends Error {
	readonly _tag = "ValidationError" as const;
	constructor(readonly data: { field: string; message: string }) {
		super(`Validation error: ${data.field} - ${data.message}`);
		this.name = "ValidationError";
	}
}

export class RateLimitedError extends Error {
	readonly _tag = "RateLimitedError" as const;
	constructor(readonly data: { retryAfterMs: number; action: string }) {
		super(`Rate limited: ${data.action}, retry after ${data.retryAfterMs}ms`);
		this.name = "RateLimitedError";
	}
}

export class BidConflictError extends Error {
	readonly _tag = "BidConflictError" as const;
	constructor(
		readonly data: {
			expectedSequence: number;
			actualSequence: number;
		}
	) {
		super(
			`Bid conflict: expected sequence ${data.expectedSequence}, current is ${data.actualSequence}`
		);
		this.name = "BidConflictError";
	}
}

export class AuctionNotLiveError extends Error {
	readonly _tag = "AuctionNotLiveError" as const;
	constructor(readonly data: { auctionId: string; status: string }) {
		super(`Auction not live: ${data.auctionId} (status: ${data.status})`);
		this.name = "AuctionNotLiveError";
	}
}

export class BidTooLowError extends Error {
	readonly _tag = "BidTooLowError" as const;
	constructor(
		readonly data: {
			currentHighest: number;
			attempted: number;
			currency: string;
		}
	) {
		super(
			`Bid too low: attempted ${data.attempted} ${data.currency}, current highest is ${data.currentHighest} ${data.currency}`
		);
		this.name = "BidTooLowError";
	}
}

export class MaterialNotApprovedError extends Error {
	readonly _tag = "MaterialNotApprovedError" as const;
	constructor(readonly data: { materialId: string; status: string }) {
		super(`Material not approved: ${data.materialId} (status: ${data.status})`);
		this.name = "MaterialNotApprovedError";
	}
}

// ============================================================================
// Union Type
// ============================================================================

export type AuctionsDomainError =
	| NotFoundError
	| UnauthorizedError
	| ValidationError
	| RateLimitedError
	| BidConflictError
	| AuctionNotLiveError
	| BidTooLowError
	| MaterialNotApprovedError
	| AuctionsError;
