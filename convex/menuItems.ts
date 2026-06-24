import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
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
import { DEFAULT_PREP_STATION, TABLE } from "./constants";
import { PREP_STATION_VALIDATOR } from "./orderHelpers";

type AuthErrors = NotAuthenticatedErrorObject | NotAuthorizedErrorObject | NotFoundErrorObject;

export const generateUploadUrl = mutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
	},
	handler: async function (ctx, args): AsyncReturn<string, AuthErrors> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [, error2] = await requireRestaurantManagerOrAbove(ctx, userId, args.restaurantId);
		if (error2) return [null, error2];

		const url = await ctx.storage.generateUploadUrl();
		return [url, null];
	},
});

export const create = mutation({
	args: {
		categoryId: v.id(TABLE.MENU_CATEGORIES),
		restaurantId: v.id(TABLE.RESTAURANTS),
		name: v.string(),
		description: v.optional(v.string()),
		basePrice: v.number(),
		imageStorageId: v.optional(v.id("_storage")),
		tags: v.optional(v.array(v.string())),
		availableDays: v.optional(v.array(v.number())),
		// Optional in args because callers (forms, scripts) may want to fall
		// back to DEFAULT_PREP_STATION; always written to the DB so new rows
		// never need backfilling.
		prepStation: v.optional(PREP_STATION_VALIDATOR),
	},
	handler: async function (ctx, args): AsyncReturn<string, AuthErrors> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [, error2] = await requireRestaurantManagerOrAbove(ctx, userId, args.restaurantId);
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
			imageStorageId: args.imageStorageId,
			isAvailable: true,
			availableDays: args.availableDays,
			displayOrder: existing.length,
			tags: args.tags,
			prepStation: args.prepStation ?? DEFAULT_PREP_STATION,
			createdAt: now,
			updatedAt: now,
			updatedBy: userId,
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.MENU_ITEMS,
			aggregateId: id,
			eventType: "menuItems.created",
			payload: { name: args.name, prepStation: args.prepStation ?? DEFAULT_PREP_STATION },
			userId,
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
		imageStorageId: v.optional(v.id("_storage")),
		tags: v.optional(v.array(v.string())),
		displayOrder: v.optional(v.number()),
		availableDays: v.optional(v.array(v.number())),
		prepStation: v.optional(PREP_STATION_VALIDATOR),
	},
	handler: async function (ctx, args): AsyncReturn<string, AuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const item = await ctx.db.get(args.itemId);
		if (!item) return [null, new NotFoundError("Menu item not found").toObject()];

		const [, error2] = await requireRestaurantManagerOrAbove(ctx, userId, item.restaurantId);
		if (error2) return [null, error2];

		if (args.imageStorageId !== undefined && item.imageStorageId) {
			await ctx.storage.delete(item.imageStorageId);
		}

		await ctx.db.patch(args.itemId, {
			...(args.name !== undefined && { name: args.name }),
			...(args.description !== undefined && { description: args.description }),
			...(args.basePrice !== undefined && { basePrice: args.basePrice }),
			...(args.imageStorageId !== undefined && { imageStorageId: args.imageStorageId }),
			...(args.tags !== undefined && { tags: args.tags }),
			...(args.displayOrder !== undefined && { displayOrder: args.displayOrder }),
			...(args.availableDays !== undefined && { availableDays: args.availableDays }),
			...(args.prepStation !== undefined && { prepStation: args.prepStation }),
			...stampUpdated(userId),
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.MENU_ITEMS,
			aggregateId: args.itemId,
			eventType: "menuItems.updated",
			payload: args,
			userId,
		});

		return [args.itemId, null];
	},
});

export const remove = mutation({
	args: { itemId: v.id(TABLE.MENU_ITEMS) },
	handler: async function (ctx, args): AsyncReturn<null, AuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const item = await ctx.db.get(args.itemId);
		if (!item) return [null, new NotFoundError("Menu item not found").toObject()];

		const [, error2] = await requireRestaurantManagerOrAbove(ctx, userId, item.restaurantId);
		if (error2) return [null, error2];

		if (item.imageStorageId) {
			await ctx.storage.delete(item.imageStorageId);
		}

		const links = await ctx.db
			.query(TABLE.MENU_ITEM_OPTION_GROUPS)
			.withIndex("by_menuItem", (q) => q.eq("menuItemId", args.itemId))
			.collect();
		for (const link of links) await ctx.db.delete(link._id);

		await ctx.db.delete(args.itemId);
		await appendAuditEvent(ctx, {
			aggregateType: TABLE.MENU_ITEMS,
			aggregateId: args.itemId,
			eventType: "menuItems.deleted",
			payload: {},
			userId,
		});
		return [null, null];
	},
});

