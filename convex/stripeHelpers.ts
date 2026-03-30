import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { TABLE } from "./constants";

// =============================================================================
// Internal Queries
// =============================================================================
// Used by stripe.ts actions via ctx.runQuery(internal.stripeHelpers.*)

export const getRestaurantInternal = internalQuery({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async (ctx, args) => {
		return await ctx.db.get(args.restaurantId);
	},
});

export const getOrderInternal = internalQuery({
	args: { orderId: v.id(TABLE.ORDERS) },
	handler: async (ctx, args) => {
		return await ctx.db.get(args.orderId);
	},
});

export const getProductInternal = internalQuery({
	args: { productId: v.id(TABLE.PRODUCTS) },
	handler: async (ctx, args) => {
		return await ctx.db.get(args.productId);
	},
});

// =============================================================================
// Public Queries
// =============================================================================

/**
 * Fetches all products from the database, joined with their restaurant name.
 * Used by the storefront to display all available products.
 */
export const listAllProducts = query({
	handler: async (ctx) => {
		const products = await ctx.db.query(TABLE.PRODUCTS).collect();

		const productsWithRestaurant = await Promise.all(
			products
				.filter((p) => p.isActive)
				.map(async (product) => {
					const restaurant = await ctx.db.get(product.restaurantId);
					return {
						...product,
						restaurantName: restaurant?.name ?? "Unknown",
						restaurantSlug: restaurant?.slug ?? "",
					};
				})
		);

		return productsWithRestaurant;
	},
});

/**
 * Fetches products for a specific restaurant.
 * Used by the product management UI.
 */
export const listProductsByRestaurant = query({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async (ctx, args) => {
		return await ctx.db
			.query(TABLE.PRODUCTS)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();
	},
});

// =============================================================================
// Internal Mutations
// =============================================================================

export const saveStripeAccountId = internalMutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		stripeAccountId: v.string(),
	},
	handler: async (ctx, args) => {
		await ctx.db.patch(args.restaurantId, {
			stripeAccountId: args.stripeAccountId,
			updatedAt: Date.now(),
		});
	},
});

export const updateOnboardingStatus = internalMutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		stripeOnboardingComplete: v.boolean(),
	},
	handler: async (ctx, args) => {
		await ctx.db.patch(args.restaurantId, {
			stripeOnboardingComplete: args.stripeOnboardingComplete,
			updatedAt: Date.now(),
		});
	},
});

/**
 * Updates onboarding status by looking up the restaurant via its Stripe account ID.
 * Used by webhook handlers that only know the Stripe account ID, not our internal ID.
 */
export const updateOnboardingByAccountId = internalMutation({
	args: {
		stripeAccountId: v.string(),
		stripeOnboardingComplete: v.boolean(),
	},
	handler: async (ctx, args) => {
		const restaurants = await ctx.db.query(TABLE.RESTAURANTS).collect();
		const restaurant = restaurants.find((r) => r.stripeAccountId === args.stripeAccountId);
		if (restaurant) {
			await ctx.db.patch(restaurant._id, {
				stripeOnboardingComplete: args.stripeOnboardingComplete,
				updatedAt: Date.now(),
			});
		}
	},
});

export const savePaymentIntentId = internalMutation({
	args: {
		orderId: v.id(TABLE.ORDERS),
		stripePaymentIntentId: v.string(),
	},
	handler: async (ctx, args) => {
		await ctx.db.patch(args.orderId, {
			stripePaymentIntentId: args.stripePaymentIntentId,
			updatedAt: Date.now(),
		});
	},
});

/**
 * Persists a new product record in the DB after it has been created in Stripe.
 */
export const saveProduct = internalMutation({
	args: {
		stripeProductId: v.string(),
		stripePriceId: v.string(),
		restaurantId: v.id(TABLE.RESTAURANTS),
		name: v.string(),
		description: v.optional(v.string()),
		priceInCents: v.number(),
		currency: v.string(),
	},
	handler: async (ctx, args) => {
		const now = Date.now();
		return await ctx.db.insert(TABLE.PRODUCTS, {
			stripeProductId: args.stripeProductId,
			stripePriceId: args.stripePriceId,
			restaurantId: args.restaurantId,
			name: args.name,
			description: args.description,
			priceInCents: args.priceInCents,
			currency: args.currency,
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
	},
});
