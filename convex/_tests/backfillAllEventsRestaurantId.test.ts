/**
 * Backfill migration for `allEvents.restaurantId` (TAVLI-66 follow-up).
 *
 * Legacy rows predate the column; the migration derives it from the
 * restaurants aggregateId or a string `payload.restaurantId`, leaves
 * underivable rows untouched, and skips rows that already have it.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

const NOW = Date.now();

async function seed(t: ReturnType<typeof convexTest>) {
	return t.run(async (ctx) => {
		await ctx.db.insert("userRoles", {
			userId: "admin-user",
			roles: ["admin"],
			createdAt: NOW,
			updatedAt: NOW,
		});
		const orgId = await ctx.db.insert("organizations", {
			name: "Org",
			isActive: true,
			createdAt: NOW,
			updatedAt: NOW,
		});
		const restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner-1",
			organizationId: orgId,
			name: "Backfill Target",
			slug: "backfill-target",
			currency: "MXN",
			isActive: true,
			createdAt: NOW,
			updatedAt: NOW,
		});
		return { restaurantId };
	});
}

describe("migrations/backfillAllEventsRestaurantId", () => {
	it("derives restaurantId from aggregateId or payload, leaves the rest", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seed(t);

		// The restaurant is purged before the backfill runs: derivation must not
		// depend on the row still existing (dangling ids are the point).
		await t.run(async (ctx) => ctx.db.delete(restaurantId));

		const legacy = await t.run(async (ctx) => {
			const base = { userId: "someone", timestamp: NOW, createdAt: NOW };
			const fromAggregate = await ctx.db.insert("allEvents", {
				...base,
				eventType: "restaurants.soft_deleted",
				aggregateType: "restaurants",
				aggregateId: String(restaurantId),
				payload: { slugBefore: "backfill-target" },
			});
			const fromPayload = await ctx.db.insert("allEvents", {
				...base,
				eventType: "orders.submitted",
				aggregateType: "orders",
				aggregateId: "order-1",
				payload: { restaurantId: String(restaurantId), totalAmount: 100 },
			});
			const underivable = await ctx.db.insert("allEvents", {
				...base,
				eventType: "userRoles.bootstrap_first_admin",
				aggregateType: "userRoles",
				aggregateId: "role-1",
				payload: { roles: ["admin"] },
			});
			const alreadySet = await ctx.db.insert("allEvents", {
				...base,
				eventType: "menus.created",
				aggregateType: "menus",
				aggregateId: "menu-1",
				restaurantId,
				payload: { name: "Dinner" },
			});
			return { fromAggregate, fromPayload, underivable, alreadySet };
		});

		const admin = t.withIdentity({ subject: "admin-user" });
		const result = await admin.mutation(api.migrations.backfillAllEventsRestaurantId.run, {});
		expect(result).toEqual({ ok: true, patched: 2, underivable: 1, scanned: 4 });

		await t.run(async (ctx) => {
			expect((await ctx.db.get(legacy.fromAggregate))!.restaurantId).toBe(restaurantId);
			expect((await ctx.db.get(legacy.fromPayload))!.restaurantId).toBe(restaurantId);
			expect((await ctx.db.get(legacy.underivable))!.restaurantId).toBeUndefined();
			expect((await ctx.db.get(legacy.alreadySet))!.restaurantId).toBe(restaurantId);

			// After the backfill the forensic index sees all three linked events.
			const linked = await ctx.db
				.query("allEvents")
				.withIndex("by_restaurant_time", (q) =>
					q.eq("restaurantId", restaurantId as Id<"restaurants">)
				)
				.collect();
			expect(linked).toHaveLength(3);
		});
	});

	it("requires an admin", async () => {
		const t = convexTest(schema, modules);
		await seed(t);
		const stranger = t.withIdentity({ subject: "not-admin" });
		const result = await stranger.mutation(api.migrations.backfillAllEventsRestaurantId.run, {});
		expect(result.ok).toBe(false);
	});
});
