/**
 * Behavioral coverage for the restaurant hard purge (TAVLI-66).
 *
 * Seeds a restaurant with rows in every purge-covered table (including the
 * shapes that used to slip through: employee accounts with photos, tab
 * payments carrying only `sessionId`, dispute rows, dashboard rows, shift
 * templates/section assignments, soft-deleted sections) plus a control
 * restaurant, then purges and asserts: everything scoped to the purged
 * restaurant is gone, nothing belonging to the control restaurant or to users
 * (portfolio layouts, org-level roles) is touched, storage files are removed,
 * and the `restaurants.hard_deleted` audit event records exact per-table
 * counts of what was deleted.
 */
import { Blob as NodeBlob } from "node:buffer";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { RESTAURANT_PURGE_DELETED_TABLES, TABLE } from "../constants";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

type T = ReturnType<typeof convexTest>;

const NOW = Date.now();
const PAST_DUE = NOW - 1000;

async function seedOrg(t: T, name: string) {
	return t.run(async (ctx) =>
		ctx.db.insert("organizations", {
			name,
			isActive: true,
			createdAt: NOW,
			updatedAt: NOW,
		})
	);
}

async function seedRestaurant(
	t: T,
	args: { orgId: Id<"organizations">; slug: string; softDeleted: boolean }
) {
	return t.run(async (ctx) =>
		ctx.db.insert("restaurants", {
			ownerId: "owner-1",
			organizationId: args.orgId,
			name: args.slug,
			slug: args.slug,
			currency: "MXN",
			isActive: !args.softDeleted,
			...(args.softDeleted
				? { deletedAt: PAST_DUE, deletedBy: "owner-1", hardDeleteAfterAt: PAST_DUE }
				: {}),
			createdAt: NOW,
			updatedAt: NOW,
		})
	);
}

/** Rows the full graph seeds per table — the expected audit `counts`. */
const EXPECTED_DELETED = {
	[TABLE.RESTAURANT_MEMBERS]: 2,
	[TABLE.EMPLOYEE_ACCOUNTS]: 1,
	[TABLE.MENUS]: 1,
	[TABLE.MENU_CATEGORIES]: 1,
	[TABLE.MENU_ITEMS]: 2,
	[TABLE.OPTION_GROUPS]: 1,
	[TABLE.OPTIONS]: 1,
	[TABLE.MENU_ITEM_OPTION_GROUPS]: 1,
	[TABLE.TABLES]: 1,
	[TABLE.SECTIONS]: 2,
	[TABLE.SESSIONS]: 1,
	[TABLE.ORDERS]: 1,
	[TABLE.ORDER_ITEMS]: 1,
	[TABLE.ORDER_DAY_COUNTERS]: 1,
	[TABLE.PAYMENTS]: 2,
	[TABLE.STRIPE_WEBHOOK_EVENTS]: 2,
	[TABLE.STRIPE_DISPUTES]: 1,
	[TABLE.RESERVATIONS]: 1,
	[TABLE.TABLE_LOCKS]: 1,
	[TABLE.RESERVATION_SETTINGS]: 1,
	[TABLE.SHIFTS]: 1,
	[TABLE.SHIFT_TEMPLATES]: 1,
	[TABLE.SHIFT_TABLE_ASSIGNMENTS]: 1,
	[TABLE.SHIFT_SECTION_ASSIGNMENTS]: 1,
	[TABLE.SHIFT_ATTENDANCE]: 1,
	[TABLE.CLOCK_EVENTS]: 1,
	[TABLE.ABSENCES]: 1,
	[TABLE.TIP_POOLS]: 1,
	[TABLE.TIP_POOL_SHARES]: 1,
	[TABLE.TIP_ENTRIES]: 1,
	[TABLE.DASHBOARD_LAYOUTS]: 1,
	[TABLE.DASHBOARD_TEMPLATES]: 1,
} as const;

/**
 * Seeds at least one row in every table the purge covers, scoped to the given
 * restaurant. Returns ids needed for post-purge assertions.
 */
