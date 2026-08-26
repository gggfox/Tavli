/**
 * Behaviour tests for the popularity ranking (TAVLI-98).
 *
 * The interesting cases are the exclusions. A ranking that counts the wrong
 * orders is not obviously wrong from the outside — it produces a plausible
 * list of dishes, and nobody can tell it is measuring carts instead of sales.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

const NOW = 1_750_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

/**
 * A bare `ReturnType<typeof convexTest>` drops the schema, so `ctx.db` inside a
 * `t.run` callback falls back to system tables only and every helper below
 * loses its typing. Inferring from an actual call keeps the schema attached.
 */
function harness() {
	return convexTest(schema, modules);
}
type T = ReturnType<typeof harness>;

async function seedRestaurant(t: T) {
	return t.run(async (ctx) => {
		const organizationId = await ctx.db.insert("organizations", {
			name: "Org",
			slug: "org",
			isActive: true,
			createdAt: NOW,
			updatedAt: NOW,
		});
		const restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner",
			organizationId,
			name: "Tacos",
			slug: "tacos",
			currency: "MXN",
			isActive: true,
			createdAt: NOW,
			updatedAt: NOW,
		});
		const menuId = await ctx.db.insert("menus", {
			restaurantId,
			name: "Main",
			isActive: true,
			displayOrder: 0,
			createdAt: NOW,
			updatedAt: NOW,
		});
		const categoryId = await ctx.db.insert("menuCategories", {
			restaurantId,
			menuId,
			name: "Tacos",
			displayOrder: 0,
			createdAt: NOW,
			updatedAt: NOW,
		});
		const tableId = await ctx.db.insert("tables", {
			restaurantId,
			tableNumber: 1,
			capacity: 4,
			isActive: true,
			createdAt: NOW,
		});
		const sessionId = await ctx.db.insert("sessions", {
			restaurantId,
			tableId,
			status: "active",
			startedAt: NOW,
		});
		return { organizationId, restaurantId, menuId, categoryId, tableId, sessionId };
	});
}

async function seedItem(t: T, seed: Awaited<ReturnType<typeof seedRestaurant>>, name: string) {
	return t.run(async (ctx) =>
		ctx.db.insert("menuItems", {
			categoryId: seed.categoryId,
			restaurantId: seed.restaurantId,
			name,
			basePrice: 5000,
			isAvailable: true,
			displayOrder: 0,
			createdAt: NOW,
			updatedAt: NOW,
		})
	);
}

/** One order carrying the given lines, paid unless told otherwise. */
async function seedOrder(
	t: T,
	seed: Awaited<ReturnType<typeof seedRestaurant>>,
	lines: Array<{ menuItemId: Id<"menuItems">; quantity: number; cancelled?: boolean }>,
	options: { paid?: boolean } = {}
) {
	const paid = options.paid ?? true;
	return t.run(async (ctx) => {
		const orderId = await ctx.db.insert("orders", {
			restaurantId: seed.restaurantId,
			sessionId: seed.sessionId,
			tableId: seed.tableId,
			status: paid ? "submitted" : "draft",
			totalAmount: 5000,
			createdAt: NOW,
			updatedAt: NOW,
			...(paid ? { paidAt: NOW } : {}),
		});
		for (const line of lines) {
			await ctx.db.insert("orderItems", {
				orderId,
				menuItemId: line.menuItemId,
				menuItemName: "x",
				quantity: line.quantity,
				unitPrice: 5000,
				selectedOptions: [],
				lineTotal: 5000 * line.quantity,
				createdAt: NOW,
				...(line.cancelled ? { cancelledAt: NOW } : {}),
			});
		}
		return orderId;
	});
}

async function ranking(t: T, restaurantId: Id<"restaurants">) {
	return t.run(async (ctx) =>
		ctx.db
			.query("menuItemPopularity")
			.withIndex("by_restaurant_rank", (q) => q.eq("restaurantId", restaurantId))
			.order("asc")
			.collect()
	);
}

