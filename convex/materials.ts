/**
 * Material mutations and queries.
 * Implements event sourcing + CQRS pattern for material management.
 *
 * Features:
 * - Material creation by sellers
 * - Admin approval workflow
 * - Full-text search via searchableText field
 * - Junction table management for categories, forms, finishes, choices
 */
import {
	NotAuthenticatedErrorObject,
	NotAuthorizedErrorObject,
	UserInputValidationError,
	UserInputValidationErrorObject,
} from "@/global/types/errors";
import { AsyncReturn } from "@/global/types/types";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUserId, requireSellerRole } from "./_util/auth";
import { TABLE } from "./constants";

// ============================================================================
// Reference Data Queries
// ============================================================================

/**
 * Get all categories, grouped by groupTitle.
 */
export const getCategories = query({
	handler: async (ctx) => {
		return await ctx.db.query("categories").collect();
	},
});

/**
 * Get all forms.
 */
export const getForms = query({
	handler: async (ctx) => {
		return await ctx.db.query("forms").collect();
	},
});

/**
 * Get all finishes.
 */
export const getFinishes = query({
	handler: async (ctx) => {
		return await ctx.db.query("finishes").collect();
	},
});

/**
 * Get all choices.
 */
export const getChoices = query({
	handler: async (ctx) => {
		return await ctx.db.query("choices").collect();
	},
});

// // ============================================================================
// // Material Queries
// // ============================================================================

// /**
//  * Get a single material by ID.
//  */
// export const getMaterial = query({
// 	args: { materialId: v.id("materialAggregates") },
// 	handler: async (ctx, args) => {
// 		return await ctx.db.get(args.materialId);
// 	},
// });

// /**
//  * Get a material by its human-readable materialId.
//  */
// export const getMaterialByMaterialId = query({
// 	args: { materialId: v.string() },
// 	handler: async (ctx, args) => {
// 		return await ctx.db
// 			.query(TABLE.MATERIALS)
// 			.withIndex("by_material", (q) => q.eq("materialId", args.materialId))
// 			.first();
// 	},
// });

/**
 * Get materials by status.
 */
export const getMaterialsByStatus = query({
	args: {
		status: v.union(
			v.literal("pending"),
			v.literal("approved"),
			v.literal("rejected"),
			v.literal("archived")
		),
	},
	handler: async (ctx, args) => {
		return await ctx.db
			.query(TABLE.MATERIALS)
			.withIndex("by_status", (q) => q.eq("status", args.status))
			.collect();
	},
});

/**
 * Get materials for the current seller.
 */
export const getSellerMaterials = query({
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return [];
		}

		return await ctx.db
			.query(TABLE.MATERIALS)
			.withIndex("by_seller", (q) => q.eq("sellerId", identity.subject))
			.order("desc")
			.collect();
	},
});

// /**
//  * Get pending materials for the current seller.
//  */
// export const getSellerPendingMaterials = query({
// 	handler: async (ctx) => {
// 		const identity = await ctx.auth.getUserIdentity();
// 		if (!identity) {
// 			return [];
// 		}

// 		const allMaterials = await ctx.db
// 			.query(TABLE.MATERIALS)
// 			.withIndex("by_seller", (q) => q.eq("sellerId", identity.subject))
// 			.order("desc")
// 			.collect();

// 		// Filter to only show pending materials
// 		return allMaterials.filter((m) => m.status === "pending");
// 	},
// });

// /**
//  * Get approved materials for an auction.
//  */
// export const getAuctionMaterials = query({
// 	args: { auctionId: v.id(TABLE.AUCTIONS) },
// 	handler: async (ctx, args) => {
// 		// Get active material associations for this auction
// 		const associations = await ctx.db
// 			.query(TABLE.MATERIALS)
// 			.withIndex("by_active_auction", (q) => q.eq("auctionId", args.auctionId).eq("isActive", true))
// 			.collect();

// 		// Fetch material aggregates (only approved)
// 		const materials = await Promise.all(
// 			associations.map(async (assoc) => {
// 				const material = await ctx.db
// 					.query(TABLE.MATERIALS)
// 					.withIndex("by_material", (q) => q.eq("materialId", assoc.materialId))
// 					.first();
// 				return material?.status === "approved" ? material : null;
// 			})
// 		);

// 		return materials.filter(Boolean);
// 	},
// });

