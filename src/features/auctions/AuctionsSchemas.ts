/**
 * AuctionsSchemas - Zod validation for auction operations
 *
 * Provides runtime validation for auction, material, and bid inputs
 * using Zod. These schemas validate data before it's sent to Convex mutations.
 */
import { z } from "zod";

// ============================================================================
// Validation Constants
// ============================================================================

export const VALIDATION_LIMITS = {
	// Auction
	AUCTION_TITLE_MAX_LENGTH: 200,

	// Material
	MATERIAL_WEIGHT_MIN: 0.001, // 1 kg minimum
	MATERIAL_WEIGHT_MAX: 100000, // 100k tonnes maximum
	REJECTION_REASON_MAX_LENGTH: 500,

	// Bid
	BID_AMOUNT_MIN: 0.01, // 1 cent minimum
	BID_AMOUNT_MAX: 1000000, // 1M per unit maximum
} as const;

// Supported currencies
export const SUPPORTED_CURRENCIES = ["MXN", "USD", "EUR"] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

// Auction frequencies
export const AUCTION_FREQUENCIES = ["weekly", "biweekly", "monthly", "custom"] as const;
export type AuctionFrequency = (typeof AUCTION_FREQUENCIES)[number];

// ============================================================================
// Auction Schemas
// ============================================================================

/**
 * Schema for creating a new auction.
 */
export const CreateAuctionInputSchema = z
	.object({
		title: z
			.string()
			.max(VALIDATION_LIMITS.AUCTION_TITLE_MAX_LENGTH, {
				message: `Auction title cannot exceed ${VALIDATION_LIMITS.AUCTION_TITLE_MAX_LENGTH} characters`,
			})
			.optional(),
		startDate: z.number().refine((val) => val > Date.now() - 86400000, {
			message: "Start date cannot be more than 1 day in the past",
		}),
		endDate: z.number(),
		idempotencyKey: z.string().optional(),
	})
	.refine((data) => data.endDate > data.startDate, {
		message: "End date must be after start date",
		path: ["endDate"],
	});

export type CreateAuctionInput = z.infer<typeof CreateAuctionInputSchema>;

/**
 * Schema for auction ID validation.
 */
export const AuctionIdSchema = z.string().min(1, "Auction ID cannot be empty");

// ============================================================================
// Material Schemas
// ============================================================================

/**
 * Schema for normalized quantity.
 */
export const NormalizedQuantitySchema = z.object({
	quantity: z
		.number()
		.gt(0, "Quantity must be greater than 0")
		.lte(VALIDATION_LIMITS.MATERIAL_WEIGHT_MAX, {
			message: `Quantity cannot exceed ${VALIDATION_LIMITS.MATERIAL_WEIGHT_MAX}`,
		}),
	unit: z.string().min(1, "Unit is required"),
	baseUnit: z.string().min(1, "Base unit is required"),
	baseQuantity: z.number().gt(0, "Base quantity must be greater than 0"),
});

export type NormalizedQuantity = z.infer<typeof NormalizedQuantitySchema>;

/**
 * Schema for creating a new material.
 */
export const CreateMaterialInputSchema = z.object({
	categoryIds: z.array(z.string()).min(1, "At least one category is required"),
	formIds: z.array(z.string()).optional(),
	finishIds: z.array(z.string()).optional(),
	choiceIds: z.array(z.string()).optional(),
	normalizedQuantity: NormalizedQuantitySchema,
	attributes: z.unknown().optional(),
	location: z
		.string()
		.min(1, "Location is required")
		.trim()
		.refine((val) => val.length > 0, "Location cannot be only whitespace"),
	idempotencyKey: z.string().optional(),
});

export type CreateMaterialInput = z.infer<typeof CreateMaterialInputSchema>;

/**
 * Schema for material ID validation.
 */
export const MaterialIdSchema = z.string().min(1, "Material ID cannot be empty");

/**
 * Schema for rejecting a material.
 */
export const RejectMaterialInputSchema = z.object({
	materialId: MaterialIdSchema,
	rejectionReason: z
		.string()
		.min(1, "Rejection reason is required")
		.max(VALIDATION_LIMITS.REJECTION_REASON_MAX_LENGTH, {
			message: `Rejection reason cannot exceed ${VALIDATION_LIMITS.REJECTION_REASON_MAX_LENGTH} characters`,
		})
		.trim()
		.refine((val) => val.length > 0, "Rejection reason cannot be only whitespace"),
	idempotencyKey: z.string().optional(),
});

export type RejectMaterialInput = z.infer<typeof RejectMaterialInputSchema>;

// ============================================================================
// Bid Schemas
// ============================================================================

/**
 * Schema for placing a bid.
 *
 * Note: bidderId is NOT included because it's determined server-side
 * from the authenticated user session (identity.subject).
 */
export const PlaceBidInputSchema = z.object({
	auctionId: z.string().min(1, "Auction ID is required"),
	materialId: z.string().min(1, "Material ID is required"),
	amount: z
		.number()
		.gt(0, "Bid amount must be greater than 0")
		.lte(VALIDATION_LIMITS.BID_AMOUNT_MAX, {
			message: `Bid amount cannot exceed ${VALIDATION_LIMITS.BID_AMOUNT_MAX}`,
		}),
	currency: z
		.string()
		.min(1, "Currency is required")
		.regex(/^(MXN|USD|EUR)$/, "Currency must be MXN, USD, or EUR"),
	expectedSequence: z.number().gte(0, "Expected sequence must be non-negative"),
	idempotencyKey: z.string().optional(),
});

export type PlaceBidInput = z.infer<typeof PlaceBidInputSchema>;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create an idempotency key for bid placement.
 * Format: bid-{auctionId}-{materialId}-{timestamp}-{random}
 */
export function createBidIdempotencyKey(auctionId: string, materialId: string): string {
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).substring(2, 8);
	return `bid-${auctionId}-${materialId}-${timestamp}-${random}`;
}

/**
 * Create an idempotency key for generic operations.
 */
export function createIdempotencyKey(prefix: string): string {
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).substring(2, 8);
	return `${prefix}-${timestamp}-${random}`;
}
