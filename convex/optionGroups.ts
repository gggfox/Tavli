import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
	NotAuthenticatedErrorObject,
	NotAuthorizedErrorObject,
	NotFoundError,
	NotFoundErrorObject,
} from "./_shared/errors";
import { AsyncReturn } from "./_shared/types";
import { getCurrentUserId, requireManagerRole } from "./_util/auth";
import { TABLE } from "./constants";

type AuthErrors = NotAuthenticatedErrorObject | NotAuthorizedErrorObject;

// ============================================================================
// Option Group CRUD
// ============================================================================

export const createGroup = mutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		name: v.string(),
		selectionType: v.union(v.literal("single"), v.literal("multi")),
		isRequired: v.boolean(),
		minSelections: v.number(),
		maxSelections: v.number(),
	},
	handler: async function (ctx, args): AsyncReturn<string, AuthErrors> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [, error2] = await requireManagerRole(ctx, userId);
		if (error2) return [null, error2];

		const existing = await ctx.db
			.query(TABLE.OPTION_GROUPS)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();

		const now = Date.now();
		const id = await ctx.db.insert(TABLE.OPTION_GROUPS, {
			restaurantId: args.restaurantId,
			name: args.name,
			selectionType: args.selectionType,
			isRequired: args.isRequired,
			minSelections: args.minSelections,
			maxSelections: args.maxSelections,
			displayOrder: existing.length,
			createdAt: now,
			updatedAt: now,
		});

		return [id, null];
	},
});

export const updateGroup = mutation({
	args: {
		groupId: v.id(TABLE.OPTION_GROUPS),
		name: v.optional(v.string()),
		selectionType: v.optional(v.union(v.literal("single"), v.literal("multi"))),
		isRequired: v.optional(v.boolean()),
		minSelections: v.optional(v.number()),
		maxSelections: v.optional(v.number()),
		displayOrder: v.optional(v.number()),
	},
	handler: async function (ctx, args): AsyncReturn<string, AuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [, error2] = await requireManagerRole(ctx, userId);
		if (error2) return [null, error2];

		const group = await ctx.db.get(args.groupId);
		if (!group) return [null, new NotFoundError("Option group not found").toObject()];

		await ctx.db.patch(args.groupId, {
			...(args.name !== undefined && { name: args.name }),
			...(args.selectionType !== undefined && { selectionType: args.selectionType }),
			...(args.isRequired !== undefined && { isRequired: args.isRequired }),
			...(args.minSelections !== undefined && { minSelections: args.minSelections }),
			...(args.maxSelections !== undefined && { maxSelections: args.maxSelections }),
			...(args.displayOrder !== undefined && { displayOrder: args.displayOrder }),
			updatedAt: Date.now(),
		});

		return [args.groupId, null];
	},
});

export const deleteGroup = mutation({
	args: { groupId: v.id(TABLE.OPTION_GROUPS) },
	handler: async function (ctx, args): AsyncReturn<void, AuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [, error2] = await requireManagerRole(ctx, userId);
		if (error2) return [null, error2];

		const group = await ctx.db.get(args.groupId);
		if (!group) return [null, new NotFoundError("Option group not found").toObject()];

		const options = await ctx.db
			.query(TABLE.OPTIONS)
			.withIndex("by_optionGroup", (q) => q.eq("optionGroupId", args.groupId))
			.collect();
		for (const option of options) await ctx.db.delete(option._id);

		const links = await ctx.db
			.query(TABLE.MENU_ITEM_OPTION_GROUPS)
			.withIndex("by_optionGroup", (q) => q.eq("optionGroupId", args.groupId))
			.collect();
		for (const link of links) await ctx.db.delete(link._id);

		await ctx.db.delete(args.groupId);
		return [undefined, null];
	},
});

export const setGroupTranslation = mutation({
	args: {
		groupId: v.id(TABLE.OPTION_GROUPS),
		lang: v.string(),
		name: v.optional(v.string()),
	},
	handler: async function (ctx, args): AsyncReturn<string, AuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [, error2] = await requireManagerRole(ctx, userId);
		if (error2) return [null, error2];

		const group = await ctx.db.get(args.groupId);
		if (!group) return [null, new NotFoundError("Option group not found").toObject()];

		const translations = { ...group.translations };
		translations[args.lang] = {
			...translations[args.lang],
			...(args.name !== undefined && { name: args.name }),
		};

		await ctx.db.patch(args.groupId, { translations, updatedAt: Date.now() });
		return [args.groupId, null];
	},
});

export const getGroupsByRestaurant = query({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async (ctx, args) => {
		return await ctx.db
			.query(TABLE.OPTION_GROUPS)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();
	},
});

// ============================================================================
// Option CRUD
// ============================================================================

export const createOption = mutation({
	args: {
		optionGroupId: v.id(TABLE.OPTION_GROUPS),
		restaurantId: v.id(TABLE.RESTAURANTS),
		name: v.string(),
		priceModifier: v.number(),
	},
	handler: async function (ctx, args): AsyncReturn<string, AuthErrors> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [, error2] = await requireManagerRole(ctx, userId);
		if (error2) return [null, error2];

		const existing = await ctx.db
			.query(TABLE.OPTIONS)
			.withIndex("by_optionGroup", (q) => q.eq("optionGroupId", args.optionGroupId))
			.collect();

		const id = await ctx.db.insert(TABLE.OPTIONS, {
			optionGroupId: args.optionGroupId,
			restaurantId: args.restaurantId,
			name: args.name,
			priceModifier: args.priceModifier,
			isAvailable: true,
			displayOrder: existing.length,
			createdAt: Date.now(),
		});

		return [id, null];
	},
});