/**
 * Get all materials from the live auction.
 * Returns materials with their associated auction information, choices, forms, finishes, and bids.
 *
 * Note: Currently returns empty materials array as auction-material associations
 * are not yet implemented in the schema. This stub allows the frontend to work
 * without errors while the feature is being developed.
 */
export const getLiveAuctionMaterials = query({
	handler: async (ctx) => {
		// Get the live auction (there should only be one)
		const liveAuction = await ctx.db
			.query(TABLE.AUCTIONS)
			.withIndex("by_status", (q) => q.eq("status", "live"))
			.first();

		// If no live auction, return null auction with empty materials
		if (!liveAuction) {
			return {
				auction: null,
				materials: [],
			};
		}

		// Return auction info with empty materials
		// TODO: Implement auction-material associations to populate materials
		return {
			auction: {
				_id: liveAuction._id,
				title: liveAuction.title,
				startDate: liveAuction.startDate,
				endDate: liveAuction.endDate,
			},
			materials: [] as Array<{
				material: {
					_id: string;
					materialId: string;
					normalizedQuantity: {
						quantity: number;
						unit: string;
						baseUnit: string;
						baseQuantity: number;
					};
					location: string;
					sellerId: string;
					status: string;
				};
				choices: string[];
				forms: string[];
				finishes: string[];
				highestBid: {
					amount: number;
					bidderId: string;
					totalBids: number;
					currentSequence: number;
				} | null;
			}>,
		};
	},
});

// ============================================================================
// Material Mutations
// ============================================================================

/**
 * Generate a unique material ID.
 */
function generateMaterialId(): string {
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).substring(2, 8);
	return `MAT-${timestamp}-${random}`.toUpperCase();
}

/**
 * Generate searchable text from material data.
 */
function generateSearchableText(
	location: string,
	categoryNames: string[],
	formNames: string[],
	finishNames: string[],
	choiceNames: string[]
): string {
	const parts = [location, ...categoryNames, ...formNames, ...finishNames, ...choiceNames].filter(
		Boolean
	);
	return parts.join(" ").toLowerCase();
}

type CreateMaterialErrors =
	| NotAuthenticatedErrorObject
	| NotAuthorizedErrorObject
	| UserInputValidationErrorObject;

/**
 * Create a new material (seller only).
 * Materials are created in "pending" status and require admin approval.
 */
export const createMaterial = mutation({
	args: {
		categoryIds: v.array(v.id("categories")),
		formIds: v.optional(v.array(v.id("forms"))),
		finishIds: v.optional(v.array(v.id("finishes"))),
		choiceIds: v.optional(v.array(v.id("choices"))),
		normalizedQuantity: v.object({
			quantity: v.number(),
			unit: v.string(),
			baseUnit: v.string(),
			baseQuantity: v.number(),
		}),
		location: v.string(),
	},
	handler: async function (ctx, args): AsyncReturn<string, CreateMaterialErrors> {
		// Authenticate user
		const [userId, authError] = await getCurrentUserId(ctx);
		if (authError) {
			return [null, authError];
		}

		// Check seller role
		const [, roleError] = await requireSellerRole(ctx, userId);
		if (roleError) {
			return [null, roleError];
		}

		// Validation
		if (args.categoryIds.length === 0) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "categoryIds", message: "At least one category is required" }],
				}).toObject(),
			];
		}

		if (args.normalizedQuantity.quantity <= 0) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "quantity", message: "Quantity must be greater than 0" }],
				}).toObject(),
			];
		}

		if (!args.location.trim()) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "location", message: "Location is required" }],
				}).toObject(),
			];
		}

		// Fetch category, form, finish, and choice names for searchable text
		const categories = await Promise.all(args.categoryIds.map((id) => ctx.db.get(id)));
		const forms = args.formIds ? await Promise.all(args.formIds.map((id) => ctx.db.get(id))) : [];
		const finishes = args.finishIds
			? await Promise.all(args.finishIds.map((id) => ctx.db.get(id)))
			: [];
		const choices = args.choiceIds
			? await Promise.all(args.choiceIds.map((id) => ctx.db.get(id)))
			: [];

		const categoryNames = categories.filter(Boolean).map((c) => c!.name);
		const formNames = forms.filter(Boolean).map((f) => f!.name);
		const finishNames = finishes.filter(Boolean).map((f) => f!.name);
		const choiceNames = choices.filter(Boolean).map((c) => c!.name);

		const materialId = generateMaterialId();
		const now = Date.now();

		// Generate searchable text
		const searchableText = generateSearchableText(
			args.location,
			categoryNames,
			formNames,
			finishNames,
			choiceNames
		);

		// Create material aggregate
		await ctx.db.insert(TABLE.MATERIALS, {
			materialId,
			normalizedQuantity: args.normalizedQuantity,
			location: args.location.trim(),
			sellerId: userId,
			searchableText,
			status: "pending",
			createdAt: now,
			lastEventId: materialId, // Use materialId as initial event ID
			lastUpdated: now,
		});

		// Populate junction tables in parallel
		await Promise.all([
			...args.categoryIds.map((categoryId) =>
				ctx.db.insert("materialCategories", { materialId, categoryId, createdAt: now })
			),
			...(args.formIds ?? []).map((formId) =>
				ctx.db.insert("materialForms", { materialId, formId, createdAt: now })
			),
			...(args.finishIds ?? []).map((finishId) =>
				ctx.db.insert("materialFinishes", { materialId, finishId, createdAt: now })
			),
			...(args.choiceIds ?? []).map((choiceId) =>
				ctx.db.insert("materialChoices", { materialId, choiceId, createdAt: now })
			),
		]);

		return [materialId, null];
	},
});

