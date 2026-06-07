import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { RESTAURANT_MEMBER_ROLE, SHIFT_STATUS, USER_ROLES } from "../constants";
import { insertMenuForRestaurant } from "../menus";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

const HOUR = 60 * 60 * 1000;

interface SeedOut {
	orgId: Id<"organizations">;
	restaurantId: Id<"restaurants">;
	ownerUserId: string;
	managerUserId: string;
	managerMember: Id<"restaurantMembers">;
	otherMember: Id<"restaurantMembers">;
	tableId: Id<"tables">;
	sessionId: Id<"sessions">;
	menuItemId: Id<"menuItems">;
}

async function seed(t: ReturnType<typeof convexTest>): Promise<SeedOut> {
	return await t.run(async (ctx) => {
		const now = Date.now();
		const orgId = await ctx.db.insert("organizations", {
			name: "Sections Org",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		const restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner-user",
			organizationId: orgId,
			name: "Sections R",
			slug: "sections-r",
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
		const managerMember = await ctx.db.insert("restaurantMembers", {
			userId: "manager-user",
			restaurantId,
			organizationId: orgId,
			role: RESTAURANT_MEMBER_ROLE.MANAGER,
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		const otherMember = await ctx.db.insert("restaurantMembers", {
			userId: "other-user",
			restaurantId,
			organizationId: orgId,
			role: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});

		await insertMenuForRestaurant(ctx, {
			restaurantId,
			name: "main",
			userId: "owner-user",
		});

		const tableId = await ctx.db.insert("tables", {
			restaurantId,
			tableNumber: 1,
			isActive: true,
			createdAt: now,
		});
		const sessionId = await ctx.db.insert("sessions", {
			restaurantId,
			tableId,
			status: "active",
			startedAt: now,
		});

		const allMenus = await ctx.db.query("menus").collect();
		const menuId = allMenus.filter((m) => m.restaurantId === restaurantId)[0]._id;
		const categoryId = await ctx.db.insert("menuCategories", {
			menuId,
			restaurantId,
			name: "Mains",
			displayOrder: 0,
			createdAt: now,
			updatedAt: now,
		});
		const menuItemId = await ctx.db.insert("menuItems", {
			categoryId,
			restaurantId,
			name: "Burger",
			basePrice: 800,
			isAvailable: true,
			displayOrder: 0,
			createdAt: now,
			updatedAt: now,
		});

		return {
			orgId,
			restaurantId,
			ownerUserId: "owner-user",
			managerUserId: "manager-user",
			managerMember,
			otherMember,
			tableId,
			sessionId,
			menuItemId,
		};
	});
}

async function createPaidOrder(
	t: ReturnType<typeof convexTest>,
	args: {
		restaurantId: Id<"restaurants">;
		sessionId: Id<"sessions">;
		tableId: Id<"tables">;
		menuItemId: Id<"menuItems">;
	}
): Promise<Id<"orders">> {
	const orderId = await t.mutation(api.orders.createDraft, {
		sessionId: args.sessionId,
		tableId: args.tableId,
	});
	await t.mutation(api.orders.addItem, {
		orderId,
		menuItemId: args.menuItemId,
		quantity: 1,
		selectedOptions: [],
	});
	const snap = (await t.query(api.orders.getOrderWithItems, { orderId }))!.updatedAt;
	const paymentId = await t.mutation(internal.stripeHelpers.createPayment, {
		restaurantId: args.restaurantId,
		orderId,
		amount: 800,
		currency: "usd",
		status: "processing",
		refundStatus: "none",
		attemptNumber: 1,
		orderUpdatedAtSnapshot: snap,
	});
	await t.mutation(internal.stripeHelpers.updateOrderPaymentSummary, {
		orderId,
		paymentState: "processing",
		activePaymentId: paymentId,
		stripePaymentIntentId: `pi_${orderId}`,
	});
	await t.mutation(internal.orders.confirmPayment, {
		paymentId,
		stripePaymentIntentId: `pi_${orderId}`,
	});
	return orderId;
}

describe("sections.backfillDefault", () => {
	it("creates a fallback section and patches every table that lacks one", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, tableId, ownerUserId } = await seed(t);

		const owner = t.withIdentity({ subject: ownerUserId });
		const [result, err] = await owner.mutation(api.sections.backfillDefault, {
			restaurantId,
		});
		expect(err).toBeNull();
		expect(result?.tablesPatched).toBe(1);
		expect(result?.defaultSectionId).toBeTruthy();

		const patchedTable = await t.run(async (ctx) => ctx.db.get(tableId));
		expect(patchedTable?.sectionId).toBe(result!.defaultSectionId);

		// The fallback section is a regular section now: no `isSystem` flag,
		// no auto-named "Default", fully renamable / deletable like any other.
		const sections = await t.query(api.sections.getByRestaurant, { restaurantId });
		expect(sections).toHaveLength(1);
		expect(sections[0].isSystem).toBeUndefined();
		expect(sections[0].name).toBeUndefined();
	});

	it("is idempotent — re-running does not add a second Default", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, ownerUserId } = await seed(t);
		const owner = t.withIdentity({ subject: ownerUserId });

		const [first] = await owner.mutation(api.sections.backfillDefault, { restaurantId });
		const [second, err] = await owner.mutation(api.sections.backfillDefault, {
			restaurantId,
		});
		expect(err).toBeNull();
		expect(second?.defaultSectionId).toBe(first?.defaultSectionId);
		expect(second?.tablesPatched).toBe(0);
		expect(second?.assignmentsConverted).toBe(0);

		const sections = await t.query(api.sections.getByRestaurant, { restaurantId });
		expect(sections).toHaveLength(1);
	});

	it("converts existing shiftTableAssignments into shiftSectionAssignments", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, tableId, managerMember, ownerUserId } = await seed(t);

		await t.run(async (ctx) => {
			const now = Date.now();
			const shiftId = await ctx.db.insert("shifts", {
				memberId: managerMember,
				restaurantId,
				startsAt: now - HOUR,
				endsAt: now + HOUR,
				status: SHIFT_STATUS.PUBLISHED,
				createdBy: ownerUserId,
				createdAt: now,
				updatedAt: now,
			});
			await ctx.db.insert("shiftTableAssignments", {
				shiftId,
				restaurantId,
				tableId,
				startsAt: now - HOUR,
				endsAt: now + HOUR,
				createdBy: ownerUserId,
				createdAt: now,
				updatedAt: now,
			});
		});

		const owner = t.withIdentity({ subject: ownerUserId });
		const [result] = await owner.mutation(api.sections.backfillDefault, { restaurantId });
		expect(result?.assignmentsConverted).toBe(1);

		const ssas = await t.run(async (ctx) =>
			ctx.db
				.query("shiftSectionAssignments")
				.withIndex("by_restaurant_time", (q) => q.eq("restaurantId", restaurantId))
				.collect()
		);
		expect(ssas).toHaveLength(1);
		expect(ssas[0].sectionId).toBe(result!.defaultSectionId);
	});
});