export const updateOption = mutation({
	args: {
		optionId: v.id(TABLE.OPTIONS),
		name: v.optional(v.string()),
		priceModifier: v.optional(v.number()),
		isAvailable: v.optional(v.boolean()),
		displayOrder: v.optional(v.number()),
	},
	handler: async function (ctx, args): AsyncReturn<string, AuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [, error2] = await requireManagerRole(ctx, userId);
		if (error2) return [null, error2];

		const option = await ctx.db.get(args.optionId);
		if (!option) return [null, new NotFoundError("Option not found").toObject()];

		await ctx.db.patch(args.optionId, {
			...(args.name !== undefined && { name: args.name }),
			...(args.priceModifier !== undefined && { priceModifier: args.priceModifier }),
			...(args.isAvailable !== undefined && { isAvailable: args.isAvailable }),
			...(args.displayOrder !== undefined && { displayOrder: args.displayOrder }),
		});

		return [args.optionId, null];
	},
});

export const deleteOption = mutation({
	args: { optionId: v.id(TABLE.OPTIONS) },
	handler: async function (ctx, args): AsyncReturn<void, AuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [, error2] = await requireManagerRole(ctx, userId);
		if (error2) return [null, error2];

		const option = await ctx.db.get(args.optionId);
		if (!option) return [null, new NotFoundError("Option not found").toObject()];

		await ctx.db.delete(args.optionId);
		return [undefined, null];
	},
});

export const setOptionTranslation = mutation({
	args: {
		optionId: v.id(TABLE.OPTIONS),
		lang: v.string(),
		name: v.optional(v.string()),
	},
	handler: async function (ctx, args): AsyncReturn<string, AuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [, error2] = await requireManagerRole(ctx, userId);
		if (error2) return [null, error2];

		const option = await ctx.db.get(args.optionId);
		if (!option) return [null, new NotFoundError("Option not found").toObject()];

		const translations = { ...option.translations };
		translations[args.lang] = {
			...translations[args.lang],
			...(args.name !== undefined && { name: args.name }),
		};

		await ctx.db.patch(args.optionId, { translations });
		return [args.optionId, null];
	},
});

export const getOptionsByGroup = query({
	args: { optionGroupId: v.id(TABLE.OPTION_GROUPS) },
	handler: async (ctx, args) => {
		return await ctx.db
			.query(TABLE.OPTIONS)
			.withIndex("by_optionGroup", (q) => q.eq("optionGroupId", args.optionGroupId))
			.collect();
	},
});

// ============================================================================
// Junction: Link option groups to menu items
// ============================================================================

export const linkToMenuItem = mutation({
	args: {
		menuItemId: v.id(TABLE.MENU_ITEMS),
		optionGroupId: v.id(TABLE.OPTION_GROUPS),
		restaurantId: v.id(TABLE.RESTAURANTS),
	},
	handler: async function (ctx, args): AsyncReturn<string, AuthErrors> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [, error2] = await requireManagerRole(ctx, userId);
		if (error2) return [null, error2];

		const existing = await ctx.db
			.query(TABLE.MENU_ITEM_OPTION_GROUPS)
			.withIndex("by_menuItem", (q) => q.eq("menuItemId", args.menuItemId))
			.collect();

		const alreadyLinked = existing.find((l) => l.optionGroupId === args.optionGroupId);
		if (alreadyLinked) return [alreadyLinked._id, null];

		const id = await ctx.db.insert(TABLE.MENU_ITEM_OPTION_GROUPS, {
			menuItemId: args.menuItemId,
			optionGroupId: args.optionGroupId,
			restaurantId: args.restaurantId,
			displayOrder: existing.length,
		});

		return [id, null];
	},
});

export const unlinkFromMenuItem = mutation({
	args: {
		menuItemId: v.id(TABLE.MENU_ITEMS),
		optionGroupId: v.id(TABLE.OPTION_GROUPS),
	},
	handler: async function (ctx, args): AsyncReturn<void, AuthErrors> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [, error2] = await requireManagerRole(ctx, userId);
		if (error2) return [null, error2];

		const links = await ctx.db
			.query(TABLE.MENU_ITEM_OPTION_GROUPS)
			.withIndex("by_menuItem", (q) => q.eq("menuItemId", args.menuItemId))
			.collect();

		const link = links.find((l) => l.optionGroupId === args.optionGroupId);
		if (link) await ctx.db.delete(link._id);

		return [undefined, null];
	},
});

export const getGroupsForMenuItem = query({
	args: { menuItemId: v.id(TABLE.MENU_ITEMS) },
	handler: async (ctx, args) => {
		const links = await ctx.db
			.query(TABLE.MENU_ITEM_OPTION_GROUPS)
			.withIndex("by_menuItem", (q) => q.eq("menuItemId", args.menuItemId))
			.collect();

		const groups = await Promise.all(
			links.map(async (link) => {
				const group = await ctx.db.get(link.optionGroupId);
				if (!group) return null;
				const options = await ctx.db
					.query(TABLE.OPTIONS)
					.withIndex("by_optionGroup", (q) => q.eq("optionGroupId", link.optionGroupId))
					.collect();
				return { ...group, options, linkDisplayOrder: link.displayOrder };
			})
		);

		return groups.filter(Boolean);
	},
});