type AddMaterialToLiveAuctionErrors =
	| NotAuthenticatedErrorObject
	| NotAuthorizedErrorObject
	| UserInputValidationErrorObject;

/**
 * Add a material to the current live auction (admin or seller only).
 * Convenience function that automatically finds the live auction.
 */
export const addMaterialToLiveAuction = mutation({
	args: {
		materialId: v.string(),
	},
	handler: async function (ctx, args): AsyncReturn<string, AddMaterialToLiveAuctionErrors> {
		// Authenticate user
		const [userId, authError] = await getCurrentUserId(ctx);
		if (authError) {
			return [null, authError];
		}

		// Check seller role (admins also pass this check)
		const [, roleError] = await requireSellerRole(ctx, userId);
		if (roleError) {
			return [null, roleError];
		}

		// Find the live auction
		const liveAuction = await ctx.db
			.query(TABLE.AUCTIONS)
			.withIndex("by_status", (q) => q.eq("status", "live"))
			.first();

		if (!liveAuction) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "auction", message: "No live auction found" }],
				}).toObject(),
			];
		}

		// Check material exists
		const material = await ctx.db
			.query(TABLE.MATERIALS)
			.withIndex("by_material", (q) => q.eq("materialId", args.materialId))
			.first();

		if (!material) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "materialId", message: "Material not found" }],
				}).toObject(),
			];
		}

		if (material.status !== "approved") {
			return [
				null,
				new UserInputValidationError({
					fields: [
						{ field: "materialId", message: "Only approved materials can be added to auctions" },
					],
				}).toObject(),
			];
		}

		// For now, just return success - the actual auction-material association
		// would be implemented when the schema supports it
		// TODO: Implement actual auction-material association when schema is ready
		return [args.materialId, null];
	},
});

// /**
//  * Search materials by text.
//  */
// export const searchMaterials = query({
// 	args: {
// 		searchText: v.string(),
// 		limit: v.optional(v.number()),
// 	},
// 	handler: async (ctx, args) => {
// 		if (!args.searchText.trim()) {
// 			return [];
// 		}

// 		return await ctx.db
// 			.query(TABLE.MATERIALS)
// 			.withSearchIndex("by_searchable_text", (q) => q.search("searchableText", args.searchText))
// 			.take(args.limit ?? 20);
// 	},
// });

// /**
//  * Get pending materials for admin approval queue.
//  */
// export const getPendingMaterials = query({
// 	handler: async (ctx) => {
// 		return await ctx.db
// 			.query(TABLE.MATERIALS)
// 			.withIndex("by_status", (q) => q.eq("status", "pending"))
// 			.order("asc") // Oldest first (FIFO)
// 			.collect();
// 	},
// });

// /**
//  * Get material events for audit trail.
//  */
// export const getMaterialEvents = query({
// 	args: { materialId: v.string() },
// 	handler: async (ctx, args) => {
// 		return await ctx.db
// 			.query(TABLE.MATERIALS)
// 			.withIndex("by_material", (q) => q.eq("materialId", args.materialId))
// 			.order("asc")
// 			.collect();
// 	},
// });

