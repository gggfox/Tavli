import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
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

/** Insert a menu row + audit; used by `restaurants.create` and admin backfills. */
export async function insertMenuForRestaurant(
	ctx: MutationCtx,
	args: {
		restaurantId: Id<"restaurants">;
		name: string;
		userId: string;
		description?: string;
		defaultLanguage?: string;
		supportedLanguages?: string[];
	}
): Promise<Id<"menus">> {
	const existing = await ctx.db
		.query(TABLE.MENUS)
		.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
		.collect();

	const now = Date.now();
	const id = await ctx.db.insert(TABLE.MENUS, {
		restaurantId: args.restaurantId,
		name: args.name,
		description: args.description,
		defaultLanguage: args.defaultLanguage,
		supportedLanguages: args.supportedLanguages,
		isActive: true,
		displayOrder: existing.length,
		createdAt: now,
		updatedAt: now,
		updatedBy: args.userId,
	});

	await appendAuditEvent(ctx, {
		aggregateType: TABLE.MENUS,
		aggregateId: id,
		eventType: "menus.created",
		payload: { name: args.name },
		userId: args.userId,
	});

	return id;
}

// ============================================================================
// Menu CRUD
// ============================================================================

export const updateMenu = mutation({
	args: {
		menuId: v.id(TABLE.MENUS),
		name: v.optional(v.string()),
		description: v.optional(v.string()),
		isActive: v.optional(v.boolean()),
		displayOrder: v.optional(v.number()),
		defaultLanguage: v.optional(v.string()),
		supportedLanguages: v.optional(v.array(v.string())),
	},
	handler: async function (ctx, args): AsyncReturn<string, AuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const menu = await ctx.db.get(args.menuId);
		if (!menu) return [null, new NotFoundError("Menu not found").toObject()];

		const [, error2] = await requireRestaurantManagerOrAbove(ctx, userId, menu.restaurantId);
		if (error2) return [null, error2];

		await ctx.db.patch(args.menuId, {
			...(args.name !== undefined && { name: args.name }),
			...(args.description !== undefined && { description: args.description }),
			...(args.isActive !== undefined && { isActive: args.isActive }),
			...(args.displayOrder !== undefined && { displayOrder: args.displayOrder }),
			...(args.defaultLanguage !== undefined && { defaultLanguage: args.defaultLanguage }),
			...(args.supportedLanguages !== undefined && { supportedLanguages: args.supportedLanguages }),
			...stampUpdated(userId),
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.MENUS,
			aggregateId: args.menuId,
			eventType: "menus.updated",
			payload: args,
			userId,
		});

		return [args.menuId, null];
	},
});

export const deleteMenu = mutation({
	args: { menuId: v.id(TABLE.MENUS) },
	handler: async function (ctx, args): AsyncReturn<null, AuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const menu = await ctx.db.get(args.menuId);
		if (!menu) return [null, new NotFoundError("Menu not found").toObject()];

		const [, error2] = await requireRestaurantManagerOrAbove(ctx, userId, menu.restaurantId);
		if (error2) return [null, error2];

		const categories = await ctx.db
			.query(TABLE.MENU_CATEGORIES)
			.withIndex("by_menu", (q) => q.eq("menuId", args.menuId))
			.collect();

		for (const category of categories) {
			const items = await ctx.db
				.query(TABLE.MENU_ITEMS)
				.withIndex("by_category", (q) => q.eq("categoryId", category._id))
				.collect();
			for (const item of items) {
				const links = await ctx.db
					.query(TABLE.MENU_ITEM_OPTION_GROUPS)
					.withIndex("by_menuItem", (q) => q.eq("menuItemId", item._id))
					.collect();
				for (const link of links) await ctx.db.delete(link._id);
				await ctx.db.delete(item._id);
			}
			await ctx.db.delete(category._id);
		}

		await ctx.db.delete(args.menuId);
		await appendAuditEvent(ctx, {
			aggregateType: TABLE.MENUS,
			aggregateId: args.menuId,
			eventType: "menus.deleted",
			payload: {},
			userId,
		});
		return [null, null];
	},
});

export const setMenuTranslation = mutation({
	args: {
		menuId: v.id(TABLE.MENUS),
		lang: v.string(),
		name: v.optional(v.string()),
		description: v.optional(v.string()),
	},
	handler: async function (ctx, args): AsyncReturn<string, AuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const menu = await ctx.db.get(args.menuId);
		if (!menu) return [null, new NotFoundError("Menu not found").toObject()];

		const [, error2] = await requireRestaurantManagerOrAbove(ctx, userId, menu.restaurantId);
		if (error2) return [null, error2];

		const translations = { ...menu.translations };
		translations[args.lang] = {
			...translations[args.lang],
			...(args.name !== undefined && { name: args.name }),
			...(args.description !== undefined && { description: args.description }),
		};

		await ctx.db.patch(args.menuId, { translations, ...stampUpdated(userId) });
		await appendAuditEvent(ctx, {
			aggregateType: TABLE.MENUS,
			aggregateId: args.menuId,
			eventType: "menus.translation_set",
			payload: { lang: args.lang },
			userId,
		});
		return [args.menuId, null];
	},
});

