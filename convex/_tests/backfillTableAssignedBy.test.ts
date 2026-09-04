/**
 * Backfill for `reservations.tableAssignedBy` (TAVLI-101).
 *
 * Every table on a row that predates auto-assignment was, in fact, chosen by a
 * human — so `staff` is not a default, it is the truth. Getting this wrong in
 * the other direction would be expensive: a row wrongly marked `auto` becomes
 * re-placeable, and `reschedule` would move a party off a table a manager
 * deliberately picked.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { RESERVATION_STATUS, TABLE_ASSIGNED_BY } from "../constants";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

async function seed(t: ReturnType<typeof convexTest>) {
	let restaurantId: Id<"restaurants">;
	let tableId: Id<"tables">;
	await t.run(async (ctx) => {
		const organizationId = await ctx.db.insert("organizations", {
			name: "Backfill Org",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner-backfill",
			organizationId,
			name: "Backfill Restaurant",
			slug: `backfill-${Math.random().toString(36).slice(2, 10)}`,
			currency: "MXN",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		tableId = await ctx.db.insert("tables", {
			restaurantId,
			tableNumber: 1,
			capacity: 4,
			isActive: true,
			createdAt: Date.now(),
		});
		await ctx.db.insert("userRoles", {
			userId: "admin-backfill",
			roles: ["admin"],
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});
	return {
		restaurantId: restaurantId!,
		tableId: tableId!,
		admin: t.withIdentity({ subject: "admin-backfill" }),
	};
}

async function insertLegacy(
	t: ReturnType<typeof convexTest>,
	restaurantId: Id<"restaurants">,
	tableIds: Id<"tables">[]
) {
	return await t.run((ctx) =>
		ctx.db.insert("reservations", {
			restaurantId,
			partySize: 2,
			startsAt: Date.now(),
			endsAt: Date.now() + 90 * 60_000,
			tableIds,
			status: RESERVATION_STATUS.CONFIRMED,
			source: "ui",
			contact: { name: "Ada", phone: "+525512345678" },
			createdAt: Date.now(),
			updatedAt: Date.now(),
		})
	);
}

describe("backfillTableAssignedBy", () => {
	it("marks rows that already have tables as staff-assigned", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, tableId, admin } = await seed(t);
		const legacy = await insertLegacy(t, restaurantId, [tableId]);

		const result = await admin.mutation(api.migrations.backfillTableAssignedBy.run, {});

		expect(result.ok).toBe(true);
		const row = await t.run((ctx) => ctx.db.get(legacy));
		expect(row?.tableAssignedBy).toBe(TABLE_ASSIGNED_BY.STAFF);
	});

	it("leaves unassigned rows without a marker — they have no assignment to describe", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, admin } = await seed(t);
		const queued = await insertLegacy(t, restaurantId, []);

		await admin.mutation(api.migrations.backfillTableAssignedBy.run, {});

		const row = await t.run((ctx) => ctx.db.get(queued));
		expect(row?.tableAssignedBy).toBeUndefined();
	});

	it("never overwrites a marker that is already set", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, tableId, admin } = await seed(t);
		const auto = await insertLegacy(t, restaurantId, [tableId]);
		await t.run((ctx) => ctx.db.patch(auto, { tableAssignedBy: TABLE_ASSIGNED_BY.AUTO }));

		const result = await admin.mutation(api.migrations.backfillTableAssignedBy.run, {});

		const row = await t.run((ctx) => ctx.db.get(auto));
		expect(row?.tableAssignedBy).toBe(TABLE_ASSIGNED_BY.AUTO);
		expect(result.patched).toBe(0);
	});

	it("refuses a caller who is not an admin", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, tableId } = await seed(t);
		await insertLegacy(t, restaurantId, [tableId]);

		const result = await t
			.withIdentity({ subject: "nobody" })
			.mutation(api.migrations.backfillTableAssignedBy.run, {});

		expect(result.ok).toBe(false);
	});
});