// /**
//  * Get categories for a material.
//  */
// export const getMaterialCategories = query({
// 	args: { materialId: v.string() },
// 	handler: async (ctx, args) => {
// 		const junctions = await ctx.db
// 			.query(TABLE.MATERIALS)
// 			.withIndex("by_material", (q) => q.eq("materialId", args.materialId))
// 			.collect();

// 		const categories = await Promise.all(junctions.map((j) => ctx.db.get(j.categoryId)));

// 		return categories.filter(Boolean);
// 	},
// });

// /**
//  * Get forms for a material.
//  */
// export const getMaterialForms = query({
// 	args: { materialId: v.string() },
// 	handler: async (ctx, args) => {
// 		const junctions = await ctx.db
// 			.query(TABLE.MATERIALS)
// 			.withIndex("by_material", (q) => q.eq("materialId", args.materialId))
// 			.collect();

// 		const forms = await Promise.all(junctions.map((j) => ctx.db.get(j.formId)));

// 		return forms.filter(Boolean);
// 	},
// });

// /**
//  * Get finishes for a material.
//  */
// export const getMaterialFinishes = query({
// 	args: { materialId: v.string() },
// 	handler: async (ctx, args) => {
// 		const junctions = await ctx.db
// 			.query(TABLE.MATERIALS)
// 			.withIndex("by_material", (q) => q.eq("materialId", args.materialId))
// 			.collect();

// 		const finishes = await Promise.all(junctions.map((j) => ctx.db.get(j.finishId)));

// 		return finishes.filter(Boolean);
// 	},
// });

// /**
//  * Get choices for a material.
//  */
// export const getMaterialChoices = query({
// 	args: { materialId: v.string() },
// 	handler: async (ctx, args) => {
// 		const junctions = await ctx.db
// 			.query(TABLE.MATERIALS)
// 			.withIndex("by_material", (q) => q.eq("materialId", args.materialId))
// 			.collect();

// 		const choices = await Promise.all(junctions.map((j) => ctx.db.get(j.choiceId)));

// 		return choices.filter(Boolean);
// 	},
// });

// // ============================================================================
// // Material Mutations
// // ============================================================================

// /**
//  * Create a new material (seller only).
//  */
// export const createMaterial = mutation({
// 	args: {
// 		categoryIds: v.array(v.id("categories")),
// 		formIds: v.optional(v.array(v.id("forms"))),
// 		finishIds: v.optional(v.array(v.id("finishes"))),
// 		choiceIds: v.optional(v.array(v.id("choices"))),
// 		normalizedQuantity: v.object({
// 			quantity: v.number(),
// 			unit: v.string(),
// 			baseUnit: v.string(),
// 			baseQuantity: v.number(),
// 		}),
// 		attributes: v.optional(v.any()),
// 		location: v.string(),
// 		idempotencyKey: v.optional(v.string()),
// 	},
// 	handler: async (ctx, args) => {
// 		const identity = await getAuthenticatedUser(ctx);
// 		await requireSellerRole(ctx, identity.subject);

// 		// Validation
// 		if (args.categoryIds.length === 0) {
// 			throw new Error("At least one category is required");
// 		}

// 		if (args.normalizedQuantity.quantity <= 0) {
// 			throw new Error("Quantity must be greater than 0");
// 		}

// 		if (!args.location.trim()) {
// 			throw new Error("Location is required");
// 		}

// 		// Generate material ID
// 		const materialId = generateMaterialId(identity.subject);

// 		// Check idempotency
// 		if (args.idempotencyKey) {
// 			const existing = await ctx.db
// 				.query(TABLE.MATERIALS)
// 				.withIndex("by_idempotency", (q) =>
// 					q.eq("materialId", materialId).eq("idempotencyKey", args.idempotencyKey)
// 				)
// 				.first();

// 			if (existing) {
// 				return existing.materialId;
// 			}
// 		}

// 		const now = Date.now();
// 		const eventId = generateEventId();

// 		// Generate searchable text
// 		const searchableText = generateSearchableText(
// 			{
// 				location: args.location,
// 				attributes: args.attributes,
// 			},
// 			args.normalizedQuantity
// 		);

