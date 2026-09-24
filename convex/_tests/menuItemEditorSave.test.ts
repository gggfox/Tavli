/**
 * `menuItems.update` as the menu editor's single Guardar: item fields,
 * visibility and the item's option groups commit in one mutation.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { TABLE } from "../constants";
import { registerDisputeComponents } from "./_fixtures/disputeComponents.fixture";

const modules = import.meta.glob("../**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerDisputeComponents(t);
	return t;
}
type T = ReturnType<typeof setup>;

const NOW = Date.UTC(2026, 8, 24, 12, 0, 0);
const MANAGER = "user_manager";

async function insertRestaurant(t: T, slug: string) {
	return t.run(async (ctx) => {
		const organizationId = await ctx.db.insert(TABLE.ORGANIZATIONS, {
			name: `Org ${slug}`,
			slug: `org-${slug}`,
			isActive: true,
			createdAt: NOW,
			updatedAt: NOW,
		});
		const restaurantId = await ctx.db.insert(TABLE.RESTAURANTS, {
			ownerId: "owner-1",
			organizationId,
			name: slug,
			slug,
			currency: "MXN",
			isActive: true,
			createdAt: NOW,
			updatedAt: NOW,
		});
		return { organizationId, restaurantId };
	});
}

async function seed(t: T) {
	const { organizationId, restaurantId } = await insertRestaurant(t, "vernaculo");
	const other = await insertRestaurant(t, "otro");
	return t.run(async (ctx) => {
		await ctx.db.insert(TABLE.RESTAURANT_MEMBERS, {
			userId: MANAGER,
			restaurantId,
			organizationId,
			role: "manager",
			isActive: true,
			createdAt: NOW,
			updatedAt: NOW,
		});
		const menuId = await ctx.db.insert(TABLE.MENUS, {
			restaurantId,
			name: "Main",
			translations: {},
			isActive: true,
			displayOrder: 0,
			createdAt: NOW,
			updatedAt: NOW,
		});
		const categoryId = await ctx.db.insert(TABLE.MENU_CATEGORIES, {
			menuId,
			restaurantId,
			name: "Carnes",
			translations: {},
			displayOrder: 0,
			createdAt: NOW,
			updatedAt: NOW,
		});
		const menuItemId = await ctx.db.insert(TABLE.MENU_ITEMS, {
			categoryId,
			restaurantId,
			name: "Rib eye",
			translations: {},
			basePrice: 100000,
			isAvailable: false,
			unavailableReason: "Sin existencias",
			displayOrder: 0,
			createdAt: NOW,
			updatedAt: NOW,
		});
		const group = (rid: Id<"restaurants">, name: string, displayOrder: number) =>
			ctx.db.insert(TABLE.OPTION_GROUPS, {
				restaurantId: rid,
				name,
				selectionType: "single",
				isRequired: false,
				minSelections: 0,
				maxSelections: 1,
				displayOrder,
				createdAt: NOW,
				updatedAt: NOW,
			});
		const termino = await group(restaurantId, "Termino", 0);
		const guarnicion = await group(restaurantId, "Guarnición", 1);
		const tamano = await group(restaurantId, "Tamaño", 2);
		const foreign = await group(other.restaurantId, "Ajena", 0);
		await ctx.db.insert(TABLE.MENU_ITEM_OPTION_GROUPS, {
			menuItemId,
			optionGroupId: termino,
			restaurantId,
			displayOrder: 0,
		});
		await ctx.db.insert(TABLE.MENU_ITEM_OPTION_GROUPS, {
			menuItemId,
			optionGroupId: guarnicion,
			restaurantId,
			displayOrder: 1,
		});
		return { restaurantId, menuItemId, termino, guarnicion, tamano, foreign };
	});
}

const asManager = (t: T) => t.withIdentity({ subject: MANAGER });

async function links(t: T, menuItemId: Id<"menuItems">) {
	return t.run(async (ctx) => {
		const rows = await ctx.db
			.query(TABLE.MENU_ITEM_OPTION_GROUPS)
			.withIndex("by_menuItem", (q) => q.eq("menuItemId", menuItemId))
			.collect();
		return rows
			.sort((a, b) => a.displayOrder - b.displayOrder)
			.map((r) => ({ id: r.optionGroupId, order: r.displayOrder }));
	});
}

describe("menuItems.update as the editor's Guardar", () => {
	it("replaces the option-group set in the given order, keeping unchanged links", async () => {
		const t = setup();
		const ids = await seed(t);
		const before = await t.run(async (ctx) =>
			ctx.db
				.query(TABLE.MENU_ITEM_OPTION_GROUPS)
				.withIndex("by_menuItem", (q) => q.eq("menuItemId", ids.menuItemId))
				.collect()
		);
		const guarnicionLink = before.find((l) => l.optionGroupId === ids.guarnicion)!._id;

		const [, error] = await asManager(t).mutation(api.menuItems.update, {
			itemId: ids.menuItemId,
			name: "Rib eye 400g",
			optionGroupIds: [ids.tamano, ids.guarnicion],
		});

		expect(error).toBeNull();
		expect(await links(t, ids.menuItemId)).toEqual([
			{ id: ids.tamano, order: 0 },
			{ id: ids.guarnicion, order: 1 },
		]);
		// The kept link is re-ordered in place, not deleted and re-inserted.
		const kept = await t.run(async (ctx) => ctx.db.get(guarnicionLink));
		expect(kept?.displayOrder).toBe(1);
		const item = await t.run(async (ctx) => ctx.db.get(ids.menuItemId));
		expect(item?.name).toBe("Rib eye 400g");
	});

	it("an empty list removes every option group", async () => {
		const t = setup();
		const ids = await seed(t);
		const [, error] = await asManager(t).mutation(api.menuItems.update, {
			itemId: ids.menuItemId,
			optionGroupIds: [],
		});
		expect(error).toBeNull();
		expect(await links(t, ids.menuItemId)).toEqual([]);
	});

	it("leaves option groups alone when optionGroupIds is omitted", async () => {
		const t = setup();
		const ids = await seed(t);
		await asManager(t).mutation(api.menuItems.update, { itemId: ids.menuItemId, name: "X" });
		expect(await links(t, ids.menuItemId)).toEqual([
			{ id: ids.termino, order: 0 },
			{ id: ids.guarnicion, order: 1 },
		]);
	});

	it("rejects another restaurant's option group and writes nothing", async () => {
		const t = setup();
		const ids = await seed(t);
		const [, error] = await asManager(t).mutation(api.menuItems.update, {
			itemId: ids.menuItemId,
			name: "Should not stick",
			optionGroupIds: [ids.tamano, ids.foreign],
		});

		expect(error?.name).toBe("NOT_FOUND");
		const item = await t.run(async (ctx) => ctx.db.get(ids.menuItemId));
		expect(item?.name).toBe("Rib eye");
		expect(await links(t, ids.menuItemId)).toEqual([
			{ id: ids.termino, order: 0 },
			{ id: ids.guarnicion, order: 1 },
		]);
	});

	it("showing an item clears its unavailable reason; hiding keeps fields intact", async () => {
		const t = setup();
		const ids = await seed(t);
		await asManager(t).mutation(api.menuItems.update, {
			itemId: ids.menuItemId,
			isAvailable: true,
		});
		let item = await t.run(async (ctx) => ctx.db.get(ids.menuItemId));
		expect(item?.isAvailable).toBe(true);
		expect(item?.unavailableReason).toBeUndefined();

		await asManager(t).mutation(api.menuItems.update, {
			itemId: ids.menuItemId,
			isAvailable: false,
		});
		item = await t.run(async (ctx) => ctx.db.get(ids.menuItemId));
		expect(item?.isAvailable).toBe(false);
		expect(item?.name).toBe("Rib eye");
	});

	it("an outsider cannot set option groups", async () => {
		const t = setup();
		const ids = await seed(t);
		const [, error] = await t
			.withIdentity({ subject: "user_outsider" })
			.mutation(api.menuItems.update, { itemId: ids.menuItemId, optionGroupIds: [] });
		expect(error).not.toBeNull();
		expect(await links(t, ids.menuItemId)).toHaveLength(2);
	});
});
