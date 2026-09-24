import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
	ATTENDANCE_STATUS,
	PAYMENT_KIND,
	PAYMENT_REFUND_STATUS,
	PAYMENT_STATUS,
	RESTAURANT_MEMBER_ROLE,
	SHIFT_STATUS,
	TIP_ENTRY_SOURCE,
	USER_ROLES,
} from "../constants";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

const HOUR = 60 * 60 * 1000;

interface SeedOut {
	orgId: Id<"organizations">;
	restaurantId: Id<"restaurants">;
	otherRestaurantId: Id<"restaurants">;
	employeeMember: Id<"restaurantMembers">;
	otherRestaurantMember: Id<"restaurantMembers">;
	shiftId: Id<"shifts">;
	otherRestaurantShiftId: Id<"shifts">;
}

async function seedTips(t: ReturnType<typeof convexTest>): Promise<SeedOut> {
	return await t.run(async (ctx) => {
		const now = Date.now();
		const orgId = await ctx.db.insert("organizations", {
			name: "Tips Org",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		const restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner-user",
			organizationId: orgId,
			name: "Tips R",
			slug: "tips-r",
			currency: "USD",
			timezone: "UTC",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		const otherRestaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner-user",
			organizationId: orgId,
			name: "Other Tips R",
			slug: "other-tips-r",
			currency: "USD",
			timezone: "UTC",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		await ctx.db.insert("userRoles", {
			userId: "manager-user",
			roles: [USER_ROLES.MANAGER],
			organizationId: orgId,
			createdAt: now,
			updatedAt: now,
		});
		const employeeMember = await ctx.db.insert("restaurantMembers", {
			userId: "employee-user",
			restaurantId,
			organizationId: orgId,
			role: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		const otherRestaurantMember = await ctx.db.insert("restaurantMembers", {
			userId: "other-employee-user",
			restaurantId: otherRestaurantId,
			organizationId: orgId,
			role: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
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
		const startsAt = now + 24 * HOUR;
		const shiftId = await ctx.db.insert("shifts", {
			memberId: employeeMember,
			restaurantId,
			startsAt,
			endsAt: startsAt + 8 * HOUR,
			status: SHIFT_STATUS.SCHEDULED,
			createdBy: "manager-user",
			createdAt: now,
			updatedAt: now,
			updatedBy: "manager-user",
		});
		const otherRestaurantShiftId = await ctx.db.insert("shifts", {
			memberId: otherRestaurantMember,
			restaurantId: otherRestaurantId,
			startsAt,
			endsAt: startsAt + 8 * HOUR,
			status: SHIFT_STATUS.SCHEDULED,
			createdBy: "manager-user",
			createdAt: now,
			updatedAt: now,
			updatedBy: "manager-user",
		});
		return {
			orgId,
			restaurantId,
			otherRestaurantId,
			employeeMember,
			otherRestaurantMember,
			shiftId,
			otherRestaurantShiftId,
		};
	});
}

describe("addTipEntry scoping", () => {
	it("accepts memberId and shiftId scoped to the restaurant", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, employeeMember, shiftId } = await seedTips(t);
		const authed = t.withIdentity({ subject: "manager-user" });

		const [id, err] = await authed.mutation(api.tips.addTipEntry, {
			restaurantId,
			businessDate: "2026-06-21",
			amountCents: 500,
			source: TIP_ENTRY_SOURCE.CASH,
			memberId: employeeMember,
			shiftId,
		});

		expect(err).toBeNull();
		expect(id).toBeTruthy();
	});

	it("rejects memberId from another restaurant", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, otherRestaurantMember } = await seedTips(t);
		const authed = t.withIdentity({ subject: "manager-user" });

		const [id, err] = await authed.mutation(api.tips.addTipEntry, {
			restaurantId,
			businessDate: "2026-06-21",
			amountCents: 500,
			source: TIP_ENTRY_SOURCE.CASH,
			memberId: otherRestaurantMember,
		});

		expect(id).toBeNull();
		expect(err?.message).toBe("Team member not found for restaurant");
	});

	it("rejects shiftId from another restaurant", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, otherRestaurantShiftId } = await seedTips(t);
		const authed = t.withIdentity({ subject: "manager-user" });

		const [id, err] = await authed.mutation(api.tips.addTipEntry, {
			restaurantId,
			businessDate: "2026-06-21",
			amountCents: 500,
			source: TIP_ENTRY_SOURCE.CASH,
			shiftId: otherRestaurantShiftId,
		});

		expect(id).toBeNull();
		expect(err?.message).toBe("Shift not found");
	});

	it("rejects inactive memberId for the restaurant", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, employeeMember } = await seedTips(t);
		await t.run(async (ctx) => {
			await ctx.db.patch(employeeMember, { isActive: false });
		});
		const authed = t.withIdentity({ subject: "manager-user" });

		const [id, err] = await authed.mutation(api.tips.addTipEntry, {
			restaurantId,
			businessDate: "2026-06-21",
			amountCents: 500,
			source: TIP_ENTRY_SOURCE.CASH,
			memberId: employeeMember,
		});

		expect(id).toBeNull();
		expect(err?.message).toBe("Team member not found for restaurant");
	});
});

