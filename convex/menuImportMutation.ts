import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalQuery, mutation } from "./_generated/server";
import type {
	NotAuthenticatedErrorObject,
	NotAuthorizedErrorObject,
	NotFoundErrorObject,
} from "./_shared/errors";
import type { AsyncReturn } from "./_shared/types";
import { appendAuditEvent } from "./_util/audit";
import { getCurrentUserId, isAdmin, requireRestaurantManagerOrAbove } from "./_util/auth";
import { DEFAULT_PREP_STATION, TABLE } from "./constants";

type BatchInsertErrors = NotAuthenticatedErrorObject | NotAuthorizedErrorObject | NotFoundErrorObject;

// =============================================================================
// Internal query for admin check (used by the "use node" action)
// =============================================================================

export const isUserAdmin = internalQuery({
	args: { userId: v.string() },
	handler: async (ctx, args) => isAdmin(ctx, args.userId),
});

export const batchInsertMenuCategories = mutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		menuId: v.id(TABLE.MENUS),
		newMenuName: v.optional(v.string()),
		categories: v.array(
			v.object({
				name: v.string(),
				description: v.optional(v.string()),
				items: v.array(
					v.object({
						name: v.string(),
						description: v.optional(v.string()),
						priceInCents: v.number(),
					})
				),
			})
		),
	},
	handler: async (
		ctx,
		args
	): AsyncReturn<
		{ categoriesCreated: number; categoriesMerged: number; itemsCreated: number },
		BatchInsertErrors
	> => {
		const [userId, authErr] = await getCurrentUserId(ctx);
		if (authErr) return [null, authErr];

		const [, roleErr] = await requireRestaurantManagerOrAbove(ctx, userId, args.restaurantId);
		if (roleErr) return [null, roleErr];

		let menuId = args.menuId;

		if (args.newMenuName) {
			const existingMenus = await ctx.db
				.query(TABLE.MENUS)
				.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
				.collect();

			const now = Date.now();
			menuId = await ctx.db.insert(TABLE.MENUS, {
				restaurantId: args.restaurantId,
				name: args.newMenuName,
				isActive: true,
				displayOrder: existingMenus.length,
				createdAt: now,
				updatedAt: now,
				updatedBy: userId,
			});

			await appendAuditEvent(ctx, {
				aggregateType: TABLE.MENUS,
				aggregateId: menuId,
				eventType: "menus.created",
				payload: { name: args.newMenuName, source: "menu_import" },
				userId,
			});
		}

		const existingCategories = await ctx.db
			.query(TABLE.MENU_CATEGORIES)
			.withIndex("by_menu", (q) => q.eq("menuId", menuId))
			.collect();

		let categoriesCreated = 0;
		let categoriesMerged = 0;
		let itemsCreated = 0;

		const now = Date.now();

		for (const extractedCat of args.categories) {
			const matchingExisting = existingCategories.find(
				(ec) => ec.name.toLowerCase().trim() === extractedCat.name.toLowerCase().trim()
			);

			let categoryId: Id<"menuCategories">;

			if (matchingExisting) {
				categoryId = matchingExisting._id;
				categoriesMerged++;
			} else {
				categoryId = await ctx.db.insert(TABLE.MENU_CATEGORIES, {
					menuId,
					restaurantId: args.restaurantId,
					name: extractedCat.name,
					description: extractedCat.description,
					displayOrder: existingCategories.length + categoriesCreated,
					createdAt: now,
					updatedAt: now,
					updatedBy: userId,
				});

				await appendAuditEvent(ctx, {
					aggregateType: TABLE.MENU_CATEGORIES,
					aggregateId: categoryId,
					eventType: "menuCategories.created",
					payload: { name: extractedCat.name, source: "menu_import" },
					userId,
				});

				categoriesCreated++;
			}

			const existingItems = await ctx.db
				.query(TABLE.MENU_ITEMS)
				.withIndex("by_category", (q) => q.eq("categoryId", categoryId))
				.collect();

			for (const extractedItem of extractedCat.items) {
				const itemId = await ctx.db.insert(TABLE.MENU_ITEMS, {
					categoryId,
					restaurantId: args.restaurantId,
					name: extractedItem.name,
					description: extractedItem.description,
					basePrice: extractedItem.priceInCents,
					isAvailable: true,
					displayOrder: existingItems.length + itemsCreated,
					prepStation: DEFAULT_PREP_STATION,
					createdAt: now,
					updatedAt: now,
					updatedBy: userId,
				});

				await appendAuditEvent(ctx, {
					aggregateType: TABLE.MENU_ITEMS,
					aggregateId: itemId,
					eventType: "menuItems.created",
					payload: {
						name: extractedItem.name,
						prepStation: DEFAULT_PREP_STATION,
						source: "menu_import",
					},
					userId,
				});

				itemsCreated++;
			}
		}

		return [{ categoriesCreated, categoriesMerged, itemsCreated }, null];
	},
});