describe("recomputeForRestaurant", () => {
	it("ranks by units sold, most popular first", async () => {
		const t = harness();
		const seed = await seedRestaurant(t);
		const pastor = await seedItem(t, seed, "Pastor");
		const asada = await seedItem(t, seed, "Asada");

		await seedOrder(t, seed, [{ menuItemId: asada, quantity: 1 }]);
		await seedOrder(t, seed, [{ menuItemId: pastor, quantity: 3 }]);

		await t.run(async (ctx) =>
			ctx.runMutation(internal.menuItemPopularity.recomputeForRestaurant, {
				restaurantId: seed.restaurantId,
			})
		);

		const rows = await ranking(t, seed.restaurantId);
		expect(rows.map((r) => r.menuItemId)).toEqual([pastor, asada]);
		expect(rows[0]).toMatchObject({ quantity: 3, rank: 1 });
		expect(rows[1]).toMatchObject({ quantity: 1, rank: 2 });
	});

	it("counts units, not orders", async () => {
		// One order of six beats six orders of one only if we are measuring
		// popularity of the *dish*; counting orders would rank a cheap side
		// above the thing everyone actually shares.
		const t = harness();
		const seed = await seedRestaurant(t);
		const big = await seedItem(t, seed, "Big");
		const small = await seedItem(t, seed, "Small");

		await seedOrder(t, seed, [{ menuItemId: big, quantity: 6 }]);
		for (let i = 0; i < 5; i++) await seedOrder(t, seed, [{ menuItemId: small, quantity: 1 }]);

		await t.run(async (ctx) =>
			ctx.runMutation(internal.menuItemPopularity.recomputeForRestaurant, {
				restaurantId: seed.restaurantId,
			})
		);
		expect((await ranking(t, seed.restaurantId))[0].menuItemId).toBe(big);
	});

	it("ignores orders that were never paid", async () => {
		// Otherwise anyone can rank a dish to the top of the carousel by
		// building carts and abandoning them — no account needed beyond the one
		// they already have to browse.
		const t = harness();
		const seed = await seedRestaurant(t);
		const real = await seedItem(t, seed, "Real");
		const gamed = await seedItem(t, seed, "Gamed");

		await seedOrder(t, seed, [{ menuItemId: real, quantity: 1 }]);
		await seedOrder(t, seed, [{ menuItemId: gamed, quantity: 99 }], { paid: false });

		await t.run(async (ctx) =>
			ctx.runMutation(internal.menuItemPopularity.recomputeForRestaurant, {
				restaurantId: seed.restaurantId,
			})
		);
		const rows = await ranking(t, seed.restaurantId);
		expect(rows.map((r) => r.menuItemId)).toEqual([real]);
	});

	it("ignores 86'd lines", async () => {
		// A cancelled line was never served. Ranking it puts a dish the kitchen
		// could not make at the top of the menu.
		const t = harness();
		const seed = await seedRestaurant(t);
		const served = await seedItem(t, seed, "Served");
		const eightySixed = await seedItem(t, seed, "86ed");

		await seedOrder(t, seed, [
			{ menuItemId: served, quantity: 1 },
			{ menuItemId: eightySixed, quantity: 50, cancelled: true },
		]);

		await t.run(async (ctx) =>
			ctx.runMutation(internal.menuItemPopularity.recomputeForRestaurant, {
				restaurantId: seed.restaurantId,
			})
		);
		expect((await ranking(t, seed.restaurantId)).map((r) => r.menuItemId)).toEqual([served]);
	});

	it("caps the ranking at the top ten", async () => {
		const t = harness();
		const seed = await seedRestaurant(t);
		for (let i = 0; i < 14; i++) {
			const item = await seedItem(t, seed, `Item ${i}`);
			await seedOrder(t, seed, [{ menuItemId: item, quantity: 20 - i }]);
		}
		await t.run(async (ctx) =>
			ctx.runMutation(internal.menuItemPopularity.recomputeForRestaurant, {
				restaurantId: seed.restaurantId,
			})
		);
		expect(await ranking(t, seed.restaurantId)).toHaveLength(10);
	});

	it("breaks ties by id, so the order does not depend on encounter order", async () => {
		// Not merely "stable across two identical runs" — Map iteration order is
		// insertion order, so a fixed dataset is deterministic *without* any
		// tiebreak and such a test passes with the tiebreak deleted. What
		// actually varies between nightly runs is the encounter order, as new
		// orders arrive and old ones age out. So assert the ordering *property*
		// the tiebreak provides: within an equal quantity, ascending id.
		const t = harness();
		const seed = await seedRestaurant(t);
		const items = [];
		for (let i = 0; i < 5; i++) items.push(await seedItem(t, seed, `Tied ${i}`));

		// Seed the orders in an order unrelated to id order, so insertion order
		// and id order genuinely disagree.
		for (const index of [3, 0, 4, 1, 2]) {
			await seedOrder(t, seed, [{ menuItemId: items[index], quantity: 7 }]);
		}

		await t.run(async (ctx) =>
			ctx.runMutation(internal.menuItemPopularity.recomputeForRestaurant, {
				restaurantId: seed.restaurantId,
			})
		);

		const rows = await ranking(t, seed.restaurantId);
		expect(rows).toHaveLength(5);
		for (const row of rows) expect(row.quantity).toBe(7);

		const ids = rows.map((r) => String(r.menuItemId));
		expect(ids, "tied items must come back in ascending id order").toEqual([...ids].sort());
	});

	it("drops rows for a menu that shrank", async () => {
		const t = harness();
		const seed = await seedRestaurant(t);
		const a = await seedItem(t, seed, "A");
		const b = await seedItem(t, seed, "B");
		const firstOrder = await seedOrder(t, seed, [
			{ menuItemId: a, quantity: 2 },
			{ menuItemId: b, quantity: 1 },
		]);

		const recompute = async () =>
			t.run(async (ctx) =>
				ctx.runMutation(internal.menuItemPopularity.recomputeForRestaurant, {
					restaurantId: seed.restaurantId,
				})
			);

		await recompute();
		expect(await ranking(t, seed.restaurantId)).toHaveLength(2);

		// Unpay the order: nothing qualifies any more.
		await t.run(async (ctx) => ctx.db.patch(firstOrder, { paidAt: undefined }));
		await recompute();
		expect(await ranking(t, seed.restaurantId)).toHaveLength(0);
	});

	it("does not count another restaurant's orders", async () => {
		const t = harness();
		const mine = await seedRestaurant(t);
		const theirs = await t.run(async (ctx) => {
			const organizationId = await ctx.db.insert("organizations", {
				name: "Other",
				slug: "other",
				isActive: true,
				createdAt: NOW,
				updatedAt: NOW,
			});
			return ctx.db.insert("restaurants", {
				ownerId: "owner2",
				organizationId,
				name: "Other",
				slug: "other-r",
				currency: "MXN",
				isActive: true,
				createdAt: NOW,
				updatedAt: NOW,
			});
		});
		const item = await seedItem(t, mine, "Shared");
		await seedOrder(t, mine, [{ menuItemId: item, quantity: 1 }]);

		await t.run(async (ctx) =>
			ctx.runMutation(internal.menuItemPopularity.recomputeForRestaurant, {
				restaurantId: theirs,
			})
		);
		expect(await ranking(t, theirs)).toHaveLength(0);
	});
});