// 		// Create material_created event
// 		await ctx.db.insert(TABLE.ALL_EVENTS, {
// 			eventId,
// 			eventType: "material_created",
// 			aggregateType: TABLE.MATERIALS,
// 			aggregateId: materialId,
// 			payload: {
// 				categoryIds: args.categoryIds,
// 				formIds: args.formIds,
// 				finishIds: args.finishIds,
// 				choiceIds: args.choiceIds,
// 				normalizedQuantity: args.normalizedQuantity,
// 				attributes: args.attributes,
// 				location: args.location,
// 			},
// 			userId: identity.subject,
// 			timestamp: now,
// 			idempotencyKey: args.idempotencyKey,
// 			domainEventRef: eventId,
// 			createdAt: now,
// 		});

// 		// Create material aggregate
// 		await ctx.db.insert("materialAggregates", {
// 			materialId,
// 			normalizedQuantity: args.normalizedQuantity,
// 			attributes: args.attributes,
// 			location: args.location,
// 			sellerId: identity.subject,
// 			searchableText,
// 			status: "pending",
// 			createdAt: now,
// 			lastEventId: eventId,
// 			lastUpdated: now,
// 		});

// 		// Populate junction tables in parallel
// 		await Promise.all([
// 			...args.categoryIds.map((categoryId) =>
// 				ctx.db.insert("materialCategories", { materialId, categoryId, createdAt: now })
// 			),
// 			...(args.formIds ?? []).map((formId) =>
// 				ctx.db.insert("materialForms", { materialId, formId, createdAt: now })
// 			),
// 			...(args.finishIds ?? []).map((finishId) =>
// 				ctx.db.insert("materialFinishes", { materialId, finishId, createdAt: now })
// 			),
// 			...(args.choiceIds ?? []).map((choiceId) =>
// 				ctx.db.insert("materialChoices", { materialId, choiceId, createdAt: now })
// 			),
// 		]);

// 		return materialId;
// 	},
// });

// /**
//  * Approve a material (admin only).
//  */
// export const approveMaterial = mutation({
// 	args: {
// 		materialId: v.string(),
// 		idempotencyKey: v.optional(v.string()),
// 	},
// 	handler: async (ctx, args) => {
// 		const identity = await getAuthenticatedUser(ctx);
// 		await requireAdminRole(ctx, identity.subject);

// 		// Check current aggregate state
// 		const aggregate = await ctx.db
// 			.query("materialAggregates")
// 			.withIndex("by_material", (q) => q.eq("materialId", args.materialId))
// 			.first();

// 		if (!aggregate) {
// 			throw new Error("Material not found");
// 		}

// 		if (aggregate.status !== "pending") {
// 			throw new Error("Material is not pending approval");
// 		}

// 		// Check idempotency
// 		if (args.idempotencyKey) {
// 			const existing = await ctx.db
// 				.query("materialEvents")
// 				.withIndex("by_idempotency", (q) =>
// 					q.eq("materialId", args.materialId).eq("idempotencyKey", args.idempotencyKey)
// 				)
// 				.first();

// 			if (existing) {
// 				return existing._id;
// 			}
// 		}

// 		const now = Date.now();
// 		const eventId = generateEventId();

// 		// Create material_approved event
// 		await ctx.db.insert("materialEvents", {
// 			eventId,
// 			eventType: "material_approved",
// 			materialId: args.materialId,
// 			approvedBy: identity.subject,
// 			schemaVersion: 1,
// 			syncedToUnified: false,
// 			idempotencyKey: args.idempotencyKey,
// 			timestamp: now,
// 			createdAt: now,
// 		});

// 		// Update aggregate
// 		await ctx.db.patch(aggregate._id, {
// 			status: "approved",
// 			approvedBy: identity.subject,
// 			approvedAt: now,
// 			lastEventId: eventId,
// 			lastUpdated: now,
// 		});

// 		return eventId;
// 	},
// });

// /**
//  * Reject a material (admin only).
//  */
// export const rejectMaterial = mutation({
// 	args: {
// 		materialId: v.string(),
// 		rejectionReason: v.string(),
// 		idempotencyKey: v.optional(v.string()),
// 	},
// 	handler: async (ctx, args) => {
// 		const identity = await getAuthenticatedUser(ctx);
// 		await requireAdminRole(ctx, identity.subject);

// 		if (!args.rejectionReason.trim()) {
// 			throw new Error("Rejection reason is required");
// 		}