async function seedFullGraph(t: T, orgId: Id<"organizations">, restaurantId: Id<"restaurants">) {
	return t.run(async (ctx) => {
		const memberId = await ctx.db.insert("restaurantMembers", {
			userId: "member-user",
			restaurantId,
			organizationId: orgId,
			role: "manager",
			isActive: true,
			createdAt: NOW,
			updatedAt: NOW,
		});

		// node:buffer Blob: jsdom's Blob lacks arrayBuffer(), which convex-test
		// needs to hash stored files.
		const photoStorageId = await ctx.storage.store(new NodeBlob(["employee-photo"]) as Blob);
		const employeeAccountId = await ctx.db.insert("employeeAccounts", {
			restaurantId,
			organizationId: orgId,
			firstName: "Ana",
			paternalLastname: "García",
			maternalLastname: "López",
			photoStorageId,
			pinHash: "hash",
			pinSetAt: NOW,
			pinResetCount: 0,
			failedPinAttempts: 0,
			createdAt: NOW,
			updatedAt: NOW,
		});
		await ctx.db.insert("restaurantMembers", {
			employeeAccountId,
			restaurantId,
			organizationId: orgId,
			role: "employee",
			isActive: true,
			createdAt: NOW,
			updatedAt: NOW,
		});

		const menuId = await ctx.db.insert("menus", {
			restaurantId,
			name: "Dinner",
			isActive: true,
			displayOrder: 0,
			createdAt: NOW,
			updatedAt: NOW,
		});
		const categoryId = await ctx.db.insert("menuCategories", {
			menuId,
			restaurantId,
			name: "Mains",
			displayOrder: 0,
			createdAt: NOW,
			updatedAt: NOW,
		});
		const imageStorageId = await ctx.storage.store(new NodeBlob(["dish-photo"]) as Blob);
		const menuItemId = await ctx.db.insert("menuItems", {
			categoryId,
			restaurantId,
			name: "Tacos",
			basePrice: 120,
			imageStorageId,
			isAvailable: true,
			displayOrder: 0,
			createdAt: NOW,
			updatedAt: NOW,
		});
		await ctx.db.insert("menuItems", {
			categoryId,
			restaurantId,
			name: "Quesadillas",
			basePrice: 90,
			isAvailable: true,
			displayOrder: 1,
			createdAt: NOW,
			updatedAt: NOW,
		});
		const optionGroupId = await ctx.db.insert("optionGroups", {
			restaurantId,
			name: "Salsa",
			selectionType: "single",
			isRequired: false,
			minSelections: 0,
			maxSelections: 1,
			displayOrder: 0,
			createdAt: NOW,
			updatedAt: NOW,
		});
		await ctx.db.insert("options", {
			optionGroupId,
			restaurantId,
			name: "Verde",
			priceModifier: 0,
			isAvailable: true,
			displayOrder: 0,
			createdAt: NOW,
		});
		await ctx.db.insert("menuItemOptionGroups", {
			menuItemId,
			optionGroupId,
			restaurantId,
			displayOrder: 0,
		});

		const sectionId = await ctx.db.insert("sections", {
			restaurantId,
			name: "Terrace",
			displayOrder: 0,
			isActive: true,
			createdAt: NOW,
			updatedAt: NOW,
		});
		// Individually soft-deleted and already past its retention window: the
		// restaurant purge must still remove it (softDeletePurge would otherwise).
		await ctx.db.insert("sections", {
			restaurantId,
			name: "Old patio",
			displayOrder: 1,
			isActive: false,
			deletedAt: PAST_DUE,
			deletedBy: "owner-1",
			hardDeleteAfterAt: PAST_DUE,
			createdAt: NOW,
			updatedAt: NOW,
		});
		const tableId = await ctx.db.insert("tables", {
			restaurantId,
			tableNumber: 1,
			capacity: 4,
			sectionId,
			isActive: true,
			createdAt: NOW,
		});

		const sessionId = await ctx.db.insert("sessions", {
			restaurantId,
			tableId,
			status: "closed",
			startedAt: NOW,
		});
		const orderId = await ctx.db.insert("orders", {
			sessionId,
			restaurantId,
			tableId,
			status: "served",
			totalAmount: 210,
			createdAt: NOW,
			updatedAt: NOW,
		});
		const orderItemId = await ctx.db.insert("orderItems", {
			orderId,
			menuItemId,
			menuItemName: "Tacos",
			quantity: 1,
			unitPrice: 120,
			selectedOptions: [],
			lineTotal: 120,
			createdAt: NOW,
		});
		await ctx.db.insert("orderDayCounters", {
			restaurantId,
			serviceDateKey: "2026-08",
			lastIssuedNumber: 42,
			updatedAt: NOW,
		});

		const orderPaymentId = await ctx.db.insert("payments", {
			restaurantId,
			orderId,
			amount: 120,
			currency: "MXN",
			status: "succeeded",
			refundStatus: "none",
			attemptNumber: 1,
			createdAt: NOW,
			updatedAt: NOW,
		});
		// Tab payment: sessionId only, no orderId (the XOR shape the old
		// orders-driven cascade missed).
		const tabPaymentId = await ctx.db.insert("payments", {
			restaurantId,
			sessionId,
			amount: 90,
			currency: "MXN",
			status: "succeeded",
			refundStatus: "none",
			attemptNumber: 1,
			createdAt: NOW,
			updatedAt: NOW,
		});
		const webhookEventIds = [
			await ctx.db.insert("stripeWebhookEvents", {
				eventId: "evt_order",
				eventType: "payment_intent.succeeded",
				paymentId: orderPaymentId,
				processedAt: NOW,
				createdAt: NOW,
			}),
			await ctx.db.insert("stripeWebhookEvents", {
				eventId: "evt_tab",
				eventType: "payment_intent.succeeded",
				paymentId: tabPaymentId,
				processedAt: NOW,
				createdAt: NOW,
			}),
		];
		await ctx.db.insert("stripeDisputes", {
			stripeDisputeId: "dp_1",
			restaurantId,
			paymentId: tabPaymentId,
			reason: "fraudulent",
			status: "needs_response",
			amount: 90,
			currency: "MXN",
			createdAt: NOW,
			updatedAt: NOW,
		});

		await ctx.db.insert("reservations", {
			restaurantId,
			partySize: 2,
			startsAt: NOW,
			endsAt: NOW + 90 * 60 * 1000,
			tableIds: [tableId],
			status: "confirmed",
			source: "ui",
			contact: { name: "Diner", phone: "+521234567890" },
			createdAt: NOW,
			updatedAt: NOW,
		});
		await ctx.db.insert("tableLocks", {
			restaurantId,
			tableId,
			startsAt: NOW,
			endsAt: NOW + 60 * 60 * 1000,
			lockedBy: "member-user",
			createdAt: NOW,
		});
		await ctx.db.insert("reservationSettings", {
			restaurantId,
			defaultTurnMinutes: 90,
			turnMinutesByCapacity: [],
			minAdvanceMinutes: 30,
			maxAdvanceDays: 60,
			noShowGraceMinutes: 15,
			blackoutWindows: [],
			acceptingReservations: true,
			createdAt: NOW,
			updatedAt: NOW,
		});

		const shiftId = await ctx.db.insert("shifts", {
			memberId,
			restaurantId,
			startsAt: NOW,
			endsAt: NOW + 8 * 60 * 60 * 1000,
			status: "published",
			createdBy: "member-user",
			createdAt: NOW,
			updatedAt: NOW,
		});
		await ctx.db.insert("shiftTemplates", {
			memberId,
			restaurantId,
			organizationId: orgId,
			dayOfWeek: 0,
			startMinutesFromMidnight: 9 * 60,
			durationMinutes: 8 * 60,
			activeFromYmd: "2026-01-01",
			isActive: true,
			createdBy: "member-user",
			createdAt: NOW,
			updatedAt: NOW,
		});
		await ctx.db.insert("shiftTableAssignments", {
			shiftId,
			restaurantId,
			tableId,
			startsAt: NOW,
			endsAt: NOW + 4 * 60 * 60 * 1000,
			createdBy: "member-user",
			createdAt: NOW,
			updatedAt: NOW,
		});
		await ctx.db.insert("shiftSectionAssignments", {
			shiftId,
			restaurantId,
			sectionId,
			startsAt: NOW,
			endsAt: NOW + 4 * 60 * 60 * 1000,
			createdBy: "member-user",
			createdAt: NOW,
			updatedAt: NOW,
		});
		await ctx.db.insert("shiftAttendance", {
			shiftId,
			restaurantId,
			memberId,
			status: "present",
			scheduledStart: NOW,
			scheduledEnd: NOW + 8 * 60 * 60 * 1000,
			lateMinutes: 0,
			earlyDepartureMinutes: 0,
			lastComputedAt: NOW,
		});
		await ctx.db.insert("clockEvents", {
			memberId,
			restaurantId,
			type: "in",
			at: NOW,
			source: "web",
			createdAt: NOW,
		});
		await ctx.db.insert("absences", {
			memberId,
			restaurantId,
			date: "2026-08-01",
			type: "vacation",
			status: "approved",
			requestedAt: NOW,
			createdBy: "member-user",
			createdAt: NOW,
			updatedAt: NOW,
		});

		const poolId = await ctx.db.insert("tipPools", {
			restaurantId,
			businessDate: "2026-08-01",
			totalAmountCents: 5000,
			distributionRule: "equal",
			status: "open",
			createdBy: "member-user",
			createdAt: NOW,
			updatedAt: NOW,
		});
		const tipPoolShareId = await ctx.db.insert("tipPoolShares", {
			poolId,
			memberId,
			hoursWorked: 8,
			points: 1,
			sharePercent: 100,
			amountCents: 5000,
			createdAt: NOW,
			updatedAt: NOW,
		});
		await ctx.db.insert("tipEntries", {
			restaurantId,
			memberId,
			source: "cash",
			amountCents: 5000,
			enteredBy: "member-user",
			enteredAt: NOW,
			businessDate: "2026-08-01",
			createdAt: NOW,
			updatedAt: NOW,
		});

		await ctx.db.insert("dashboardLayouts", {
			userId: "member-user",
			scopeKind: "restaurant",
			restaurantId,
			name: "Ops",
			position: 0,
			config: { globalDateRange: "last7", compareToPrev: false, widgets: [] },
			createdAt: NOW,
			updatedAt: NOW,
		});
		await ctx.db.insert("dashboardTemplates", {
			restaurantId,
			publishedBy: "member-user",
			name: "Starter",
			config: {},
			createdAt: NOW,
			updatedAt: NOW,
		});

		return { photoStorageId, imageStorageId, orderItemId, webhookEventIds, tipPoolShareId };
	});
}

