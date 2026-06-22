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