describe("sections.create / remove", () => {
	it("creates a section with no tables when initialTableCount is 0", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, managerUserId } = await seed(t);
		const manager = t.withIdentity({ subject: managerUserId });

		const [sectionId, err] = await manager.mutation(api.sections.create, {
			restaurantId,
			name: "Empty zone",
			initialTableCount: 0,
		});
		expect(err).toBeNull();

		const tables = await t.run(async (ctx) => {
			const rows = await ctx.db
				.query("tables")
				.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
				.collect();
			return rows.filter((row) => row.sectionId === sectionId && row.deletedAt === undefined);
		});
		expect(tables).toHaveLength(0);
	});

	it("creates initial tables in a new section with sequential restaurant-wide numbers", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, managerUserId } = await seed(t);
		const manager = t.withIdentity({ subject: managerUserId });

		const [sectionId, err] = await manager.mutation(api.sections.create, {
			restaurantId,
			name: "Terrace",
			initialTableCount: 3,
			initialTableCapacity: 6,
		});
		expect(err).toBeNull();

		const tables = await t.run(async (ctx) => {
			const rows = await ctx.db
				.query("tables")
				.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
				.collect();
			return [...rows]
				.filter((row) => row.sectionId === sectionId && row.deletedAt === undefined)
				.sort((a, b) => a.tableNumber - b.tableNumber);
		});
		expect(tables).toHaveLength(3);
		expect(tables.map((row) => row.tableNumber)).toEqual([2, 3, 4]);
		expect(tables.every((row) => row.capacity === 6)).toBe(true);
	});

	it("rejects bulk table counts above the cap and invalid capacity", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, managerUserId } = await seed(t);
		const manager = t.withIdentity({ subject: managerUserId });

		const [, tooManyErr] = await manager.mutation(api.sections.create, {
			restaurantId,
			name: "Overflow",
			initialTableCount: 51,
		});
		expect(tooManyErr?.name).toBe("VALIDATION_ERROR");

		const [, badCapacityErr] = await manager.mutation(api.sections.create, {
			restaurantId,
			name: "Bad seats",
			initialTableCount: 2,
			initialTableCapacity: 0,
		});
		expect(badCapacityErr?.name).toBe("VALIDATION_ERROR");
	});

	it("manager can create, rename, and delete an empty section", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, managerUserId } = await seed(t);
		const manager = t.withIdentity({ subject: managerUserId });

		const [createId, createErr] = await manager.mutation(api.sections.create, {
			restaurantId,
			name: "Patio",
		});
		expect(createErr).toBeNull();
		expect(createId).toBeTruthy();

		const [renamedId, renameErr] = await manager.mutation(api.sections.update, {
			sectionId: createId!,
			name: "Terrace",
		});
		expect(renameErr).toBeNull();
		expect(renamedId).toBe(createId);

		const renamed = await t.run(async (ctx) => ctx.db.get(createId!));
		expect(renamed?.name).toBe("Terrace");

		const [, removeErr] = await manager.mutation(api.sections.remove, {
			sectionId: createId!,
		});
		expect(removeErr).toBeNull();
	});

	it("soft-deletes a section and cascade soft-deletes its tables", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, tableId, managerUserId } = await seed(t);
		const manager = t.withIdentity({ subject: managerUserId });

		const [sectionId] = await manager.mutation(api.sections.create, {
			restaurantId,
			name: "Patio",
		});
		await manager.mutation(api.sections.assignTable, {
			tableId,
			sectionId: sectionId!,
		});

		const [, err] = await manager.mutation(api.sections.remove, {
			sectionId: sectionId!,
		});
		expect(err).toBeNull();

		const sectionRow = await t.run(async (ctx) => ctx.db.get(sectionId!));
		expect(sectionRow?.deletedAt).toBeTruthy();
		expect(sectionRow?.hardDeleteAfterAt).toBeTruthy();
		expect(sectionRow?.deletedBy).toBe(managerUserId);

		const tableRow = await t.run(async (ctx) => ctx.db.get(tableId));
		expect(tableRow?.deletedAt).toBeTruthy();
		expect(tableRow?.softDeleteParentSectionId).toBe(sectionId);

		// The live query hides the soft-deleted rows.
		const live = await t.query(api.sections.getByRestaurant, { restaurantId });
		expect(live.find((s) => s._id === sectionId)).toBeUndefined();

		const trash = await t.query(api.sections.getDeletedForRestaurant, { restaurantId });
		expect(trash.find((s) => s._id === sectionId)).toBeDefined();
	});

	it("restoring a soft-deleted section also restores cascade-deleted tables", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, tableId, managerUserId } = await seed(t);
		const manager = t.withIdentity({ subject: managerUserId });

		const [sectionId] = await manager.mutation(api.sections.create, {
			restaurantId,
			name: "Patio",
		});
		await manager.mutation(api.sections.assignTable, {
			tableId,
			sectionId: sectionId!,
		});
		await manager.mutation(api.sections.remove, { sectionId: sectionId! });

		const [restoredId, err] = await manager.mutation(api.sections.restore, {
			sectionId: sectionId!,
		});
		expect(err).toBeNull();
		expect(restoredId).toBe(sectionId);

		const sectionRow = await t.run(async (ctx) => ctx.db.get(sectionId!));
		expect(sectionRow?.deletedAt).toBeUndefined();

		const tableRow = await t.run(async (ctx) => ctx.db.get(tableId));
		expect(tableRow?.deletedAt).toBeUndefined();
		expect(tableRow?.softDeleteParentSectionId).toBeUndefined();
	});

	it("blocks deletion of a section with future shiftSectionAssignments", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, managerMember, managerUserId, ownerUserId } = await seed(t);
		const manager = t.withIdentity({ subject: managerUserId });

		const [sectionId] = await manager.mutation(api.sections.create, {
			restaurantId,
			name: "Bar",
		});
		await t.run(async (ctx) => {
			const now = Date.now();
			await ctx.db.insert("shiftSectionAssignments", {
				shiftId: await ctx.db.insert("shifts", {
					memberId: managerMember,
					restaurantId,
					startsAt: now + HOUR,
					endsAt: now + 9 * HOUR,
					status: SHIFT_STATUS.PUBLISHED,
					createdBy: ownerUserId,
					createdAt: now,
					updatedAt: now,
				}),
				restaurantId,
				sectionId: sectionId!,
				startsAt: now + HOUR,
				endsAt: now + 9 * HOUR,
				createdBy: managerUserId,
				createdAt: now,
				updatedAt: now,
			});
		});

		const [removed, err] = await manager.mutation(api.sections.remove, {
			sectionId: sectionId!,
		});
		expect(removed).toBeNull();
		expect(err?.name).toBe("VALIDATION_ERROR");
	});

	it("allows deletion of the auto-created fallback section once empty", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, tableId, ownerUserId } = await seed(t);
		const owner = t.withIdentity({ subject: ownerUserId });

		// Backfill creates a regular fallback section and assigns the seeded
		// table to it. Detach the table, then delete the section — should
		// succeed because no `isSystem` guard applies.
		const [{ defaultSectionId }] = (await owner.mutation(api.sections.backfillDefault, {
			restaurantId,
		})) as [
			{
				defaultSectionId: Id<"sections">;
				tablesPatched: number;
				assignmentsConverted: number;
			},
			null,
		];

		await t.run(async (ctx) => {
			await ctx.db.patch(tableId, { sectionId: undefined });
		});

		const [, err] = await owner.mutation(api.sections.remove, {
			sectionId: defaultSectionId,
		});
		expect(err).toBeNull();

		const remaining = await t.query(api.sections.getByRestaurant, { restaurantId });
		expect(remaining).toHaveLength(0);
	});

	it("allows soft-deletion of legacy isSystem rows", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, ownerUserId } = await seed(t);
		const owner = t.withIdentity({ subject: ownerUserId });

		// Simulate a row created before the `isSystem` deprecation. The new
		// soft-delete path no longer blocks on this flag — the user asked
		// for the "Default section cannot be deleted" guard to go away.
		const legacyId = await t.run(async (ctx) => {
			const now = Date.now();
			return await ctx.db.insert("sections", {
				restaurantId,
				displayOrder: 0,
				isActive: true,
				isSystem: true,
				createdAt: now,
				updatedAt: now,
			});
		});

		const [, err] = await owner.mutation(api.sections.remove, {
			sectionId: legacyId,
		});
		expect(err).toBeNull();
		const row = await t.run(async (ctx) => ctx.db.get(legacyId));
		expect(row?.deletedAt).toBeTruthy();
	});
});