describe("restaurant hard purge cascade", () => {
	it("deletes every scoped row, keeps other restaurants and users intact, and records counts", async () => {
		const t = convexTest(schema, modules);
		const orgId = await seedOrg(t, "Purge Org");
		const aId = await seedRestaurant(t, { orgId, slug: "purged", softDeleted: true });
		const bId = await seedRestaurant(t, { orgId, slug: "survivor", softDeleted: false });

		const aGraph = await seedFullGraph(t, orgId, aId);

		// Control rows for the surviving restaurant B (spot-checks, not the full graph).
		const bRows = await t.run(async (ctx) => {
			const memberId = await ctx.db.insert("restaurantMembers", {
				userId: "b-member",
				restaurantId: bId,
				organizationId: orgId,
				role: "manager",
				isActive: true,
				createdAt: NOW,
				updatedAt: NOW,
			});
			const employeeAccountId = await ctx.db.insert("employeeAccounts", {
				restaurantId: bId,
				organizationId: orgId,
				firstName: "Beto",
				paternalLastname: "Ruiz",
				maternalLastname: "Sol",
				pinHash: "hash-b",
				pinSetAt: NOW,
				pinResetCount: 0,
				failedPinAttempts: 0,
				createdAt: NOW,
				updatedAt: NOW,
			});
			const sessionId = await ctx.db.insert("sessions", {
				restaurantId: bId,
				status: "active",
				startedAt: NOW,
			});
			const tabPaymentId = await ctx.db.insert("payments", {
				restaurantId: bId,
				sessionId,
				amount: 50,
				currency: "MXN",
				status: "succeeded",
				refundStatus: "none",
				attemptNumber: 1,
				createdAt: NOW,
				updatedAt: NOW,
			});
			const layoutId = await ctx.db.insert("dashboardLayouts", {
				userId: "b-member",
				scopeKind: "restaurant",
				restaurantId: bId,
				name: "B ops",
				position: 0,
				config: { globalDateRange: "last7", compareToPrev: false, widgets: [] },
				createdAt: NOW,
				updatedAt: NOW,
			});
			return { memberId, employeeAccountId, sessionId, tabPaymentId, layoutId };
		});

		// User-owned rows that must survive: a portfolio layout and an org role
		// whose legacy dev entries span both restaurants.
		const { portfolioLayoutId, userRoleId, invBothId, invOnlyAId } = await t.run(async (ctx) => {
			const portfolioLayoutId = await ctx.db.insert("dashboardLayouts", {
				userId: "member-user",
				scopeKind: "portfolio",
				name: "All my restaurants",
				position: 1,
				config: { globalDateRange: "last30", compareToPrev: false, widgets: [] },
				createdAt: NOW,
				updatedAt: NOW,
			});
			const userRoleId = await ctx.db.insert("userRoles", {
				userId: "member-user",
				roles: ["owner"],
				organizationId: undefined,
				devSavedMembershipRoles: [
					{ restaurantId: String(aId), role: "manager" },
					{ restaurantId: String(bId), role: "employee" },
				],
				createdAt: NOW,
				updatedAt: NOW,
			});
			const invBothId = await ctx.db.insert("invitations", {
				token: "inv-both",
				email: "both@example.com",
				organizationId: orgId,
				role: "manager",
				restaurantIds: [aId, bId],
				invitedBy: "owner-1",
				status: "pending",
				expiresAt: NOW + 7 * 24 * 60 * 60 * 1000,
				createdAt: NOW,
				updatedAt: NOW,
			});
			const invOnlyAId = await ctx.db.insert("invitations", {
				token: "inv-only-a",
				email: "only-a@example.com",
				organizationId: orgId,
				role: "employee",
				restaurantIds: [aId],
				invitedBy: "owner-1",
				status: "pending",
				expiresAt: NOW + 7 * 24 * 60 * 60 * 1000,
				createdAt: NOW,
				updatedAt: NOW,
			});
			return { portfolioLayoutId, userRoleId, invBothId, invOnlyAId };
		});

		const result = await t.mutation(internal.restaurantPurge.purgeRestaurantInternal, {
			restaurantId: aId,
		});
		expect(result.purged).toBe(true);

		// The returned summary reports exactly what was deleted.
		expect(result.purged && result.summary?.deleted).toEqual(EXPECTED_DELETED);
		expect(result.purged && result.summary?.patched).toEqual({
			[TABLE.INVITATIONS]: 2,
			[TABLE.USER_ROLES]: 1,
		});
		expect(result.purged && result.summary?.storageFilesDeleted).toBe(2);

		// No row in any purge-covered table still references the purged restaurant.
		await t.run(async (ctx) => {
			expect(await ctx.db.get(aId)).toBeNull();
			for (const table of RESTAURANT_PURGE_DELETED_TABLES) {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const rows = await ctx.db.query(table as any).collect();
				const leftovers = rows.filter(
					(row) => (row as { restaurantId?: Id<"restaurants"> }).restaurantId === aId
				);
				expect(leftovers, `table "${table}" still has rows for the purged restaurant`).toEqual([]);
			}
			// Tables without a restaurantId field, checked by seeded id.
			expect(await ctx.db.get(aGraph.orderItemId)).toBeNull();
			expect(await ctx.db.get(aGraph.tipPoolShareId)).toBeNull();
			for (const id of aGraph.webhookEventIds) expect(await ctx.db.get(id)).toBeNull();
			// Storage files are gone.
			expect(await ctx.storage.getUrl(aGraph.photoStorageId)).toBeNull();
			expect(await ctx.storage.getUrl(aGraph.imageStorageId)).toBeNull();
		});

		// The surviving restaurant and user-owned rows are untouched.
		await t.run(async (ctx) => {
			expect(await ctx.db.get(bId)).not.toBeNull();
			expect(await ctx.db.get(bRows.memberId)).not.toBeNull();
			expect(await ctx.db.get(bRows.employeeAccountId)).not.toBeNull();
			expect(await ctx.db.get(bRows.sessionId)).not.toBeNull();
			expect(await ctx.db.get(bRows.tabPaymentId)).not.toBeNull();
			expect(await ctx.db.get(bRows.layoutId)).not.toBeNull();
			expect(await ctx.db.get(portfolioLayoutId)).not.toBeNull();

			// userRoles row survives, scrubbed down to the other restaurant.
			const role = await ctx.db.get(userRoleId);
			expect(role).not.toBeNull();
			expect(role!.roles).toEqual(["owner"]);
			expect(role!.devSavedMembershipRoles).toEqual([
				{ restaurantId: String(bId), role: "employee" },
			]);

			// Invitation spanning both restaurants keeps the survivor and stays pending.
			const invBoth = await ctx.db.get(invBothId);
			expect(invBoth!.restaurantIds).toEqual([bId]);
			expect(invBoth!.status).toBe("pending");
			// Invitation covering only the purged restaurant is emptied and revoked.
			const invOnlyA = await ctx.db.get(invOnlyAId);
			expect(invOnlyA!.restaurantIds).toEqual([]);
			expect(invOnlyA!.status).toBe("revoked");
			expect(invOnlyA!.revokedBy).toBe("system");
		});

		// The audit event survives the purge and records what was removed.
		const events = await t.run(async (ctx) =>
			ctx.db
				.query("allEvents")
				.filter((q) => q.eq(q.field("eventType"), "restaurants.hard_deleted"))
				.collect()
		);
		const event = events.find((e) => e.aggregateId === String(aId));
		expect(event).toBeDefined();
		const payload = event!.payload as {
			name: string;
			slug: string;
			counts: Record<string, number>;
			patched: Record<string, number>;
			storageFilesDeleted: number;
			tablesCovered: string[];
		};
		expect(payload.name).toBe("purged");
		expect(payload.counts).toEqual({ [TABLE.RESTAURANTS]: 1, ...EXPECTED_DELETED });
		expect(payload.patched).toEqual({ [TABLE.INVITATIONS]: 2, [TABLE.USER_ROLES]: 1 });
		expect(payload.storageFilesDeleted).toBe(2);
		expect(payload.tablesCovered).toEqual([TABLE.RESTAURANTS, ...RESTAURANT_PURGE_DELETED_TABLES]);
	});

	it("does not fight the sections/tables soft-delete cron over the same rows", async () => {
		const t = convexTest(schema, modules);
		const orgId = await seedOrg(t, "Cron Org");
		const aId = await seedRestaurant(t, { orgId, slug: "purged-cron", softDeleted: true });
		const bId = await seedRestaurant(t, { orgId, slug: "survivor-cron", softDeleted: false });

		// Both sections are individually soft-deleted and past due — candidates
		// for softDeletePurge's sweep.
		const { bSectionId } = await t.run(async (ctx) => {
			await ctx.db.insert("sections", {
				restaurantId: aId,
				name: "A section",
				displayOrder: 0,
				isActive: false,
				deletedAt: PAST_DUE,
				deletedBy: "owner-1",
				hardDeleteAfterAt: PAST_DUE,
				createdAt: NOW,
				updatedAt: NOW,
			});
			const bSectionId = await ctx.db.insert("sections", {
				restaurantId: bId,
				name: "B section",
				displayOrder: 0,
				isActive: false,
				deletedAt: PAST_DUE,
				deletedBy: "owner-1",
				hardDeleteAfterAt: PAST_DUE,
				createdAt: NOW,
				updatedAt: NOW,
			});
			return { bSectionId };
		});

		// Restaurant purge removes A's section (already soft-deleted or not).
		const result = await t.mutation(internal.restaurantPurge.purgeRestaurantInternal, {
			restaurantId: aId,
		});
		expect(result.purged).toBe(true);
		expect(result.purged && result.summary?.deleted[TABLE.SECTIONS]).toBe(1);

		// The soft-delete cron then finds only B's section — no double delete, no throw.
		const sweep = await t.mutation(internal.softDeletePurge.purgeExpiredSoftDeletes, {});
		expect(sweep).toEqual({ sectionsPurged: 1, tablesPurged: 0 });
		await t.run(async (ctx) => {
			expect(await ctx.db.get(bSectionId)).toBeNull();
			expect(await ctx.db.get(bId)).not.toBeNull();
		});
	});
});