// 		// Check current aggregate state
// 		const aggregate = await ctx.db
// 			.query("materialAggregates")
// 			.withIndex("by_material", (q) => q.eq("materialId", args.materialId))
// 			.first();

// 		if (!aggregate) {
// 			throw new Error("Material not found");
// 		}

// 		if (aggregate.status !== "pending") {
// 			throw new Error("Material is not pending approval");
// 		}

// 		// Check idempotency
// 		if (args.idempotencyKey) {
// 			const existing = await ctx.db
// 				.query("materialEvents")
// 				.withIndex("by_idempotency", (q) =>
// 					q.eq("materialId", args.materialId).eq("idempotencyKey", args.idempotencyKey)
// 				)
// 				.first();

// 			if (existing) {
// 				return existing._id;
// 			}
// 		}

// 		const now = Date.now();
// 		const eventId = generateEventId();

// 		// Create material_rejected event
// 		await ctx.db.insert("materialEvents", {
// 			eventId,
// 			eventType: "material_rejected",
// 			materialId: args.materialId,
// 			rejectionReason: args.rejectionReason,
// 			schemaVersion: 1,
// 			syncedToUnified: false,
// 			idempotencyKey: args.idempotencyKey,
// 			timestamp: now,
// 			createdAt: now,
// 		});

// 		// Update aggregate
// 		await ctx.db.patch(aggregate._id, {
// 			status: "rejected",
// 			rejectionReason: args.rejectionReason,
// 			lastEventId: eventId,
// 			lastUpdated: now,
// 		});

// 		return eventId;
// 	},
// });

// /**
//  * Archive a material.
//  */
// export const archiveMaterial = mutation({
// 	args: {
// 		materialId: v.string(),
// 		idempotencyKey: v.optional(v.string()),
// 	},
// 	handler: async (ctx, args) => {
// 		const identity = await getAuthenticatedUser(ctx);

// 		// Check current aggregate state
// 		const aggregate = await ctx.db
// 			.query("materialAggregates")
// 			.withIndex("by_material", (q) => q.eq("materialId", args.materialId))
// 			.first();

// 		if (!aggregate) {
// 			throw new Error("Material not found");
// 		}

// 		// Only seller who owns the material or admin can archive
// 		const isOwner = aggregate.sellerId === identity.subject;
// 		const isAdmin = await ctx.db
// 			.query("userRoles")
// 			.withIndex("by_user", (q) => q.eq("userId", identity.subject))
// 			.first()
// 			.then((role) => role?.roles.includes("admin") ?? false);

// 		if (!isOwner && !isAdmin) {
// 			throw new Error("Unauthorized: Only the seller or an admin can archive this material");
// 		}

// 		if (aggregate.status === "archived") {
// 			return; // Already archived
// 		}

// 		// Check idempotency
// 		if (args.idempotencyKey) {
// 			const existing = await ctx.db
// 				.query("materialEvents")
// 				.withIndex("by_idempotency", (q) =>
// 					q.eq("materialId", args.materialId).eq("idempotencyKey", args.idempotencyKey)
// 				)
// 				.first();

// 			if (existing) {
// 				return existing._id;
// 			}
// 		}

// 		const now = Date.now();
// 		const eventId = generateEventId();

// 		// Create material_archived event
// 		await ctx.db.insert("materialEvents", {
// 			eventId,
// 			eventType: "material_archived",
// 			materialId: args.materialId,
// 			schemaVersion: 1,
// 			syncedToUnified: false,
// 			idempotencyKey: args.idempotencyKey,
// 			timestamp: now,
// 			createdAt: now,
// 		});

// 		// Update aggregate
// 		await ctx.db.patch(aggregate._id, {
// 			status: "archived",
// 			lastEventId: eventId,
// 			lastUpdated: now,
// 		});

// 		return eventId;
// 	},
// });

// /**
//  * Add a material to an auction (admin or seller only).
//  */
// export const addMaterialToAuction = mutation({
// 	args: {
// 		auctionId: v.id(TABLE.AUCTIONS),
// 		materialId: v.string(),
// 		idempotencyKey: v.optional(v.string()),
// 	},
// 	handler: async (ctx, args) => {
// 		const identity = await getAuthenticatedUser(ctx);
// 		await requireAdminOrSellerRole(ctx, identity.subject);