/**
 * The tip pool counts only tips that were actually collected.
 *
 * Every checkout attempt writes a payment row that carries the tip while it is
 * pending (TAVLI-99), so a diner who retries a declined card leaves superseded
 * and failed rows behind. The pool used to sum `gratuityAmount` over all of
 * them — money nobody paid, which `finalizeTipPool` then split among staff.
 */
describe("tip pool total counts only collected card tips", () => {
	const DATE = "2026-06-21";
	const OTHER_DATE = "2026-06-22";
	const CASH = 100;

	type PaymentOverrides = {
		orderId?: Id<"orders">;
		sessionId?: Id<"sessions">;
		status: (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS];
		refundStatus?: (typeof PAYMENT_REFUND_STATUS)[keyof typeof PAYMENT_REFUND_STATUS];
		gratuityAmount: number;
		kind?: (typeof PAYMENT_KIND)[keyof typeof PAYMENT_KIND];
		amountRefunded?: number;
	};

	async function seedVisit(
		t: ReturnType<typeof convexTest>,
		restaurantId: Id<"restaurants">,
		orderDates: Array<string | undefined>
	): Promise<{ sessionId: Id<"sessions">; orderIds: Id<"orders">[] }> {
		return await t.run(async (ctx) => {
			const now = Date.now();
			const tableId = await ctx.db.insert("tables", {
				restaurantId,
				tableNumber: Math.floor(Math.random() * 1_000_000),
				isActive: true,
				createdAt: now,
			});
			const sessionId = await ctx.db.insert("sessions", {
				restaurantId,
				tableId,
				status: "closed",
				startedAt: now,
			});
			const orderIds: Id<"orders">[] = [];
			for (const orderServiceDateKey of orderDates) {
				orderIds.push(
					await ctx.db.insert("orders", {
						sessionId,
						restaurantId,
						tableId,
						status: "served",
						totalAmount: 1000,
						...(orderServiceDateKey !== undefined && { orderServiceDateKey }),
						createdAt: now,
						updatedAt: now,
					})
				);
			}
			return { sessionId, orderIds };
		});
	}

	async function insertPayment(
		t: ReturnType<typeof convexTest>,
		restaurantId: Id<"restaurants">,
		p: PaymentOverrides
	): Promise<void> {
		await t.run(async (ctx) => {
			const now = Date.now();
			const isTip = p.kind === PAYMENT_KIND.TIP;
			await ctx.db.insert("payments", {
				restaurantId,
				...(p.orderId && { orderId: p.orderId }),
				...(p.sessionId && { sessionId: p.sessionId }),
				amount: isTip ? p.gratuityAmount : 1000 + p.gratuityAmount,
				...(p.kind && { kind: p.kind }),
				gratuityAmount: p.gratuityAmount,
				currency: "USD",
				status: p.status,
				refundStatus: p.refundStatus ?? PAYMENT_REFUND_STATUS.NONE,
				...(p.amountRefunded !== undefined && { amountRefunded: p.amountRefunded }),
				attemptNumber: 1,
				createdAt: now,
				updatedAt: now,
			});
		});
	}

	/** Refresh the pool the way production does (a cash entry) and read it back. */
	async function poolTotal(
		t: ReturnType<typeof convexTest>,
		restaurantId: Id<"restaurants">,
		businessDate = DATE
	): Promise<number> {
		const authed = t.withIdentity({ subject: "manager-user" });
		const [, err] = await authed.mutation(api.tips.addTipEntry, {
			restaurantId,
			businessDate,
			amountCents: CASH,
			source: TIP_ENTRY_SOURCE.CASH,
		});
		expect(err).toBeNull();
		return (await readPool(t, restaurantId, businessDate)).pool!.totalAmountCents;
	}

	async function readPool(
		t: ReturnType<typeof convexTest>,
		restaurantId: Id<"restaurants">,
		businessDate: string
	) {
		return await t.run(async (ctx) => {
			const pool =
				(await ctx.db.query("tipPools").collect()).find(
					(row) => row.restaurantId === restaurantId && row.businessDate === businessDate
				) ?? null;
			const shares = pool
				? (await ctx.db.query("tipPoolShares").collect()).filter((row) => row.poolId === pool._id)
				: [];
			return { pool, shares };
		});
	}

	it("counts only the succeeded attempt among superseded, failed and pending rows for one order", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seedTips(t);
		const { orderIds } = await seedVisit(t, restaurantId, [DATE]);
		const orderId = orderIds[0];

		// The diner moved the slider and retried a declined card: 200 was on the
		// table across the attempts, 75 was collected.
		await insertPayment(t, restaurantId, {
			orderId,
			status: PAYMENT_STATUS.SUPERSEDED,
			gratuityAmount: 50,
		});
		await insertPayment(t, restaurantId, {
			orderId,
			status: PAYMENT_STATUS.FAILED,
			gratuityAmount: 40,
		});
		await insertPayment(t, restaurantId, {
			orderId,
			status: PAYMENT_STATUS.CANCELLED,
			gratuityAmount: 20,
		});
		await insertPayment(t, restaurantId, {
			orderId,
			status: PAYMENT_STATUS.PENDING,
			gratuityAmount: 15,
		});
		await insertPayment(t, restaurantId, {
			orderId,
			status: PAYMENT_STATUS.SUCCEEDED,
			gratuityAmount: 75,
		});

		expect(await poolTotal(t, restaurantId)).toBe(CASH + 75);
	});

	it("drops a fully refunded tip and keeps a partially refunded one whole, as tipFromPayment does", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seedTips(t);
		const { orderIds } = await seedVisit(t, restaurantId, [DATE, DATE]);

		await insertPayment(t, restaurantId, {
			orderId: orderIds[0],
			status: PAYMENT_STATUS.SUCCEEDED,
			refundStatus: PAYMENT_REFUND_STATUS.SUCCEEDED,
			amountRefunded: 1060,
			gratuityAmount: 60,
		});
		await insertPayment(t, restaurantId, {
			orderId: orderIds[1],
			status: PAYMENT_STATUS.SUCCEEDED,
			refundStatus: PAYMENT_REFUND_STATUS.PARTIAL,
			amountRefunded: 300,
			gratuityAmount: 30,
		});

		expect(await poolTotal(t, restaurantId)).toBe(CASH + 30);
	});

	it("counts a session-level payment once even when several of its orders carry the date", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seedTips(t);
		const { sessionId } = await seedVisit(t, restaurantId, [DATE, DATE, DATE]);

		// A legacy tab settlement and an ADR 008 tip row both hang off the
		// session, not an order.
		await insertPayment(t, restaurantId, {
			sessionId,
			status: PAYMENT_STATUS.SUCCEEDED,
			gratuityAmount: 90,
		});
		await insertPayment(t, restaurantId, {
			sessionId,
			kind: PAYMENT_KIND.TIP,
			status: PAYMENT_STATUS.SUCCEEDED,
			gratuityAmount: 25,
		});
		// A failed one-tap tip on the same session moved no money.
		await insertPayment(t, restaurantId, {
			sessionId,
			kind: PAYMENT_KIND.TIP,
			status: PAYMENT_STATUS.FAILED,
			gratuityAmount: 500,
		});

		expect(await poolTotal(t, restaurantId)).toBe(CASH + 90 + 25);
	});

	it("does not count an order payment twice when it also carries its session id", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seedTips(t);
		const { sessionId, orderIds } = await seedVisit(t, restaurantId, [DATE]);

		await insertPayment(t, restaurantId, {
			orderId: orderIds[0],
			sessionId,
			status: PAYMENT_STATUS.SUCCEEDED,
			gratuityAmount: 40,
		});

		expect(await poolTotal(t, restaurantId)).toBe(CASH + 40);
	});

	it("excludes tips that belong to a different business date", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seedTips(t);
		const today = await seedVisit(t, restaurantId, [DATE]);
		const tomorrow = await seedVisit(t, restaurantId, [OTHER_DATE]);
		const unkeyed = await seedVisit(t, restaurantId, [undefined]);

		await insertPayment(t, restaurantId, {
			orderId: today.orderIds[0],
			status: PAYMENT_STATUS.SUCCEEDED,
			gratuityAmount: 10,
		});
		await insertPayment(t, restaurantId, {
			orderId: tomorrow.orderIds[0],
			status: PAYMENT_STATUS.SUCCEEDED,
			gratuityAmount: 300,
		});
		await insertPayment(t, restaurantId, {
			sessionId: tomorrow.sessionId,
			kind: PAYMENT_KIND.TIP,
			status: PAYMENT_STATUS.SUCCEEDED,
			gratuityAmount: 70,
		});
		await insertPayment(t, restaurantId, {
			orderId: unkeyed.orderIds[0],
			status: PAYMENT_STATUS.SUCCEEDED,
			gratuityAmount: 999,
		});

		expect(await poolTotal(t, restaurantId, DATE)).toBe(CASH + 10);
		expect(await poolTotal(t, restaurantId, OTHER_DATE)).toBe(CASH + 300 + 70);
	});

	it("excludes another restaurant's tips", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, otherRestaurantId } = await seedTips(t);
		const other = await seedVisit(t, otherRestaurantId, [DATE]);

		await insertPayment(t, otherRestaurantId, {
			orderId: other.orderIds[0],
			status: PAYMENT_STATUS.SUCCEEDED,
			gratuityAmount: 55,
		});

		expect(await poolTotal(t, restaurantId)).toBe(CASH);
	});

	it("finalizeTipPool splits only the collected money", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, employeeMember, shiftId } = await seedTips(t);
		const { orderIds } = await seedVisit(t, restaurantId, [DATE]);

		await insertPayment(t, restaurantId, {
			orderId: orderIds[0],
			status: PAYMENT_STATUS.FAILED,
			gratuityAmount: 125,
		});
		await insertPayment(t, restaurantId, {
			orderId: orderIds[0],
			status: PAYMENT_STATUS.SUCCEEDED,
			gratuityAmount: 75,
		});
		await t.run(async (ctx) => {
			const start = Date.UTC(2026, 5, 21, 15);
			await ctx.db.insert("shiftAttendance", {
				shiftId,
				restaurantId,
				memberId: employeeMember,
				status: ATTENDANCE_STATUS.PRESENT,
				scheduledStart: start,
				scheduledEnd: start + 4 * HOUR,
				actualStart: start,
				actualEnd: start + 4 * HOUR,
				lateMinutes: 0,
				earlyDepartureMinutes: 0,
				lastComputedAt: start,
			});
		});

		const authed = t.withIdentity({ subject: "manager-user" });
		const [, err] = await authed.mutation(api.tips.finalizeTipPool, {
			restaurantId,
			businessDate: DATE,
		});
		expect(err).toBeNull();

		const { pool, shares } = await readPool(t, restaurantId, DATE);
		expect(pool!.totalAmountCents).toBe(75);
		expect(shares.map((s) => s.amountCents)).toEqual([75]);
	});
});