describe("sections.removeSystemFlag", () => {
	it("clears the legacy isSystem flag from every row", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seed(t);

		// Two legacy rows + one already-clean row.
		const legacyIds = await t.run(async (ctx) => {
			const now = Date.now();
			const a = await ctx.db.insert("sections", {
				restaurantId,
				displayOrder: 0,
				isActive: true,
				isSystem: true,
				createdAt: now,
				updatedAt: now,
			});
			const b = await ctx.db.insert("sections", {
				restaurantId,
				name: "Patio",
				displayOrder: 1,
				isActive: true,
				isSystem: true,
				createdAt: now,
				updatedAt: now,
			});
			const c = await ctx.db.insert("sections", {
				restaurantId,
				name: "Bar",
				displayOrder: 2,
				isActive: true,
				createdAt: now,
				updatedAt: now,
			});
			return [a, b, c];
		});

		// Seed a dedicated admin identity. `fetchUserRoles` returns the first
		// `userRoles` row for a user, so we cannot just stack ADMIN onto the
		// existing owner row — give the admin its own subject.
		const adminUserId = "admin-user-removeSystemFlag";
		await t.run(async (ctx) => {
			await ctx.db.insert("userRoles", {
				userId: adminUserId,
				roles: [USER_ROLES.ADMIN],
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		const admin = t.withIdentity({ subject: adminUserId });
		const [first, err] = await admin.mutation(api.sections.removeSystemFlag, {});
		expect(err).toBeNull();
		expect(first?.patched).toBe(2);

		// Idempotent — re-running patches nothing.
		const [second, err2] = await admin.mutation(api.sections.removeSystemFlag, {});
		expect(err2).toBeNull();
		expect(second?.patched).toBe(0);

		const rows = await t.run(async (ctx) => Promise.all(legacyIds.map((id) => ctx.db.get(id))));
		for (const row of rows) {
			expect(row?.isSystem).toBeUndefined();
		}
	});

	it("requires admin role", async () => {
		const t = convexTest(schema, modules);
		const { managerUserId } = await seed(t);

		const manager = t.withIdentity({ subject: managerUserId });
		const [value, err] = await manager.mutation(api.sections.removeSystemFlag, {});
		expect(value).toBeNull();
		expect(err?.name).toBe("NOT_AUTHORIZED");
	});
});

describe("shifts.upsertSectionAssignment", () => {
	it("rejects an overlapping assignment for the same section", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, managerMember, otherMember, managerUserId, ownerUserId } = await seed(t);

		const owner = t.withIdentity({ subject: ownerUserId });
		const [sectionId] = await owner.mutation(api.sections.create, {
			restaurantId,
			name: "Patio",
		});

		const now = Date.now();
		const baseStart = now - HOUR;
		const baseEnd = now + 5 * HOUR;
		const { firstShiftId, secondShiftId } = await t.run(async (ctx) => {
			const a = await ctx.db.insert("shifts", {
				memberId: managerMember,
				restaurantId,
				startsAt: baseStart,
				endsAt: baseEnd,
				status: SHIFT_STATUS.PUBLISHED,
				createdBy: ownerUserId,
				createdAt: now,
				updatedAt: now,
			});
			const b = await ctx.db.insert("shifts", {
				memberId: otherMember,
				restaurantId,
				startsAt: baseStart,
				endsAt: baseEnd,
				status: SHIFT_STATUS.PUBLISHED,
				createdBy: ownerUserId,
				createdAt: now,
				updatedAt: now,
			});
			return { firstShiftId: a, secondShiftId: b };
		});

		const manager = t.withIdentity({ subject: managerUserId });
		const [firstId, firstErr] = await manager.mutation(api.shifts.upsertSectionAssignment, {
			shiftId: firstShiftId,
			sectionId: sectionId!,
			startsAt: baseStart,
			endsAt: baseEnd,
		});
		expect(firstErr).toBeNull();
		expect(firstId).toBeTruthy();

		const [secondId, secondErr] = await manager.mutation(api.shifts.upsertSectionAssignment, {
			shiftId: secondShiftId,
			sectionId: sectionId!,
			startsAt: baseStart,
			endsAt: baseEnd,
		});
		expect(secondId).toBeNull();
		expect(secondErr?.name).toBe("VALIDATION_ERROR");
	});

	it("allows back-to-back assignments without overlap (handoff)", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, managerMember, otherMember, managerUserId, ownerUserId } = await seed(t);

		const owner = t.withIdentity({ subject: ownerUserId });
		const [sectionId] = await owner.mutation(api.sections.create, {
			restaurantId,
			name: "Patio",
		});

		const now = Date.now();
		const handoff = now + 3 * HOUR;
		const { firstShiftId, secondShiftId } = await t.run(async (ctx) => {
			const a = await ctx.db.insert("shifts", {
				memberId: managerMember,
				restaurantId,
				startsAt: now,
				endsAt: handoff,
				status: SHIFT_STATUS.PUBLISHED,
				createdBy: ownerUserId,
				createdAt: now,
				updatedAt: now,
			});
			const b = await ctx.db.insert("shifts", {
				memberId: otherMember,
				restaurantId,
				startsAt: handoff,
				endsAt: handoff + 3 * HOUR,
				status: SHIFT_STATUS.PUBLISHED,
				createdBy: ownerUserId,
				createdAt: now,
				updatedAt: now,
			});
			return { firstShiftId: a, secondShiftId: b };
		});

		const manager = t.withIdentity({ subject: managerUserId });
		const [, firstErr] = await manager.mutation(api.shifts.upsertSectionAssignment, {
			shiftId: firstShiftId,
			sectionId: sectionId!,
			startsAt: now,
			endsAt: handoff,
		});
		expect(firstErr).toBeNull();

		const [, secondErr] = await manager.mutation(api.shifts.upsertSectionAssignment, {
			shiftId: secondShiftId,
			sectionId: sectionId!,
			startsAt: handoff,
			endsAt: handoff + 3 * HOUR,
		});
		expect(secondErr).toBeNull();
	});
});