// 		// Check auction exists and is not closed/cancelled
// 		const auction = await ctx.db.get(args.auctionId);
// 		if (!auction) {
// 			throw new Error("Auction not found");
// 		}
// 		if (auction.status === "closed" || auction.status === "cancelled") {
// 			throw new Error("Cannot add materials to a closed or cancelled auction");
// 		}

// 		// Check material exists and is approved
// 		const material = await ctx.db
// 			.query("materialAggregates")
// 			.withIndex("by_material", (q) => q.eq("materialId", args.materialId))
// 			.first();

// 		if (!material) {
// 			throw new Error("Material not found");
// 		}
// 		if (material.status !== "approved") {
// 			throw new Error("Only approved materials can be added to auctions");
// 		}

// 		// Check if already added
// 		const existing = await ctx.db
// 			.query("auctionMaterialAggregates")
// 			.withIndex("by_auction_material", (q) =>
// 				q.eq("auctionId", args.auctionId).eq("materialId", args.materialId)
// 			)
// 			.first();

// 		if (existing?.isActive) {
// 			throw new Error("Material is already in this auction");
// 		}

// 		// Check idempotency
// 		if (args.idempotencyKey) {
// 			const existingEvent = await ctx.db
// 				.query("auctionMaterialEvents")
// 				.withIndex("by_idempotency", (q) =>
// 					q
// 						.eq("auctionId", args.auctionId)
// 						.eq("materialId", args.materialId)
// 						.eq("idempotencyKey", args.idempotencyKey)
// 				)
// 				.first();

// 			if (existingEvent) {
// 				return existingEvent._id;
// 			}
// 		}

// 		const now = Date.now();
// 		const eventId = generateEventId();

// 		// Create material_added_to_auction event
// 		await ctx.db.insert("auctionMaterialEvents", {
// 			eventId,
// 			eventType: "material_added_to_auction",
// 			auctionId: args.auctionId,
// 			materialId: args.materialId,
// 			addedBy: identity.subject,
// 			idempotencyKey: args.idempotencyKey,
// 			timestamp: now,
// 			createdAt: now,
// 		});

// 		// Update or create aggregate
// 		if (existing) {
// 			await ctx.db.patch(existing._id, {
// 				isActive: true,
// 				addedAt: now,
// 				addedBy: identity.subject,
// 				removedAt: undefined,
// 				removedBy: undefined,
// 				removalReason: undefined,
// 				lastEventId: eventId,
// 				lastUpdated: now,
// 			});
// 		} else {
// 			await ctx.db.insert("auctionMaterialAggregates", {
// 				auctionId: args.auctionId,
// 				materialId: args.materialId,
// 				isActive: true,
// 				addedAt: now,
// 				addedBy: identity.subject,
// 				lastEventId: eventId,
// 				lastUpdated: now,
// 			});
// 		}

// 		return eventId;
// 	},
// });

// /**
//  * Add a material to the current live auction (admin or seller only).
//  * Convenience function that automatically finds the live auction.
//  */
// export const addMaterialToLiveAuction = mutation({
// 	args: {
// 		materialId: v.string(),
// 		idempotencyKey: v.optional(v.string()),
// 	},
// 	handler: async (ctx, args) => {
// 		const identity = await getAuthenticatedUser(ctx);
// 		await requireAdminOrSellerRole(ctx, identity.subject);

// 		// Find the live auction
// 		const liveAuction = await ctx.db
// 			.query(TABLE.AUCTIONS)
// 			.withIndex("by_status", (q) => q.eq("status", "live"))
// 			.first();

// 		if (!liveAuction) {
// 			throw new Error("No live auction found");
// 		}

// 		// Check auction is not closed/cancelled (shouldn't happen if status is live, but double-check)
// 		if (liveAuction.status === "closed" || liveAuction.status === "cancelled") {
// 			throw new Error("Cannot add materials to a closed or cancelled auction");
// 		}

// 		// Check material exists and is approved
// 		const material = await ctx.db
// 			.query("materialAggregates")
// 			.withIndex("by_material", (q) => q.eq("materialId", args.materialId))
// 			.first();

// 		if (!material) {
// 			throw new Error("Material not found");
// 		}
// 		if (material.status !== "approved") {
// 			throw new Error("Only approved materials can be added to auctions");
// 		}

