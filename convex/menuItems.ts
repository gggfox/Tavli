import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
	NotAuthenticatedErrorObject,
	NotAuthorizedErrorObject,
	NotFoundError,
	NotFoundErrorObject,
} from "./_shared/errors";
import { AsyncReturn } from "./_shared/types";
import { getCurrentUserId, requireOwnerRole } from "./_util/auth";
import { TABLE } from "./constants";

type AuthErrors = NotAuthenticatedErrorObject | NotAuthorizedErrorObject;

export const create = mutation({
	args: {
		categoryId: v.id(TABLE.MENU_CATEGORIES),
		restaurantId: v.id(TABLE.RESTAURANTS),
		name: v.string(),
		description: v.optional(v.string()),
		basePrice: v.number(),
		imageUrl: v.optional(v.string()),
		tags: v.optional(v.array(v.string())),
		availableDays: v.optional(v.array(v.number())),
	},
	handler: async function (ctx, args): AsyncReturn<string, AuthErrors> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [, error2] = await requireOwnerRole(ctx, userId);
		if (error2) return [null, error2];

		const existing = await ctx.db
			.query(TABLE.MENU_ITEMS)
			.withIndex("by_category", (q) => q.eq("categoryId", args.categoryId))
			.collect();

		const now = Date.now();
		const id = await ctx.db.insert(TABLE.MENU_ITEMS, {
			categoryId: args.categoryId,
			restaurantId: args.restaurantId,
			name: args.name,
			description: args.description,
			basePrice: args.basePrice,
			imageUrl: args.imageUrl,
			isAvailable: true,
			availableDays: args.availableDays,
			displayOrder: existing.length,
			tags: args.tags,
			createdAt: now,
			updatedAt: now,
		});

		return [id, null];
	},
});

export const update = mutation({
	args: {
		itemId: v.id(TABLE.MENU_ITEMS),
		name: v.optional(v.string()),
		description: v.optional(v.string()),
		basePrice: v.optional(v.number()),
		imageUrl: v.optional(v.string()),
		tags: v.optional(v.array(v.string())),
		displayOrder: v.optional(v.number()),
		availableDays: v.optional(v.array(v.number())),
	},
	handler: async function (ctx, args): AsyncReturn<string, AuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [, error2] = await requireOwnerRole(ctx, userId);
		if (error2) return [null, error2];

		const item = await ctx.db.get(args.itemId);
		if (!item) return [null, new NotFoundError("Menu item not found").toObject()];

		await ctx.db.patch(args.itemId, {
			...(args.name !== undefined && { name: args.name }),
			...(args.description !== undefined && { description: args.description }),
			...(args.basePrice !== undefined && { basePrice: args.basePrice }),
			...(args.imageUrl !== undefined && { imageUrl: args.imageUrl }),
			...(args.tags !== undefined && { tags: args.tags }),
			...(args.displayOrder !== undefined && { displayOrder: args.displayOrder }),
			...(args.availableDays !== undefined && { availableDays: args.availableDays }),
			updatedAt: Date.now(),
		});

		return [args.itemId, null];
	},
});

export const remove = mutation({
	args: { itemId: v.id(TABLE.MENU_ITEMS) },
	handler: async function (ctx, args): AsyncReturn<void, AuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [, error2] = await requireOwnerRole(ctx, userId);
		if (error2) return [null, error2];

		const item = await ctx.db.get(args.itemId);
		if (!item) return [null, new NotFoundError("Menu item not found").toObject()];

		const links = await ctx.db
			.query(TABLE.MENU_ITEM_OPTION_GROUPS)
			.withIndex("by_menuItem", (q) => q.eq("menuItemId", args.itemId))
			.collect();
		for (const link of links) await ctx.db.delete(link._id);

		await ctx.db.delete(args.itemId);
		return [undefined, null];
	},
});

export const toggleAvailability = mutation({
	args: {
		itemId: v.id(TABLE.MENU_ITEMS),
		unavailableReason: v.optional(v.string()),
	},
	handler: async function (ctx, args): AsyncReturn<boolean, AuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [, error2] = await requireOwnerRole(ctx, userId);
		if (error2) return [null, error2];

		const item = await ctx.db.get(args.itemId);
		if (!item) return [null, new NotFoundError("Menu item not found").toObject()];

		const newState = !item.isAvailable;
		await ctx.db.patch(args.itemId, {
			isAvailable: newState,
			unavailableReason: newState ? undefined : args.unavailableReason,
			updatedAt: Date.now(),
		});

		return [newState, null];
	},
});

export const getByCategory = query({
	args: { categoryId: v.id(TABLE.MENU_CATEGORIES) },
	handler: async (ctx, args) => {
		return await ctx.db
			.query(TABLE.MENU_ITEMS)
			.withIndex("by_category", (q) => q.eq("categoryId", args.categoryId))
			.collect();
	},
});

export const getByRestaurant = query({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async (ctx, args) => {
		return await ctx.db
			.query(TABLE.MENU_ITEMS)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();
	},
});