describe("confirmPayment attribution", () => {
	it("credits the member whose shift covers the table's section", async () => {
		const t = convexTest(schema, modules);
		const {
			restaurantId,
			tableId,
			sessionId,
			menuItemId,
			managerMember,
			managerUserId,
			ownerUserId,
		} = await seed(t);

		const owner = t.withIdentity({ subject: ownerUserId });
		const [sectionId] = await owner.mutation(api.sections.create, {
			restaurantId,
			name: "Patio",
		});
		await owner.mutation(api.sections.assignTable, {
			tableId,
			sectionId: sectionId!,
		});

		const now = Date.now();
		const shiftId = await t.run(async (ctx) =>
			ctx.db.insert("shifts", {
				memberId: managerMember,
				restaurantId,
				startsAt: now - HOUR,
				endsAt: now + HOUR,
				status: SHIFT_STATUS.PUBLISHED,
				createdBy: ownerUserId,
				createdAt: now,
				updatedAt: now,
			})
		);
		const manager = t.withIdentity({ subject: managerUserId });
		await manager.mutation(api.shifts.upsertSectionAssignment, {
			shiftId,
			sectionId: sectionId!,
			startsAt: now - HOUR,
			endsAt: now + HOUR,
		});

		const orderId = await createPaidOrder(t, {
			restaurantId,
			sessionId,
			tableId,
			menuItemId,
		});

		const order = await t.query(api.orders.getOrderWithItems, { orderId });
		expect(order?.attributedMemberId).toBe(managerMember);
	});

	it("falls back to session.serverMemberId when no section assignment is active", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, tableId, sessionId, menuItemId, otherMember } = await seed(t);

		await t.run(async (ctx) => {
			await ctx.db.patch(sessionId, { serverMemberId: otherMember });
		});

		const orderId = await createPaidOrder(t, {
			restaurantId,
			sessionId,
			tableId,
			menuItemId,
		});

		const order = await t.query(api.orders.getOrderWithItems, { orderId });
		expect(order?.attributedMemberId).toBe(otherMember);
	});

	it("leaves attributedMemberId undefined when neither section nor session covers the order", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, tableId, sessionId, menuItemId } = await seed(t);

		const orderId = await createPaidOrder(t, {
			restaurantId,
			sessionId,
			tableId,
			menuItemId,
		});

		const order = await t.query(api.orders.getOrderWithItems, { orderId });
		expect(order?.attributedMemberId).toBeUndefined();
	});
});