// 		// Check if already added
// 		const existing = await ctx.db
// 			.query("auctionMaterialAggregates")
// 			.withIndex("by_auction_material", (q) =>
// 				q.eq("auctionId", liveAuction._id).eq("materialId", args.materialId)
// 			)
// 			.first();

// 		if (existing?.isActive) {
// 			throw new Error("Material is already in this auction");
// 		}

// 		// Check idempotency
// 		if (args.idempotencyKey) {
// 			const existingEvent = await ctx.db
// 				.query("auctionMaterialEvents")
// 				.withIndex("by_idempotency", (q) =>
// 					q
// 						.eq("auctionId", liveAuction._id)
// 						.eq("materialId", args.materialId)
// 						.eq("idempotencyKey", args.idempotencyKey)
// 				)
// 				.first();

// 			if (existingEvent) {
// 				return existingEvent._id;
// 			}
// 		}

// 		const now = Date.now();
// 		const eventId = generateEventId();

// 		// Create material_added_to_auction event
// 		await ctx.db.insert("auctionMaterialEvents", {
// 			eventId,
// 			eventType: "material_added_to_auction",
// 			auctionId: liveAuction._id,
// 			materialId: args.materialId,
// 			addedBy: identity.subject,
// 			idempotencyKey: args.idempotencyKey,
// 			timestamp: now,
// 			createdAt: now,
// 		});

// 		// Update or create aggregate
// 		if (existing) {
// 			await ctx.db.patch(existing._id, {
// 				isActive: true,
// 				addedAt: now,
// 				addedBy: identity.subject,
// 				removedAt: undefined,
// 				removedBy: undefined,
// 				removalReason: undefined,
// 				lastEventId: eventId,
// 				lastUpdated: now,
// 			});
// 		} else {
// 			await ctx.db.insert("auctionMaterialAggregates", {
// 				auctionId: liveAuction._id,
// 				materialId: args.materialId,
// 				isActive: true,
// 				addedAt: now,
// 				addedBy: identity.subject,
// 				lastEventId: eventId,
// 				lastUpdated: now,
// 			});
// 		}

// 		return eventId;
// 	},
// });

// /**
//  * Remove a material from an auction (admin only).
//  */
// export const removeMaterialFromAuction = mutation({
// 	args: {
// 		auctionId: v.id(TABLE.AUCTIONS),
// 		materialId: v.string(),
// 		removalReason: v.optional(v.string()),
// 		idempotencyKey: v.optional(v.string()),
// 	},
// 	handler: async (ctx, args) => {
// 		const identity = await getAuthenticatedUser(ctx);
// 		await requireAdminRole(ctx, identity.subject);

// 		// Check if material is in auction
// 		const existing = await ctx.db
// 			.query("auctionMaterialAggregates")
// 			.withIndex("by_auction_material", (q) =>
// 				q.eq("auctionId", args.auctionId).eq("materialId", args.materialId)
// 			)
// 			.first();

// 		if (!existing?.isActive) {
// 			throw new Error("Material is not in this auction");
// 		}

// 		// Check idempotency
// 		if (args.idempotencyKey) {
// 			const existingEvent = await ctx.db
// 				.query("auctionMaterialEvents")
// 				.withIndex("by_idempotency", (q) =>
// 					q
// 						.eq("auctionId", args.auctionId)
// 						.eq("materialId", args.materialId)
// 						.eq("idempotencyKey", args.idempotencyKey)
// 				)
// 				.first();

// 			if (existingEvent) {
// 				return existingEvent._id;
// 			}
// 		}

// 		const now = Date.now();
// 		const eventId = generateEventId();

// 		// Create material_removed_from_auction event
// 		await ctx.db.insert("auctionMaterialEvents", {
// 			eventId,
// 			eventType: "material_removed_from_auction",
// 			auctionId: args.auctionId,
// 			materialId: args.materialId,
// 			removedBy: identity.subject,
// 			removalReason: args.removalReason,
// 			idempotencyKey: args.idempotencyKey,
// 			timestamp: now,
// 			createdAt: now,
// 		});

// 		// Update aggregate
// 		await ctx.db.patch(existing._id, {
// 			isActive: false,
// 			removedAt: now,
// 			removedBy: identity.subject,
// 			removalReason: args.removalReason,
// 			lastEventId: eventId,
// 			lastUpdated: now,
// 		});

// 		return eventId;
// 	},
// });