export const getMenuById = query({
	args: { menuId: v.id(TABLE.MENUS) },
	handler: async (ctx, args) => {
		return await ctx.db.get(args.menuId);
	},
});

export const getMenusByRestaurant = query({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async (ctx, args) => {
		return await ctx.db
			.query(TABLE.MENUS)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();
	},
});

// ============================================================================
// Category CRUD
// ============================================================================

export const createCategory = mutation({
	args: {
		menuId: v.id(TABLE.MENUS),
		restaurantId: v.id(TABLE.RESTAURANTS),
		name: v.string(),
		description: v.optional(v.string()),
	},
	handler: async function (ctx, args): AsyncReturn<string, AuthErrors> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [, error2] = await requireRestaurantManagerOrAbove(ctx, userId, args.restaurantId);
		if (error2) return [null, error2];

		const existing = await ctx.db
			.query(TABLE.MENU_CATEGORIES)
			.withIndex("by_menu", (q) => q.eq("menuId", args.menuId))
			.collect();

		const now = Date.now();
		const id = await ctx.db.insert(TABLE.MENU_CATEGORIES, {
			menuId: args.menuId,
			restaurantId: args.restaurantId,
			name: args.name,
			description: args.description,
			displayOrder: existing.length,
			createdAt: now,
			updatedAt: now,
			updatedBy: userId,
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.MENU_CATEGORIES,
			aggregateId: id,
			eventType: "menuCategories.created",
			payload: { name: args.name },
			userId,
		});

		return [id, null];
	},
});

export const updateCategory = mutation({
	args: {
		categoryId: v.id(TABLE.MENU_CATEGORIES),
		name: v.optional(v.string()),
		description: v.optional(v.string()),
		displayOrder: v.optional(v.number()),
	},
	handler: async function (ctx, args): AsyncReturn<string, AuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const category = await ctx.db.get(args.categoryId);
		if (!category) return [null, new NotFoundError("Category not found").toObject()];

		const [, error2] = await requireRestaurantManagerOrAbove(ctx, userId, category.restaurantId);
		if (error2) return [null, error2];

		await ctx.db.patch(args.categoryId, {
			...(args.name !== undefined && { name: args.name }),
			...(args.description !== undefined && { description: args.description }),
			...(args.displayOrder !== undefined && { displayOrder: args.displayOrder }),
			...stampUpdated(userId),
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.MENU_CATEGORIES,
			aggregateId: args.categoryId,
			eventType: "menuCategories.updated",
			payload: args,
			userId,
		});

		return [args.categoryId, null];
	},
});

export const deleteCategory = mutation({
	args: { categoryId: v.id(TABLE.MENU_CATEGORIES) },
	handler: async function (ctx, args): AsyncReturn<null, AuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const category = await ctx.db.get(args.categoryId);
		if (!category) return [null, new NotFoundError("Category not found").toObject()];

		const [, error2] = await requireRestaurantManagerOrAbove(ctx, userId, category.restaurantId);
		if (error2) return [null, error2];

		const items = await ctx.db
			.query(TABLE.MENU_ITEMS)
			.withIndex("by_category", (q) => q.eq("categoryId", args.categoryId))
			.collect();

		for (const item of items) {
			const links = await ctx.db
				.query(TABLE.MENU_ITEM_OPTION_GROUPS)
				.withIndex("by_menuItem", (q) => q.eq("menuItemId", item._id))
				.collect();
			for (const link of links) await ctx.db.delete(link._id);
			await ctx.db.delete(item._id);
		}

		await ctx.db.delete(args.categoryId);
		return [null, null];
	},
});

export const setCategoryTranslation = mutation({
	args: {
		categoryId: v.id(TABLE.MENU_CATEGORIES),
		lang: v.string(),
		name: v.optional(v.string()),
		description: v.optional(v.string()),
	},
	handler: async function (ctx, args): AsyncReturn<string, AuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const category = await ctx.db.get(args.categoryId);
		if (!category) return [null, new NotFoundError("Category not found").toObject()];

		const [, error2] = await requireRestaurantManagerOrAbove(ctx, userId, category.restaurantId);
		if (error2) return [null, error2];

		const translations = { ...category.translations };
		translations[args.lang] = {
			...translations[args.lang],
			...(args.name !== undefined && { name: args.name }),
			...(args.description !== undefined && { description: args.description }),
		};

		await ctx.db.patch(args.categoryId, { translations, ...stampUpdated(userId) });
		await appendAuditEvent(ctx, {
			aggregateType: TABLE.MENU_CATEGORIES,
			aggregateId: args.categoryId,
			eventType: "menuCategories.translation_set",
			payload: { lang: args.lang },
			userId,
		});
		return [args.categoryId, null];
	},
});

export const getCategoriesByMenu = query({
	args: { menuId: v.id(TABLE.MENUS) },
	handler: async (ctx, args) => {
		return await ctx.db
			.query(TABLE.MENU_CATEGORIES)
			.withIndex("by_menu", (q) => q.eq("menuId", args.menuId))
			.collect();
	},
});
