import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import {
	NotAuthenticatedErrorObject,
	NotAuthorizedErrorObject,
	NotFoundError,
	NotFoundErrorObject,
	UserInputValidationError,
	UserInputValidationErrorObject,
} from "./_shared/errors";
import { AsyncReturn } from "./_shared/types";
import { getCurrentUserId, requireAdminRole, requireOwnerRole } from "./_util/auth";
import { TABLE } from "./constants";

type AuthErrors = NotAuthenticatedErrorObject | NotAuthorizedErrorObject;

export const create = mutation({
	args: {
		name: v.string(),
		slug: v.string(),
		description: v.optional(v.string()),
		currency: v.string(),
		timezone: v.optional(v.string()),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<Id<"restaurants">, AuthErrors | UserInputValidationErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

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

export const getBySlug = query({
	args: { slug: v.string() },
	handler: async (ctx, args) => {
		return await ctx.db
			.query(TABLE.RESTAURANTS)
			.withIndex("by_slug", (q) => q.eq("slug", args.slug))
			.first();
	},
});

export const getAll = query({
	handler: async function (ctx): AsyncReturn<
		Array<{
			_id: string;
			name: string;
			slug: string;
			ownerId: string;
			isActive: boolean;
			currency: string;
			createdAt: number;
		}>,
		AuthErrors
	> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [, error2] = await requireAdminRole(ctx, userId);
		if (error2) return [null, error2];

		const restaurants = await ctx.db.query(TABLE.RESTAURANTS).collect();

		return [
			restaurants.map((r) => ({
				_id: r._id,
				name: r.name,
				slug: r.slug,
				ownerId: r.ownerId,
				isActive: r.isActive,
				currency: r.currency,
				createdAt: r.createdAt,
			})),
			null,
		];
	},
});
