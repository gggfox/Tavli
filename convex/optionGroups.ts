import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
	NotAuthenticatedErrorObject,
	NotAuthorizedErrorObject,
	NotFoundError,
	NotFoundErrorObject,
} from "./_shared/errors";
import { AsyncReturn } from "./_shared/types";
import { appendAuditEvent, stampUpdated } from "./_util/audit";
import { getCurrentUserId, requireRestaurantManagerOrAbove } from "./_util/auth";
import { TABLE } from "./constants";

type AuthErrors =
	| NotAuthenticatedErrorObject
	| NotAuthorizedErrorObject
	| NotFoundErrorObject;

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
		const [, error2] = await requireRestaurantManagerOrAbove(ctx, userId, args.restaurantId);
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
			updatedBy: userId,
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.OPTION_GROUPS,
			aggregateId: id,
			eventType: "optionGroups.created",
			payload: { name: args.name },
			userId,
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

		const group = await ctx.db.get(args.groupId);
		if (!group) return [null, new NotFoundError("Option group not found").toObject()];

		const [, error2] = await requireRestaurantManagerOrAbove(ctx, userId, group.restaurantId);
		if (error2) return [null, error2];

		await ctx.db.patch(args.groupId, {
			...(args.name !== undefined && { name: args.name }),
			...(args.selectionType !== undefined && { selectionType: args.selectionType }),
			...(args.isRequired !== undefined && { isRequired: args.isRequired }),
			...(args.minSelections !== undefined && { minSelections: args.minSelections }),
			...(args.maxSelections !== undefined && { maxSelections: args.maxSelections }),
			...(args.displayOrder !== undefined && { displayOrder: args.displayOrder }),
			...stampUpdated(userId),
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.OPTION_GROUPS,
			aggregateId: args.groupId,
			eventType: "optionGroups.updated",
			payload: args,
			userId,
		});

		return [args.groupId, null];
	},
});

export const deleteGroup = mutation({
	args: { groupId: v.id(TABLE.OPTION_GROUPS) },
	handler: async function (ctx, args): AsyncReturn<null, AuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const group = await ctx.db.get(args.groupId);
		if (!group) return [null, new NotFoundError("Option group not found").toObject()];

		const [, error2] = await requireRestaurantManagerOrAbove(ctx, userId, group.restaurantId);
		if (error2) return [null, error2];

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
		await appendAuditEvent(ctx, {
			aggregateType: TABLE.OPTION_GROUPS,
			aggregateId: args.groupId,
			eventType: "optionGroups.deleted",
			payload: {},
			userId,
		});
		return [null, null];
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

		const group = await ctx.db.get(args.groupId);
		if (!group) return [null, new NotFoundError("Option group not found").toObject()];

		const [, error2] = await requireRestaurantManagerOrAbove(ctx, userId, group.restaurantId);
		if (error2) return [null, error2];

		const translations = { ...group.translations };
		translations[args.lang] = {
			...translations[args.lang],
			...(args.name !== undefined && { name: args.name }),
		};

		await ctx.db.patch(args.groupId, { translations, ...stampUpdated(userId) });
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
		const [, error2] = await requireRestaurantManagerOrAbove(ctx, userId, args.restaurantId);
		if (error2) return [null, error2];

		const existing = await ctx.db
			.query(TABLE.OPTIONS)
			.withIndex("by_optionGroup", (q) => q.eq("optionGroupId", args.optionGroupId))
			.collect();

		const now = Date.now();
		const id = await ctx.db.insert(TABLE.OPTIONS, {
			optionGroupId: args.optionGroupId,
			restaurantId: args.restaurantId,
			name: args.name,
			priceModifier: args.priceModifier,
			isAvailable: true,
			displayOrder: existing.length,
			createdAt: now,
			updatedAt: now,
			updatedBy: userId,
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.OPTIONS,
			aggregateId: id,
			eventType: "options.created",
			payload: { name: args.name },
			userId,
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

		const option = await ctx.db.get(args.optionId);
		if (!option) return [null, new NotFoundError("Option not found").toObject()];

		const [, error2] = await requireRestaurantManagerOrAbove(ctx, userId, option.restaurantId);
		if (error2) return [null, error2];

		await ctx.db.patch(args.optionId, {
			...(args.name !== undefined && { name: args.name }),
			...(args.priceModifier !== undefined && { priceModifier: args.priceModifier }),
			...(args.isAvailable !== undefined && { isAvailable: args.isAvailable }),
			...(args.displayOrder !== undefined && { displayOrder: args.displayOrder }),
			...stampUpdated(userId),
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.OPTIONS,
			aggregateId: args.optionId,
			eventType: "options.updated",
			payload: args,
			userId,
		});

		return [args.optionId, null];
	},
});

export const deleteOption = mutation({
	args: { optionId: v.id(TABLE.OPTIONS) },
	handler: async function (ctx, args): AsyncReturn<null, AuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const option = await ctx.db.get(args.optionId);
		if (!option) return [null, new NotFoundError("Option not found").toObject()];

		const [, error2] = await requireRestaurantManagerOrAbove(ctx, userId, option.restaurantId);
		if (error2) return [null, error2];

		await ctx.db.delete(args.optionId);
		await appendAuditEvent(ctx, {
			aggregateType: TABLE.OPTIONS,
			aggregateId: args.optionId,
			eventType: "options.deleted",
			payload: {},
			userId,
		});
		return [null, null];
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

		const option = await ctx.db.get(args.optionId);
		if (!option) return [null, new NotFoundError("Option not found").toObject()];

		const [, error2] = await requireRestaurantManagerOrAbove(ctx, userId, option.restaurantId);
		if (error2) return [null, error2];

		const translations = { ...option.translations };
		translations[args.lang] = {
			...translations[args.lang],
			...(args.name !== undefined && { name: args.name }),
		};

		await ctx.db.patch(args.optionId, { translations, ...stampUpdated(userId) });
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
		const [, error2] = await requireRestaurantManagerOrAbove(ctx, userId, args.restaurantId);
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
	handler: async function (ctx, args): AsyncReturn<null, AuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const item = await ctx.db.get(args.menuItemId);
		if (!item) return [null, new NotFoundError("Menu item not found").toObject()];

		const [, error2] = await requireRestaurantManagerOrAbove(ctx, userId, item.restaurantId);
		if (error2) return [null, error2];

		const links = await ctx.db
			.query(TABLE.MENU_ITEM_OPTION_GROUPS)
			.withIndex("by_menuItem", (q) => q.eq("menuItemId", args.menuItemId))
			.collect();

		const link = links.find((l) => l.optionGroupId === args.optionGroupId);
		if (link) await ctx.db.delete(link._id);

		return [null, null];
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