describe("getPopularItemIds", () => {
	it("returns ids in rank order", async () => {
		const t = harness();
		const seed = await seedRestaurant(t);
		const a = await seedItem(t, seed, "A");
		const b = await seedItem(t, seed, "B");
		await seedOrder(t, seed, [{ menuItemId: b, quantity: 1 }]);
		await seedOrder(t, seed, [{ menuItemId: a, quantity: 5 }]);

		await t.run(async (ctx) =>
			ctx.runMutation(internal.menuItemPopularity.recomputeForRestaurant, {
				restaurantId: seed.restaurantId,
			})
		);
		await expect(
			t.query(api.menuItemPopularity.getPopularItemIds, { restaurantId: seed.restaurantId })
		).resolves.toEqual([a, b]);
	});

	it("answers an anonymous diner", async () => {
		// The menu is browsable signed-out, so this query must not require an
		// identity — it carries no more information than the menu already does.
		const t = harness();
		const seed = await seedRestaurant(t);
		await expect(
			t.query(api.menuItemPopularity.getPopularItemIds, { restaurantId: seed.restaurantId })
		).resolves.toEqual([]);
	});
});

describe("sweepPopularity", () => {
	it("skips inactive and soft-deleted restaurants", async () => {
		// Ranking a restaurant in its retention window is work no diner will
		// ever see.
		const t = harness();
		const seed = await seedRestaurant(t);
		await t.run(async (ctx) => ctx.db.patch(seed.restaurantId, { deletedAt: NOW - DAY }));

		const result = await t.run(async (ctx) =>
			ctx.runMutation(internal.menuItemPopularity.sweepPopularity, {})
		);
		expect(result.scheduled).toBe(0);
	});

	it("schedules the active ones", async () => {
		const t = harness();
		await seedRestaurant(t);
		const result = await t.run(async (ctx) =>
			ctx.runMutation(internal.menuItemPopularity.sweepPopularity, {})
		);
		expect(result.scheduled).toBe(1);
		expect(result.done).toBe(true);
	});
});
