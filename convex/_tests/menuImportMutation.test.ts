import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { RESTAURANT_MEMBER_ROLE, USER_ROLES } from "../constants";
import { insertMenuForRestaurant } from "../menus";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

async function seedRestaurantWithMembers(t: ReturnType<typeof convexTest>) {
	let organizationId: Id<"organizations">;
	let restaurantId: Id<"restaurants">;

	await t.run(async (ctx) => {
		const now = Date.now();
		organizationId = await ctx.db.insert("organizations", {
			name: "Import Test Org",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner-user",
			name: "Import Test Restaurant",
			slug: "import-test",
			currency: "USD",
			organizationId,
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		await ctx.db.insert("restaurantMembers", {
			userId: "manager-user",
			restaurantId,
			organizationId,
			role: RESTAURANT_MEMBER_ROLE.MANAGER,
			isActive: true,
			addedBy: "owner-user",
			createdAt: now,
			updatedAt: now,
		});
		await ctx.db.insert("restaurantMembers", {
			userId: "employee-user",
			restaurantId,
			organizationId,
			role: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
			isActive: true,
			addedBy: "owner-user",
			createdAt: now,
			updatedAt: now,
		});
		await ctx.db.insert("userRoles", {
			userId: "owner-user",
			roles: [USER_ROLES.OWNER],
			organizationId,
			createdAt: now,
			updatedAt: now,
		});
	});

	return { organizationId: organizationId!, restaurantId: restaurantId! };
}

describe("menuImportMutation.verifyMenuImportAccess", () => {
	it("allows restaurant managers", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seedRestaurantWithMembers(t);

		const result = await t.query(internal.menuImportMutation.verifyMenuImportAccess, {
			userId: "manager-user",
			restaurantId,
		});

		expect(result).toEqual({ allowed: true, errorMessage: undefined });
	});

	it("allows org owners without explicit restaurant membership", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seedRestaurantWithMembers(t);

		const result = await t.query(internal.menuImportMutation.verifyMenuImportAccess, {
			userId: "owner-user",
			restaurantId,
		});

		expect(result).toEqual({ allowed: true, errorMessage: undefined });
	});

	it("denies restaurant employees", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seedRestaurantWithMembers(t);

		const result = await t.query(internal.menuImportMutation.verifyMenuImportAccess, {
			userId: "employee-user",
			restaurantId,
		});

		expect(result.allowed).toBe(false);
		expect(result.errorMessage).toBeTruthy();
	});

	it("denies unrelated authenticated users", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seedRestaurantWithMembers(t);

		const result = await t.query(internal.menuImportMutation.verifyMenuImportAccess, {
			userId: "stranger-user",
			restaurantId,
		});

		expect(result.allowed).toBe(false);
	});
});

describe("menuImportMutation.batchInsertMenuCategories", () => {
	const categories = [
		{
			name: "Starters",
			items: [{ name: "Bruschetta", priceInCents: 900 }],
		},
	];

	it("creates the menu when the restaurant has none yet", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seedRestaurantWithMembers(t);
		const manager = t.withIdentity({ subject: "manager-user" });

		const [result, err] = await manager.mutation(api.menuImportMutation.batchInsertMenuCategories, {
			restaurantId,
			newMenuName: "  Imported Menu  ",
			categories,
		});

		expect(err).toBeNull();
		expect(result).toMatchObject({ categoriesCreated: 1, categoriesMerged: 0, itemsCreated: 1 });

		const menus = await t.run(async (ctx) =>
			ctx.db
				.query("menus")
				.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
				.collect()
		);
		expect(menus).toHaveLength(1);
		expect(menus[0]).toMatchObject({ name: "Imported Menu", isActive: true, displayOrder: 0 });

		const items = await t.run(async (ctx) =>
			ctx.db
				.query("menuItems")
				.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
				.collect()
		);
		expect(items.map((item) => item.name)).toEqual(["Bruschetta"]);
	});

	it("rejects an import with neither a target menu nor a new menu name", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seedRestaurantWithMembers(t);
		const manager = t.withIdentity({ subject: "manager-user" });

		const [result, err] = await manager.mutation(api.menuImportMutation.batchInsertMenuCategories, {
			restaurantId,
			categories,
		});

		expect(result).toBeNull();
		expect(err).toMatchObject({
			fields: [{ field: "menuId", message: "ERROR_MENU_IMPORT_TARGET_REQUIRED" }],
		});
	});

	it("imports into an existing menu when one is given", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seedRestaurantWithMembers(t);
		const menuId = await t.run(async (ctx) =>
			insertMenuForRestaurant(ctx, { restaurantId, name: "Main", userId: "manager-user" })
		);
		const manager = t.withIdentity({ subject: "manager-user" });

		const [result, err] = await manager.mutation(api.menuImportMutation.batchInsertMenuCategories, {
			restaurantId,
			menuId,
			categories,
		});

		expect(err).toBeNull();
		expect(result).toMatchObject({ categoriesCreated: 1 });

		const menus = await t.run(async (ctx) =>
			ctx.db
				.query("menus")
				.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
				.collect()
		);
		expect(menus).toHaveLength(1);

		const cats = await t.run(async (ctx) =>
			ctx.db
				.query("menuCategories")
				.withIndex("by_menu", (q) => q.eq("menuId", menuId))
				.collect()
		);
		expect(cats.map((c) => c.name)).toEqual(["Starters"]);
	});
});