export const removeImage = mutation({
	args: { itemId: v.id(TABLE.MENU_ITEMS) },
	handler: async function (ctx, args): AsyncReturn<null, AuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const item = await ctx.db.get(args.itemId);
		if (!item) return [null, new NotFoundError("Menu item not found").toObject()];

		const [, error2] = await requireRestaurantManagerOrAbove(ctx, userId, item.restaurantId);
		if (error2) return [null, error2];

		if (item.imageStorageId) {
			await ctx.storage.delete(item.imageStorageId);
		}

		await ctx.db.patch(args.itemId, {
			imageStorageId: undefined,
			...stampUpdated(userId),
		});

		return [null, null];
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

		const item = await ctx.db.get(args.itemId);
		if (!item) return [null, new NotFoundError("Menu item not found").toObject()];

		const [, error2] = await requireRestaurantManagerOrAbove(ctx, userId, item.restaurantId);
		if (error2) return [null, error2];

		const newState = !item.isAvailable;
		await ctx.db.patch(args.itemId, {
			isAvailable: newState,
			unavailableReason: newState ? undefined : args.unavailableReason,
			...stampUpdated(userId),
		});

		return [newState, null];
	},
});

export const bulkRemove = mutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		itemIds: v.array(v.id(TABLE.MENU_ITEMS)),
	},
	handler: async function (ctx, args): AsyncReturn<number, AuthErrors> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const [, error2] = await requireRestaurantManagerOrAbove(ctx, userId, args.restaurantId);
		if (error2) return [null, error2];

		const unique = [...new Set(args.itemIds)];
		let removed = 0;
		for (const itemId of unique) {
			const item = await ctx.db.get(itemId);
			if (!item || item.restaurantId !== args.restaurantId) continue;

			if (item.imageStorageId) {
				await ctx.storage.delete(item.imageStorageId);
			}

			const links = await ctx.db
				.query(TABLE.MENU_ITEM_OPTION_GROUPS)
				.withIndex("by_menuItem", (q) => q.eq("menuItemId", itemId))
				.collect();
			for (const link of links) await ctx.db.delete(link._id);

			await ctx.db.delete(itemId);
			await appendAuditEvent(ctx, {
				aggregateType: TABLE.MENU_ITEMS,
				aggregateId: itemId,
				eventType: "menuItems.deleted",
				payload: {},
				userId,
			});
			removed++;
		}

		return [removed, null];
	},
});

export const bulkSetAvailability = mutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		itemIds: v.array(v.id(TABLE.MENU_ITEMS)),
		isAvailable: v.boolean(),
		unavailableReason: v.optional(v.string()),
	},
	handler: async function (ctx, args): AsyncReturn<number, AuthErrors> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const [, error2] = await requireRestaurantManagerOrAbove(ctx, userId, args.restaurantId);
		if (error2) return [null, error2];

		const unique = [...new Set(args.itemIds)];
		let updated = 0;
		for (const itemId of unique) {
			const item = await ctx.db.get(itemId);
			if (!item || item.restaurantId !== args.restaurantId) continue;

			await ctx.db.patch(itemId, {
				isAvailable: args.isAvailable,
				unavailableReason: args.isAvailable ? undefined : args.unavailableReason,
				...stampUpdated(userId),
			});
			await appendAuditEvent(ctx, {
				aggregateType: TABLE.MENU_ITEMS,
				aggregateId: itemId,
				eventType: "menuItems.updated",
				payload: { isAvailable: args.isAvailable },
				userId,
			});
			updated++;
		}

		return [updated, null];
	},
});

/**
 * Bulk-assign a prep station to multiple menu items in one go. Used by
 * the per-category bulk action in `CategorySection` so a manager can flip
 * an entire bar category from the default Kitchen to Bar without editing
 * each item. Mirrors `bulkSetAvailability`.
 */
export const bulkSetPrepStation = mutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		itemIds: v.array(v.id(TABLE.MENU_ITEMS)),
		prepStation: PREP_STATION_VALIDATOR,
	},
	handler: async function (ctx, args): AsyncReturn<number, AuthErrors> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const [, error2] = await requireRestaurantManagerOrAbove(ctx, userId, args.restaurantId);
		if (error2) return [null, error2];

		const unique = [...new Set(args.itemIds)];
		let updated = 0;
		for (const itemId of unique) {
			const item = await ctx.db.get(itemId);
			if (!item || item.restaurantId !== args.restaurantId) continue;

			await ctx.db.patch(itemId, {
				prepStation: args.prepStation,
				...stampUpdated(userId),
			});
			await appendAuditEvent(ctx, {
				aggregateType: TABLE.MENU_ITEMS,
				aggregateId: itemId,
				eventType: "menuItems.updated",
				payload: { prepStation: args.prepStation },
				userId,
			});
			updated++;
		}

		return [updated, null];
	},
});

async function resolveImageUrls<T extends { imageStorageId?: unknown }>(
	ctx: { storage: { getUrl: (id: unknown) => Promise<string | null> } },
	items: T[]
): Promise<(T & { imageUrl: string | null })[]> {
	return Promise.all(
		items.map(async (item) => ({
			...item,
			imageUrl: item.imageStorageId ? await ctx.storage.getUrl(item.imageStorageId as never) : null,
		}))
	);
}

