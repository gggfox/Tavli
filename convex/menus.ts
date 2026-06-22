import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalQuery, mutation, query } from "./_generated/server";
import {
	NotAuthenticatedErrorObject,
	NotAuthorizedErrorObject,
	NotFoundError,
	NotFoundErrorObject,
	UserInputValidationError,
	UserInputValidationErrorObject,
} from "./_shared/errors";
import { AsyncReturn } from "./_shared/types";
import { appendAuditEvent, stampUpdated } from "./_util/audit";
import { getCurrentUserId, requireRestaurantManagerOrAbove } from "./_util/auth";
import { TABLE } from "./constants";

type AuthErrors = NotAuthenticatedErrorObject | NotAuthorizedErrorObject | NotFoundErrorObject;

const MAX_CATEGORY_NAME_LENGTH = 120;

function validateCategoryName(name: string, field = "name"): UserInputValidationErrorObject | null {
	const trimmed = name.trim();
	if (!trimmed) {
		return new UserInputValidationError({
			fields: [{ field, message: "ERROR_MENU_CATEGORY_NAME_REQUIRED" }],
		}).toObject();
	}
	if (trimmed.length > MAX_CATEGORY_NAME_LENGTH) {
		return new UserInputValidationError({
			fields: [{ field, message: "ERROR_MENU_CATEGORY_NAME_TOO_LONG" }],
		}).toObject();
	}
	return null;
}

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
	handler: async function (
		ctx,
		args
	): AsyncReturn<string, AuthErrors | UserInputValidationErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [, error2] = await requireRestaurantManagerOrAbove(ctx, userId, args.restaurantId);
		if (error2) return [null, error2];

		const nameError = validateCategoryName(args.name);
		if (nameError) return [null, nameError];
		const trimmedName = args.name.trim();

		const existing = await ctx.db
			.query(TABLE.MENU_CATEGORIES)
			.withIndex("by_menu", (q) => q.eq("menuId", args.menuId))
			.collect();

		const now = Date.now();
		const id = await ctx.db.insert(TABLE.MENU_CATEGORIES, {
			menuId: args.menuId,
			restaurantId: args.restaurantId,
			name: trimmedName,
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
			payload: { name: trimmedName },
			userId,
		});

		return [id, null];
	},
});

export const createCategories = mutation({
	args: {
		menuId: v.id(TABLE.MENUS),
		restaurantId: v.id(TABLE.RESTAURANTS),
		names: v.array(v.string()),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<{ ids: Id<"menuCategories">[] }, AuthErrors | UserInputValidationErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [, error2] = await requireRestaurantManagerOrAbove(ctx, userId, args.restaurantId);
		if (error2) return [null, error2];

		const trimmedNames = args.names.map((name) => name.trim()).filter(Boolean);
		if (trimmedNames.length === 0) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "names", message: "ERROR_MENU_CATEGORY_NAMES_REQUIRED" }],
				}).toObject(),
			];
		}

		for (let i = 0; i < args.names.length; i++) {
			const raw = args.names[i];
			if (!raw.trim()) {
				return [
					null,
					new UserInputValidationError({
						fields: [
							{
								field: `names[${i}]`,
								message: "ERROR_MENU_CATEGORY_NAME_REQUIRED",
							},
						],
					}).toObject(),
				];
			}
			const nameError = validateCategoryName(raw, `names[${i}]`);
			if (nameError) return [null, nameError];
		}

		const existing = await ctx.db
			.query(TABLE.MENU_CATEGORIES)
			.withIndex("by_menu", (q) => q.eq("menuId", args.menuId))
			.collect();

		const now = Date.now();
		const ids: Id<"menuCategories">[] = [];
		let displayOrder = existing.length;

		for (const name of trimmedNames) {
			const id = await ctx.db.insert(TABLE.MENU_CATEGORIES, {
				menuId: args.menuId,
				restaurantId: args.restaurantId,
				name,
				displayOrder,
				createdAt: now,
				updatedAt: now,
				updatedBy: userId,
			});
			displayOrder++;

			await appendAuditEvent(ctx, {
				aggregateType: TABLE.MENU_CATEGORIES,
				aggregateId: id,
				eventType: "menuCategories.created",
				payload: { name },
				userId,
			});

			ids.push(id);
		}

		return [{ ids }, null];
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

