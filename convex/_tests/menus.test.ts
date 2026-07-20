import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { RESTAURANT_MEMBER_ROLE } from "../constants";
import { insertMenuForRestaurant } from "../menus";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

async function seedMenuContext(t: ReturnType<typeof convexTest>) {
	return await t.run(async (ctx) => {
		const now = Date.now();
		const orgId = await ctx.db.insert("organizations", {
			name: "Menus Org",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		const restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner-user",
			organizationId: orgId,
			name: "Menus R",
			slug: "menus-test-r",
			currency: "USD",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		await ctx.db.insert("restaurantMembers", {
			userId: "manager-user",
			restaurantId,
			organizationId: orgId,
			role: RESTAURANT_MEMBER_ROLE.MANAGER,
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		const menuId = await insertMenuForRestaurant(ctx, {
			restaurantId,
			name: "Main",
			userId: "manager-user",
		});
		return { restaurantId, menuId };
	});
}

async function seedInactiveMenuWithCategory(
	t: ReturnType<typeof convexTest>,
	restaurantId: Id<"restaurants">
) {
	return await t.run(async (ctx) => {
		const now = Date.now();
		const inactiveMenuId = await ctx.db.insert("menus", {
			restaurantId,
			name: "Draft Menu",
			isActive: false,
			displayOrder: 1,
			createdAt: now,
			updatedAt: now,
		});
		const categoryId = await ctx.db.insert("menuCategories", {
			menuId: inactiveMenuId,
			restaurantId,
			name: "Hidden",
			displayOrder: 0,
			createdAt: now,
			updatedAt: now,
		});
		const itemId = await ctx.db.insert("menuItems", {
			categoryId,
			restaurantId,
			name: "Secret Dish",
			basePrice: 500,
			isAvailable: true,
			displayOrder: 0,
			createdAt: now,
			updatedAt: now,
		});
		return { inactiveMenuId, categoryId, itemId };
	});
}

describe("public menu reads", () => {
	it("getMenusByRestaurant excludes inactive menus", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, menuId } = await seedMenuContext(t);
		const { inactiveMenuId } = await seedInactiveMenuWithCategory(t, restaurantId);

		const menus = await t.query(api.menus.getMenusByRestaurant, { restaurantId });
		expect(menus).toHaveLength(1);
		expect(menus![0]._id).toBe(menuId);
		expect(menus!.some((m) => m._id === inactiveMenuId)).toBe(false);
	});

	it("getMenuById returns null for inactive menus", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seedMenuContext(t);
		const { inactiveMenuId } = await seedInactiveMenuWithCategory(t, restaurantId);

		const menu = await t.query(api.menus.getMenuById, { menuId: inactiveMenuId });
		expect(menu).toBeNull();
	});

	it("getCategoriesByMenu returns empty for inactive menus", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seedMenuContext(t);
		const { inactiveMenuId } = await seedInactiveMenuWithCategory(t, restaurantId);

		const categories = await t.query(api.menus.getCategoriesByMenu, { menuId: inactiveMenuId });
		expect(categories).toEqual([]);
	});

	it("listForRestaurant includes inactive menus for managers", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seedMenuContext(t);
		const { inactiveMenuId } = await seedInactiveMenuWithCategory(t, restaurantId);
		const manager = t.withIdentity({ subject: "manager-user" });

		const menus = await manager.query(api.menus.listForRestaurant, { restaurantId });
		expect(menus).toHaveLength(2);
		expect(menus!.some((m) => m._id === inactiveMenuId)).toBe(true);
	});
});

