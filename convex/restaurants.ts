import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import {
	NotAuthenticatedErrorObject,
	NotAuthorizedError,
	NotAuthorizedErrorObject,
	NotFoundError,
	NotFoundErrorObject,
	UserInputValidationError,
	UserInputValidationErrorObject,
} from "./_shared/errors";
import { AsyncReturn } from "./_shared/types";
import { getCurrentUserId, isAdmin, requireOwnerRole, RoleErrorMessages } from "./_util/auth";
import { TABLE } from "./constants";

type AuthErrors = NotAuthenticatedErrorObject | NotAuthorizedErrorObject;

export const create = mutation({
	args: {
		name: v.string(),
		slug: v.string(),
		description: v.optional(v.string()),
		currency: v.string(),
		timezone: v.optional(v.string()),
		organizationId: v.id(TABLE.ORGANIZATIONS),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<Id<"restaurants">, AuthErrors | UserInputValidationErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [, error2] = await requireOwnerRole(ctx, userId);
		if (error2) return [null, error2];

		const existing = await ctx.db
			.query(TABLE.RESTAURANTS)
			.withIndex("by_slug", (q) => q.eq("slug", args.slug))
			.first();

		if (existing) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "slug", message: "This slug is already taken" }],
				}).toObject(),
			];
		}

		const now = Date.now();
		const id = await ctx.db.insert(TABLE.RESTAURANTS, {
			ownerId: userId,
			organizationId: args.organizationId,
			name: args.name,
			slug: args.slug,
			description: args.description,
			currency: args.currency,
			timezone: args.timezone,
			isActive: false,
			createdAt: now,
			updatedAt: now,
		});

		return [id, null];
	},
});

export const update = mutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		name: v.optional(v.string()),
		slug: v.optional(v.string()),
		description: v.optional(v.string()),
		currency: v.optional(v.string()),
		timezone: v.optional(v.string()),
		defaultLanguage: v.optional(v.string()),
		supportedLanguages: v.optional(v.array(v.string())),
		organizationId: v.id(TABLE.ORGANIZATIONS),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<
		Id<"restaurants">,
		AuthErrors | NotFoundErrorObject | UserInputValidationErrorObject
	> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [, error2] = await requireOwnerRole(ctx, userId);
		if (error2) return [null, error2];

		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant) return [null, new NotFoundError("Restaurant not found").toObject()];

		const userIsAdmin = await isAdmin(ctx, userId);
		if (!userIsAdmin && restaurant.ownerId !== userId) {
			return [null, new NotAuthorizedError(RoleErrorMessages.INSUFFICIENT_PERMISSIONS).toObject()];
		}

		if (args.slug && args.slug !== restaurant.slug) {
			const existing = await ctx.db
				.query(TABLE.RESTAURANTS)
				.withIndex("by_slug", (q) => q.eq("slug", args.slug!))
				.first();
			if (existing) {
				return [
					null,
					new UserInputValidationError({
						fields: [{ field: "slug", message: "This slug is already taken" }],
					}).toObject(),
				];
			}
		}

		const now = Date.now();
		await ctx.db.patch(args.restaurantId, {
			...(args.name !== undefined && { name: args.name }),
			...(args.slug !== undefined && { slug: args.slug }),
			...(args.description !== undefined && { description: args.description }),
			...(args.currency !== undefined && { currency: args.currency }),
			...(args.timezone !== undefined && { timezone: args.timezone }),
			...(args.defaultLanguage !== undefined && { defaultLanguage: args.defaultLanguage }),
			...(args.supportedLanguages !== undefined && { supportedLanguages: args.supportedLanguages }),
			...(args.organizationId !== undefined && { organizationId: args.organizationId }),
			updatedAt: now,
		});

		return [args.restaurantId, null];
	},
});

export const toggleActive = mutation({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async function (ctx, args): AsyncReturn<boolean, AuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [, error2] = await requireOwnerRole(ctx, userId);
		if (error2) return [null, error2];

		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant) return [null, new NotFoundError("Restaurant not found").toObject()];

		const userIsAdmin = await isAdmin(ctx, userId);
		if (!userIsAdmin && restaurant.ownerId !== userId) {
			return [null, new NotAuthorizedError(RoleErrorMessages.INSUFFICIENT_PERMISSIONS).toObject()];
		}

		const newState = !restaurant.isActive;
		await ctx.db.patch(args.restaurantId, { isActive: newState, updatedAt: Date.now() });
		return [newState, null];
	},
});

export const getByOwner = query({
	handler: async function (ctx): AsyncReturn<Doc<"restaurants">[], AuthErrors> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const restaurants = await ctx.db
			.query(TABLE.RESTAURANTS)
			.withIndex("by_owner", (q) => q.eq("ownerId", userId))
			.collect();

		return [restaurants, null];
	},
});

export const getPaymentsEnabled = query({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async (ctx, args) => {
		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant) return false;
		return restaurant.isActive === true && restaurant.stripeOnboardingComplete === true;
	},
});

export const getManageableForStripe = query({
	handler: async function (ctx): AsyncReturn<Doc<"restaurants">[], AuthErrors> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const userIsAdmin = await isAdmin(ctx, userId);
		if (userIsAdmin) {
			return [await ctx.db.query(TABLE.RESTAURANTS).collect(), null];
		}

		const ownedRestaurants = await ctx.db
			.query(TABLE.RESTAURANTS)
			.withIndex("by_owner", (q) => q.eq("ownerId", userId))
			.collect();
		return [ownedRestaurants, null];
	},
});

export const getBySlug = query({
	args: { slug: v.string() },
	handler: async (ctx, args) => {
		return await ctx.db
			.query(TABLE.RESTAURANTS)
			.withIndex("by_slug", (q) => q.eq("slug", args.slug))
			.first();
	},
});

export const getStripeStatus = query({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async function (
		ctx,
		args
	): AsyncReturn<
		{ stripeAccountId: string | undefined; stripeOnboardingComplete: boolean },
		AuthErrors | NotFoundErrorObject
	> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [, error2] = await requireOwnerRole(ctx, userId);
		if (error2) return [null, error2];

		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant) return [null, new NotFoundError("Restaurant not found").toObject()];

		return [
			{
				stripeAccountId: restaurant.stripeAccountId,
				stripeOnboardingComplete: restaurant.stripeOnboardingComplete ?? false,
			},
			null,
		];
	},
});

export const getAll = query({
	handler: async function (ctx): AsyncReturn<Doc<"restaurants">[], AuthErrors> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const userIsAdmin = await isAdmin(ctx, userId);
		if (userIsAdmin) {
			return [await ctx.db.query(TABLE.RESTAURANTS).collect(), null];
		}

		const owned = await ctx.db
			.query(TABLE.RESTAURANTS)
			.withIndex("by_owner", (q) => q.eq("ownerId", userId))
			.collect();

		const userRole = await ctx.db
			.query(TABLE.USER_ROLES)
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.first();

		const orgId = userRole?.organizationId as Id<"organizations"> | undefined;
		if (!orgId) return [owned, null];

		const orgRestaurants = await ctx.db
			.query(TABLE.RESTAURANTS)
			.withIndex("by_organization", (q) => q.eq("organizationId", orgId))
			.collect();

		const seen = new Set(owned.map((r) => r._id));
		for (const r of orgRestaurants) {
			if (!seen.has(r._id)) owned.push(r);
		}

		return [owned, null];
	},
});