/**
 * Internal export query: returns the current menu snapshot for a restaurant
 * as five denormalized slices (Menus, Categories, Items, OptionGroups, Options).
 * No date dimension — this is a "what does the catalog look like right now"
 * export.
 */
export const internalListMenuSnapshotForExport = internalQuery({
	args: {
		actingUserId: v.string(),
		restaurantId: v.id(TABLE.RESTAURANTS),
	},
	handler: async (ctx, args) => {
		const [, aerr] = await requireRestaurantManagerOrAbove(
			ctx,
			args.actingUserId,
			args.restaurantId
		);
		if (aerr) throw new Error("Unauthorized");

		const menus = await ctx.db
			.query(TABLE.MENUS)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();

		const categories: {
			id: string;
			menuId: string;
			menuName: string;
			name: string;
			description: string;
			displayOrder: number;
		}[] = [];
		const items: {
			id: string;
			menuId: string;
			menuName: string;
			categoryId: string;
			categoryName: string;
			name: string;
			description: string;
			basePriceCents: number;
			isAvailable: boolean;
			unavailableReason: string;
			displayOrder: number;
			tags: string;
		}[] = [];

		for (const menu of menus) {
			const cats = await ctx.db
				.query(TABLE.MENU_CATEGORIES)
				.withIndex("by_menu", (q) => q.eq("menuId", menu._id))
				.collect();
			for (const cat of cats) {
				categories.push({
					id: cat._id as string,
					menuId: menu._id as string,
					menuName: menu.name,
					name: cat.name,
					description: cat.description ?? "",
					displayOrder: cat.displayOrder,
				});
				const catItems = await ctx.db
					.query(TABLE.MENU_ITEMS)
					.withIndex("by_category", (q) => q.eq("categoryId", cat._id))
					.collect();
				for (const it of catItems) {
					items.push({
						id: it._id as string,
						menuId: menu._id as string,
						menuName: menu.name,
						categoryId: cat._id as string,
						categoryName: cat.name,
						name: it.name,
						description: it.description ?? "",
						basePriceCents: it.basePrice,
						isAvailable: it.isAvailable,
						unavailableReason: it.unavailableReason ?? "",
						displayOrder: it.displayOrder,
						tags: (it.tags ?? []).join(", "),
					});
				}
			}
		}

		const optionGroups = await ctx.db
			.query(TABLE.OPTION_GROUPS)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();

		const optionGroupRows = optionGroups.map((g) => ({
			id: g._id as string,
			name: g.name,
			selectionType: g.selectionType,
			isRequired: g.isRequired,
			minSelections: g.minSelections,
			maxSelections: g.maxSelections,
			displayOrder: g.displayOrder,
		}));

		const optionRows: {
			id: string;
			optionGroupId: string;
			optionGroupName: string;
			name: string;
			priceModifierCents: number;
			isAvailable: boolean;
			displayOrder: number;
		}[] = [];
		for (const g of optionGroups) {
			const opts = await ctx.db
				.query(TABLE.OPTIONS)
				.withIndex("by_optionGroup", (q) => q.eq("optionGroupId", g._id))
				.collect();
			for (const o of opts) {
				optionRows.push({
					id: o._id as string,
					optionGroupId: g._id as string,
					optionGroupName: g.name,
					name: o.name,
					priceModifierCents: o.priceModifier,
					isAvailable: o.isAvailable,
					displayOrder: o.displayOrder,
				});
			}
		}

		return {
			menus: menus.map((m) => ({
				id: m._id as string,
				name: m.name,
				description: m.description ?? "",
				isActive: m.isActive,
				displayOrder: m.displayOrder,
				defaultLanguage: m.defaultLanguage ?? "",
				supportedLanguages: (m.supportedLanguages ?? []).join(", "),
			})),
			categories,
			items,
			optionGroups: optionGroupRows,
			options: optionRows,
		};
	},
});