describe("public menu item reads", () => {
	it("getById returns null for items on inactive menus", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seedMenuContext(t);
		const { itemId } = await seedInactiveMenuWithCategory(t, restaurantId);

		const item = await t.query(api.menuItems.getById, { itemId });
		expect(item).toBeNull();
	});

	it("getByCategory excludes unavailable items", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, menuId } = await seedMenuContext(t);
		const categoryId = await t.run(async (ctx) => {
			const now = Date.now();
			return await ctx.db.insert("menuCategories", {
				menuId,
				restaurantId,
				name: "Mains",
				displayOrder: 0,
				createdAt: now,
				updatedAt: now,
			});
		});
		await t.run(async (ctx) => {
			const now = Date.now();
			await ctx.db.insert("menuItems", {
				categoryId,
				restaurantId,
				name: "Available",
				basePrice: 1000,
				isAvailable: true,
				displayOrder: 0,
				createdAt: now,
				updatedAt: now,
			});
			await ctx.db.insert("menuItems", {
				categoryId,
				restaurantId,
				name: "Unavailable",
				basePrice: 1200,
				isAvailable: false,
				displayOrder: 1,
				createdAt: now,
				updatedAt: now,
			});
		});

		const items = await t.query(api.menuItems.getByCategory, { categoryId });
		expect(items).toHaveLength(1);
		expect(items![0].name).toBe("Available");
	});

	it("getByMenu returns every available item across all categories of the menu", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, menuId } = await seedMenuContext(t);
		await t.run(async (ctx) => {
			const now = Date.now();
			const starters = await ctx.db.insert("menuCategories", {
				menuId,
				restaurantId,
				name: "Starters",
				displayOrder: 0,
				createdAt: now,
				updatedAt: now,
			});
			const mains = await ctx.db.insert("menuCategories", {
				menuId,
				restaurantId,
				name: "Mains",
				displayOrder: 1,
				createdAt: now,
				updatedAt: now,
			});
			await ctx.db.insert("menuItems", {
				categoryId: starters,
				restaurantId,
				name: "Bruschetta",
				basePrice: 900,
				isAvailable: true,
				displayOrder: 0,
				createdAt: now,
				updatedAt: now,
			});
			await ctx.db.insert("menuItems", {
				categoryId: mains,
				restaurantId,
				name: "Risotto",
				basePrice: 1800,
				isAvailable: true,
				displayOrder: 0,
				createdAt: now,
				updatedAt: now,
			});
			await ctx.db.insert("menuItems", {
				categoryId: mains,
				restaurantId,
				name: "Sold Out",
				basePrice: 1500,
				isAvailable: false,
				displayOrder: 1,
				createdAt: now,
				updatedAt: now,
			});
		});

		const items = await t.query(api.menuItems.getByMenu, { menuId });
		expect(items!.map((i) => i.name).sort()).toEqual(["Bruschetta", "Risotto"]);
		// The client groups by categoryId, so it has to come back on each row.
		expect(items!.every((i) => typeof i.categoryId === "string")).toBe(true);
		expect(items!.every((i) => "imageUrl" in i)).toBe(true);
	});

	it("getByMenu returns empty for an inactive menu", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seedMenuContext(t);
		const { inactiveMenuId } = await seedInactiveMenuWithCategory(t, restaurantId);

		const items = await t.query(api.menuItems.getByMenu, { menuId: inactiveMenuId });
		expect(items).toEqual([]);
	});

	it("listByCategoryForStaff includes unavailable items for managers", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, menuId } = await seedMenuContext(t);
		const manager = t.withIdentity({ subject: "manager-user" });
		const categoryId = await t.run(async (ctx) => {
			const now = Date.now();
			return await ctx.db.insert("menuCategories", {
				menuId,
				restaurantId,
				name: "Mains",
				displayOrder: 0,
				createdAt: now,
				updatedAt: now,
			});
		});
		await t.run(async (ctx) => {
			const now = Date.now();
			await ctx.db.insert("menuItems", {
				categoryId,
				restaurantId,
				name: "Unavailable",
				basePrice: 1200,
				isAvailable: false,
				displayOrder: 0,
				createdAt: now,
				updatedAt: now,
			});
		});

		const items = await manager.query(api.menuItems.listByCategoryForStaff, { categoryId });
		expect(items).toHaveLength(1);
		expect(items![0].name).toBe("Unavailable");
	});
});

describe("menus.createCategory", () => {
	it("rejects whitespace-only names", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, menuId } = await seedMenuContext(t);
		const manager = t.withIdentity({ subject: "manager-user" });

		const [id, err] = await manager.mutation(api.menus.createCategory, {
			menuId,
			restaurantId,
			name: "   ",
		});

		expect(id).toBeNull();
		expect(err).toMatchObject({
			fields: [{ field: "name", message: "ERROR_MENU_CATEGORY_NAME_REQUIRED" }],
		});
	});

	it("trims and inserts a valid name", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, menuId } = await seedMenuContext(t);
		const manager = t.withIdentity({ subject: "manager-user" });

		const [id, err] = await manager.mutation(api.menus.createCategory, {
			menuId,
			restaurantId,
			name: "  Appetizers  ",
		});

		expect(err).toBeNull();
		expect(id).toBeTruthy();

		const category = await t.run(async (ctx) => ctx.db.get(id as Id<"menuCategories">));
		expect(category?.name).toBe("Appetizers");
	});
});

describe("menus.createCategories", () => {
	it("rejects when all names are empty after trim", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, menuId } = await seedMenuContext(t);
		const manager = t.withIdentity({ subject: "manager-user" });

		const [result, err] = await manager.mutation(api.menus.createCategories, {
			menuId,
			restaurantId,
			names: ["  ", "\n", ""],
		});

		expect(result).toBeNull();
		expect(err).toMatchObject({
			fields: [{ field: "names", message: "ERROR_MENU_CATEGORY_NAMES_REQUIRED" }],
		});
	});

	it("rejects a blank line mixed with valid names", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, menuId } = await seedMenuContext(t);
		const manager = t.withIdentity({ subject: "manager-user" });

		const [result, err] = await manager.mutation(api.menus.createCategories, {
			menuId,
			restaurantId,
			names: ["Appetizers", "   "],
		});

		expect(result).toBeNull();
		expect(err).toMatchObject({
			fields: [{ field: "names[1]", message: "ERROR_MENU_CATEGORY_NAME_REQUIRED" }],
		});
	});

	it("inserts multiple trimmed categories with sequential display order", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, menuId } = await seedMenuContext(t);
		const manager = t.withIdentity({ subject: "manager-user" });

		const [result, err] = await manager.mutation(api.menus.createCategories, {
			menuId,
			restaurantId,
			names: ["  Appetizers ", "Mains", "  Drinks"],
		});

		expect(err).toBeNull();
		expect(result?.ids).toHaveLength(3);

		const categories = await t.run(async (ctx) =>
			ctx.db
				.query("menuCategories")
				.withIndex("by_menu", (q) => q.eq("menuId", menuId))
				.collect()
		);
		expect(categories).toHaveLength(3);
		expect(categories.map((c) => c.name).sort()).toEqual(["Appetizers", "Drinks", "Mains"]);
		expect(categories.map((c) => c.displayOrder).sort((a, b) => a - b)).toEqual([0, 1, 2]);
	});
});