async function isCategoryOnActiveMenu(
	ctx: QueryCtx,
	categoryId: Id<"menuCategories">
): Promise<boolean> {
	const category = await ctx.db.get(categoryId);
	if (!category) return false;
	const menu = await ctx.db.get(category.menuId);
	return menu?.isActive === true;
}

async function filterPublicMenuItems<
	T extends { isAvailable: boolean; categoryId: Id<"menuCategories"> },
>(ctx: QueryCtx, items: T[]): Promise<T[]> {
	const available = items.filter((item) => item.isAvailable);
	const visible: T[] = [];
	for (const item of available) {
		if (await isCategoryOnActiveMenu(ctx, item.categoryId)) {
			visible.push(item);
		}
	}
	return visible;
}

export const setTranslation = mutation({
	args: {
		itemId: v.id(TABLE.MENU_ITEMS),
		lang: v.string(),
		name: v.optional(v.string()),
		description: v.optional(v.string()),
	},
	handler: async function (ctx, args): AsyncReturn<string, AuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const item = await ctx.db.get(args.itemId);
		if (!item) return [null, new NotFoundError("Menu item not found").toObject()];

		const [, error2] = await requireRestaurantManagerOrAbove(ctx, userId, item.restaurantId);
		if (error2) return [null, error2];

		const translations = { ...item.translations };
		translations[args.lang] = {
			...translations[args.lang],
			...(args.name !== undefined && { name: args.name }),
			...(args.description !== undefined && { description: args.description }),
		};

		await ctx.db.patch(args.itemId, { translations, ...stampUpdated(userId) });
		await appendAuditEvent(ctx, {
			aggregateType: TABLE.MENU_ITEMS,
			aggregateId: args.itemId,
			eventType: "menuItems.translation_set",
			payload: { lang: args.lang },
			userId,
		});
		return [args.itemId, null];
	},
});

/** Public read: available items on active menus only. */
export const getById = query({
	args: { itemId: v.id(TABLE.MENU_ITEMS) },
	handler: async (ctx, args) => {
		const item = await ctx.db.get(args.itemId);
		if (!item?.isAvailable) return null;
		if (!(await isCategoryOnActiveMenu(ctx, item.categoryId))) return null;
		const [resolved] = await resolveImageUrls(ctx, [item]);
		return resolved;
	},
});

/** Public read: available items on active menus only. */
export const getByCategory = query({
	args: { categoryId: v.id(TABLE.MENU_CATEGORIES) },
	handler: async (ctx, args) => {
		if (!(await isCategoryOnActiveMenu(ctx, args.categoryId))) return [];

		const items = await ctx.db
			.query(TABLE.MENU_ITEMS)
			.withIndex("by_category", (q) => q.eq("categoryId", args.categoryId))
			.collect();
		return resolveImageUrls(
			ctx,
			items.filter((item) => item.isAvailable)
		);
	},
});

/** Public read: available items on active menus only. */
export const getByRestaurant = query({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async (ctx, args) => {
		const items = await ctx.db
			.query(TABLE.MENU_ITEMS)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();
		const visible = await filterPublicMenuItems(ctx, items);
		return resolveImageUrls(ctx, visible);
	},
});

/** Staff read: any item by id, including unavailable. */
export const getByIdForStaff = query({
	args: { itemId: v.id(TABLE.MENU_ITEMS) },
	handler: async (ctx, args) => {
		const item = await ctx.db.get(args.itemId);
		if (!item) return null;

		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return null;
		const [, error2] = await requireRestaurantManagerOrAbove(ctx, userId, item.restaurantId);
		if (error2) return null;

		const [resolved] = await resolveImageUrls(ctx, [item]);
		return resolved;
	},
});

/** Staff read: all items in a category, including unavailable. */
export const listByCategoryForStaff = query({
	args: { categoryId: v.id(TABLE.MENU_CATEGORIES) },
	handler: async (ctx, args) => {
		const category = await ctx.db.get(args.categoryId);
		if (!category) return [];

		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [];
		const [, error2] = await requireRestaurantManagerOrAbove(ctx, userId, category.restaurantId);
		if (error2) return [];

		const items = await ctx.db
			.query(TABLE.MENU_ITEMS)
			.withIndex("by_category", (q) => q.eq("categoryId", args.categoryId))
			.collect();
		return resolveImageUrls(ctx, items);
	},
});

/** Staff read: all items for a restaurant, including unavailable. */
export const listByRestaurantForStaff = query({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async (ctx, args) => {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [];
		const [, error2] = await requireRestaurantManagerOrAbove(ctx, userId, args.restaurantId);
		if (error2) return [];

		const items = await ctx.db
			.query(TABLE.MENU_ITEMS)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();
		return resolveImageUrls(ctx, items);
	},
});
