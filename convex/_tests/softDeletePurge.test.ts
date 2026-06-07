/**
 * Covers the soft-delete + hard-purge lifecycle introduced for sections and
 * tables: individual table soft-delete + restore, cron purge sweeps elapsed
 * rows, audit events land in `allEvents`, and the configurable purge-delay
 * feature flag overrides the default retention window.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { RESTAURANT_MEMBER_ROLE, USER_ROLES } from "../constants";
import { DEFAULT_SOFT_DELETE_PURGE_DELAY_DAYS, FEATURE_FLAGS } from "../featureFlags";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");
const DAY_MS = 24 * 60 * 60 * 1000;

interface SeedOut {
	restaurantId: Id<"restaurants">;
	managerUserId: string;
	ownerUserId: string;
	adminUserId: string;
}

async function seed(t: ReturnType<typeof convexTest>): Promise<SeedOut> {
	return await t.run(async (ctx) => {
		const now = Date.now();
		const orgId = await ctx.db.insert("organizations", {
			name: "Purge Org",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		const restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner-user",
			organizationId: orgId,
			name: "Purge R",
			slug: "purge-r",
			currency: "USD",
			timezone: "UTC",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		await ctx.db.insert("userRoles", {
			userId: "owner-user",
			roles: [USER_ROLES.OWNER],
			organizationId: orgId,
			createdAt: now,
			updatedAt: now,
		});
		await ctx.db.insert("userRoles", {
			userId: "admin-user",
			roles: [USER_ROLES.ADMIN],
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
		return {
			restaurantId,
			managerUserId: "manager-user",
			ownerUserId: "owner-user",
			adminUserId: "admin-user",
		};
	});
}

describe("tables soft-delete + restore", () => {
	it("soft-deletes a table and surfaces it under getDeletedForRestaurant", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, managerUserId } = await seed(t);
		const manager = t.withIdentity({ subject: managerUserId });

		const [tableId] = await manager.mutation(api.tables.create, {
			restaurantId,
			tableNumber: 1,
			capacity: 4,
		});

		const [, err] = await manager.mutation(api.tables.remove, {
			tableId: tableId as Id<"tables">,
		});
		expect(err).toBeNull();

		const row = await t.run(async (ctx) => ctx.db.get(tableId as Id<"tables">));
		expect(row?.deletedAt).toBeTruthy();
		expect(row?.hardDeleteAfterAt).toBeTruthy();
		expect(row?.deletedBy).toBe(managerUserId);
		// Independent table deletes leave the parent marker unset.
		expect(row?.softDeleteParentSectionId).toBeUndefined();

		const live = await t.query(api.tables.getByRestaurant, { restaurantId });
		expect(live.find((tb) => tb._id === tableId)).toBeUndefined();

		const trash = await t.query(api.tables.getDeletedForRestaurant, { restaurantId });
		expect(trash.find((tb) => tb._id === tableId)).toBeDefined();
	});

	it("restores an independently soft-deleted table", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, managerUserId } = await seed(t);
		const manager = t.withIdentity({ subject: managerUserId });

		const [tableId] = await manager.mutation(api.tables.create, {
			restaurantId,
			tableNumber: 1,
			capacity: 4,
		});
		await manager.mutation(api.tables.remove, {
			tableId: tableId as Id<"tables">,
		});

		const [, err] = await manager.mutation(api.tables.restore, {
			tableId: tableId as Id<"tables">,
		});
		expect(err).toBeNull();

		const row = await t.run(async (ctx) => ctx.db.get(tableId as Id<"tables">));
		expect(row?.deletedAt).toBeUndefined();
	});

	it("rejects restoring a table whose parent section is still soft-deleted", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, managerUserId } = await seed(t);
		const manager = t.withIdentity({ subject: managerUserId });

		const [sectionId] = await manager.mutation(api.sections.create, {
			restaurantId,
			name: "Patio",
		});
		const [tableId] = await manager.mutation(api.tables.create, {
			restaurantId,
			tableNumber: 1,
			capacity: 4,
			sectionId: sectionId as Id<"sections">,
		});
		// Cascading section soft-delete also marks the table as deleted with
		// the parent pointer.
		await manager.mutation(api.sections.remove, {
			sectionId: sectionId as Id<"sections">,
		});

		const [restored, err] = await manager.mutation(api.tables.restore, {
			tableId: tableId as Id<"tables">,
		});
		expect(restored).toBeNull();
		expect(err?.name).toBe("VALIDATION_ERROR");
	});

	it("rejects creating a table in a hidden section", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, managerUserId } = await seed(t);
		const manager = t.withIdentity({ subject: managerUserId });

		const [sectionId] = await manager.mutation(api.sections.create, {
			restaurantId,
			name: "Patio",
		});
		await manager.mutation(api.sections.update, {
			sectionId: sectionId as Id<"sections">,
			isActive: false,
		});

		const [created, err] = await manager.mutation(api.tables.create, {
			restaurantId,
			tableNumber: 1,
			capacity: 4,
			sectionId: sectionId as Id<"sections">,
		});
		expect(created).toBeNull();
		expect(err?.name).toBe("VALIDATION_ERROR");
	});

	it("bulk-removes multiple tables in one call", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, managerUserId } = await seed(t);
		const manager = t.withIdentity({ subject: managerUserId });

		const [tableA] = await manager.mutation(api.tables.create, {
			restaurantId,
			tableNumber: 1,
			capacity: 4,
		});
		const [tableB] = await manager.mutation(api.tables.create, {
			restaurantId,
			tableNumber: 2,
			capacity: 4,
		});
		const [tableC] = await manager.mutation(api.tables.create, {
			restaurantId,
			tableNumber: 3,
			capacity: 4,
		});

		const [result, err] = await manager.mutation(api.tables.bulkRemove, {
			restaurantId,
			tableIds: [tableA as Id<"tables">, tableB as Id<"tables">],
		});
		expect(err).toBeNull();
		expect(result?.removed).toBe(2);

		const live = await t.query(api.tables.getByRestaurant, { restaurantId });
		expect(live.map((tb) => tb._id)).toEqual([tableC]);

		const trash = await t.query(api.tables.getDeletedForRestaurant, { restaurantId });
		const trashIds = trash.map((tb) => tb._id);
		expect(trashIds).toContain(tableA);
		expect(trashIds).toContain(tableB);
	});

	it("bulk-remove skips already-deleted and wrong-restaurant ids", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, managerUserId } = await seed(t);
		const manager = t.withIdentity({ subject: managerUserId });

		const { otherRestaurantId } = await t.run(async (ctx) => {
			const now = Date.now();
			const org = await ctx.db.query("organizations").first();
			if (!org) throw new Error("missing org");
			const otherRestaurantId = await ctx.db.insert("restaurants", {
				ownerId: "other-owner",
				organizationId: org._id,
				name: "Other",
				slug: "other-r",
				currency: "USD",
				timezone: "UTC",
				isActive: true,
				createdAt: now,
				updatedAt: now,
			});
			return { otherRestaurantId };
		});

		const [tableA] = await manager.mutation(api.tables.create, {
			restaurantId,
			tableNumber: 1,
			capacity: 4,
		});
		const [tableB] = await manager.mutation(api.tables.create, {
			restaurantId,
			tableNumber: 2,
			capacity: 4,
		});
		await manager.mutation(api.tables.remove, {
			tableId: tableB as Id<"tables">,
		});

		const [otherTableId] = await t.run(async (ctx) => {
			const now = Date.now();
			return [
				await ctx.db.insert("tables", {
					restaurantId: otherRestaurantId,
					tableNumber: 99,
					capacity: 4,
					isActive: true,
					createdAt: now,
				}),
			] as const;
		});

		const [result, err] = await manager.mutation(api.tables.bulkRemove, {
			restaurantId,
			tableIds: [tableA as Id<"tables">, tableB as Id<"tables">, otherTableId as Id<"tables">],
		});
		expect(err).toBeNull();
		expect(result?.removed).toBe(1);
	});

	it("bulk-remove rejects unauthorized caller", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, managerUserId } = await seed(t);
		const manager = t.withIdentity({ subject: managerUserId });
		const stranger = t.withIdentity({ subject: "stranger-user" });

		const [tableId] = await manager.mutation(api.tables.create, {
			restaurantId,
			tableNumber: 1,
			capacity: 4,
		});

		const [result, err] = await stranger.mutation(api.tables.bulkRemove, {
			restaurantId,
			tableIds: [tableId as Id<"tables">],
		});
		expect(result).toBeNull();
		expect(err?.name).toBe("NOT_AUTHORIZED");
	});

	it("excludes tables in hidden sections from getActiveByRestaurant", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, managerUserId } = await seed(t);
		const manager = t.withIdentity({ subject: managerUserId });

		const [sectionA] = await manager.mutation(api.sections.create, {
			restaurantId,
			name: "Patio",
		});
		const [sectionB] = await manager.mutation(api.sections.create, {
			restaurantId,
			name: "Bar",
		});
		await manager.mutation(api.tables.create, {
			restaurantId,
			tableNumber: 1,
			capacity: 4,
			sectionId: sectionA as Id<"sections">,
		});
		await manager.mutation(api.tables.create, {
			restaurantId,
			tableNumber: 2,
			capacity: 4,
			sectionId: sectionB as Id<"sections">,
		});

		// Hide section B; its table should fall out of the "active" set.
		await manager.mutation(api.sections.update, {
			sectionId: sectionB as Id<"sections">,
			isActive: false,
		});

		const active = await t.query(api.tables.getActiveByRestaurant, { restaurantId });
		expect(active).toHaveLength(1);
		expect(active[0].tableNumber).toBe(1);
	});
});

describe("softDeletePurge cron", () => {
	it("hard-deletes elapsed soft-deleted sections and tables and writes audit events", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, managerUserId } = await seed(t);
		const manager = t.withIdentity({ subject: managerUserId });

		const [sectionId] = await manager.mutation(api.sections.create, {
			restaurantId,
			name: "Doomed",
		});
		const [tableId] = await manager.mutation(api.tables.create, {
			restaurantId,
			tableNumber: 1,
			capacity: 4,
			sectionId: sectionId as Id<"sections">,
		});
		await manager.mutation(api.sections.remove, {
			sectionId: sectionId as Id<"sections">,
		});

		// Pull the retention window forward so the cron sees them as due.
		await t.run(async (ctx) => {
			const sec = await ctx.db.get(sectionId as Id<"sections">);
			if (sec) await ctx.db.patch(sec._id, { hardDeleteAfterAt: Date.now() - 1000 });
			const tab = await ctx.db.get(tableId as Id<"tables">);
			if (tab) await ctx.db.patch(tab._id, { hardDeleteAfterAt: Date.now() - 1000 });
		});

		const result = await t.mutation(internal.softDeletePurge.purgeExpiredSoftDeletes, {});
		expect(result.sectionsPurged).toBe(1);
		expect(result.tablesPurged).toBe(1);

		const sectionRow = await t.run(async (ctx) => ctx.db.get(sectionId as Id<"sections">));
		expect(sectionRow).toBeNull();
		const tableRow = await t.run(async (ctx) => ctx.db.get(tableId as Id<"tables">));
		expect(tableRow).toBeNull();

		const auditEvents = await t.run(async (ctx) =>
			ctx.db
				.query("allEvents")
				.withIndex("by_aggregate_type", (q) => q.eq("aggregateType", "sections"))
				.collect()
		);
		const sectionAudit = auditEvents.find(
			(e) => e.aggregateId === String(sectionId) && e.eventType === "sections.hard_deleted"
		);
		expect(sectionAudit).toBeDefined();
		expect((sectionAudit?.payload as { name?: string } | undefined)?.name).toBe("Doomed");

		const tableAudit = await t.run(async (ctx) =>
			ctx.db
				.query("allEvents")
				.withIndex("by_aggregate", (q) =>
					q.eq("aggregateType", "tables").eq("aggregateId", String(tableId))
				)
				.first()
		);
		expect(tableAudit?.eventType).toBe("tables.hard_deleted");
	});

	it("skips rows whose hardDeleteAfterAt is still in the future", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, managerUserId } = await seed(t);
		const manager = t.withIdentity({ subject: managerUserId });

		const [tableId] = await manager.mutation(api.tables.create, {
			restaurantId,
			tableNumber: 1,
			capacity: 4,
		});
		await manager.mutation(api.tables.remove, {
			tableId: tableId as Id<"tables">,
		});

		const result = await t.mutation(internal.softDeletePurge.purgeExpiredSoftDeletes, {});
		expect(result.tablesPurged).toBe(0);
		const row = await t.run(async (ctx) => ctx.db.get(tableId as Id<"tables">));
		expect(row?.deletedAt).toBeTruthy();
	});
});

describe("featureFlags.softDeletePurgeDelayDays", () => {
	it("uses the default retention window when the flag is unset", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, managerUserId } = await seed(t);
		const manager = t.withIdentity({ subject: managerUserId });

		const [tableId] = await manager.mutation(api.tables.create, {
			restaurantId,
			tableNumber: 1,
			capacity: 4,
		});
		const before = Date.now();
		await manager.mutation(api.tables.remove, {
			tableId: tableId as Id<"tables">,
		});
		const after = Date.now();

		const row = await t.run(async (ctx) => ctx.db.get(tableId as Id<"tables">));
		const expectedMin = before + DEFAULT_SOFT_DELETE_PURGE_DELAY_DAYS * DAY_MS;
		const expectedMax = after + DEFAULT_SOFT_DELETE_PURGE_DELAY_DAYS * DAY_MS;
		expect(row?.hardDeleteAfterAt ?? 0).toBeGreaterThanOrEqual(expectedMin);
		expect(row?.hardDeleteAfterAt ?? 0).toBeLessThanOrEqual(expectedMax);
	});

	it("honors the configured numericValue override", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, managerUserId, adminUserId } = await seed(t);
		const admin = t.withIdentity({ subject: adminUserId });
		const manager = t.withIdentity({ subject: managerUserId });

		// Set a 5-day retention via the admin-only flag.
		await admin.mutation(api.featureFlags.setFeatureFlag, {
			key: FEATURE_FLAGS.SOFT_DELETE_PURGE_DELAY_DAYS,
			enabled: true,
			numericValue: 5,
		});

		const [tableId] = await manager.mutation(api.tables.create, {
			restaurantId,
			tableNumber: 1,
			capacity: 4,
		});
		const before = Date.now();
		await manager.mutation(api.tables.remove, {
			tableId: tableId as Id<"tables">,
		});
		const after = Date.now();

		const row = await t.run(async (ctx) => ctx.db.get(tableId as Id<"tables">));
		const expectedMin = before + 5 * DAY_MS;
		const expectedMax = after + 5 * DAY_MS;
		expect(row?.hardDeleteAfterAt ?? 0).toBeGreaterThanOrEqual(expectedMin);
		expect(row?.hardDeleteAfterAt ?? 0).toBeLessThanOrEqual(expectedMax);
	});

	it("falls back to the default when the flag exists but enabled=false", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, managerUserId, adminUserId } = await seed(t);
		const admin = t.withIdentity({ subject: adminUserId });
		const manager = t.withIdentity({ subject: managerUserId });

		await admin.mutation(api.featureFlags.setFeatureFlag, {
			key: FEATURE_FLAGS.SOFT_DELETE_PURGE_DELAY_DAYS,
			enabled: false,
			numericValue: 99,
		});

		const [tableId] = await manager.mutation(api.tables.create, {
			restaurantId,
			tableNumber: 1,
			capacity: 4,
		});
		const before = Date.now();
		await manager.mutation(api.tables.remove, {
			tableId: tableId as Id<"tables">,
		});
		const after = Date.now();

		const row = await t.run(async (ctx) => ctx.db.get(tableId as Id<"tables">));
		const expectedMin = before + DEFAULT_SOFT_DELETE_PURGE_DELAY_DAYS * DAY_MS;
		const expectedMax = after + DEFAULT_SOFT_DELETE_PURGE_DELAY_DAYS * DAY_MS;
		expect(row?.hardDeleteAfterAt ?? 0).toBeGreaterThanOrEqual(expectedMin);
		expect(row?.hardDeleteAfterAt ?? 0).toBeLessThanOrEqual(expectedMax);
	});
});
