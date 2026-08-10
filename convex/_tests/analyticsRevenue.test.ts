/**
 * ADR 008 revenue semantics for the dashboard analytics queries.
 *
 * "Revenue" on a Tavli dashboard means what the **restaurant** sold: the food.
 * These tests pin the three rules that changed at the settlement pivot:
 *
 * - the customer-borne 12% Tavli service fee lives inside `payments.amount`
 *   and must not be counted as restaurant revenue;
 * - post-visit tips are their own `kind: "tip"` payment rows and must not be
 *   counted as sales;
 * - cash orders (`markOrderPaidInPerson`) are paid revenue with **no**
 *   `payments` row and must still be counted, from `orders.totalAmount`;
 * - legacy (pre-pivot) rows carry no split and keep falling back to `amount`.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
	PAYMENT_KIND,
	PAYMENT_REFUND_STATUS,
	PAYMENT_STATUS,
	RESTAURANT_MEMBER_ROLE,
	SETTLED_BY,
} from "../constants";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

type T = ReturnType<typeof convexTest>;

const DAY_MS = 86_400_000;
/** Fixed instant so day bucketing is deterministic: 2026-03-10 12:00 UTC. */
const PAID_AT = Date.UTC(2026, 2, 10, 12, 0, 0);
const RANGE = { from: PAID_AT - DAY_MS, to: PAID_AT + DAY_MS };

async function seedManagedRestaurant(t: T): Promise<{
	restaurantId: Id<"restaurants">;
	sessionId: Id<"sessions">;
	tableId: Id<"tables">;
}> {
	return await t.run(async (ctx) => {
		const now = Date.now();
		const orgId = await ctx.db.insert("organizations", {
			name: "Revenue Org",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		const restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner",
			organizationId: orgId,
			name: "Revenue R",
			slug: "revenue-r",
			currency: "MXN",
			timezone: "UTC",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		await ctx.db.insert("restaurantMembers", {
			userId: "mgr",
			restaurantId,
			organizationId: orgId,
			role: RESTAURANT_MEMBER_ROLE.MANAGER,
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		const tableId = await ctx.db.insert("tables", {
			restaurantId,
			tableNumber: 3,
			isActive: true,
			createdAt: now,
		});
		const sessionId = await ctx.db.insert("sessions", {
			restaurantId,
			tableId,
			status: "active",
			startedAt: now,
		});
		return { restaurantId, sessionId, tableId };
	});
}

/**
 * Seeds one of each vintage:
 * - a post-pivot card order (10,000 food + 1,200 fee = 11,200 charged),
 * - the diner's post-visit tip (2,000),
 * - a legacy tab payment with no split (5,500, tip folded in),
 * - a cash order marked paid in person (3,000, no payments row).
 *
 * Restaurant revenue is therefore 10,000 + 5,500 + 3,000 = 18,500, and three
 * orders are paid.
 */
async function seedMixedVintages(
	t: T,
	ids: { restaurantId: Id<"restaurants">; sessionId: Id<"sessions">; tableId: Id<"tables"> }
) {
	await t.run(async (ctx) => {
		const base = {
			sessionId: ids.sessionId,
			restaurantId: ids.restaurantId,
			tableId: ids.tableId,
			createdAt: PAID_AT,
			updatedAt: PAID_AT,
		};

		const cardOrderId = await ctx.db.insert("orders", {
			...base,
			status: "served",
			totalAmount: 10000,
			paidAt: PAID_AT,
			submittedAt: PAID_AT,
			settledBy: SETTLED_BY.STRIPE,
		});
		await ctx.db.insert("payments", {
			restaurantId: ids.restaurantId,
			orderId: cardOrderId,
			amount: 11200,
			subtotalAmount: 10000,
			feeAmount: 1200,
			kind: PAYMENT_KIND.ORDER,
			currency: "MXN",
			status: PAYMENT_STATUS.SUCCEEDED,
			refundStatus: PAYMENT_REFUND_STATUS.NONE,
			attemptNumber: 1,
			succeededAt: PAID_AT,
			createdAt: PAID_AT,
			updatedAt: PAID_AT,
		});

		await ctx.db.insert("payments", {
			restaurantId: ids.restaurantId,
			sessionId: ids.sessionId,
			amount: 2000,
			subtotalAmount: 0,
			feeAmount: 0,
			gratuityAmount: 2000,
			kind: PAYMENT_KIND.TIP,
			paidByUserId: "diner",
			currency: "MXN",
			status: PAYMENT_STATUS.SUCCEEDED,
			refundStatus: PAYMENT_REFUND_STATUS.NONE,
			attemptNumber: 1,
			succeededAt: PAID_AT,
			createdAt: PAID_AT,
			updatedAt: PAID_AT,
		});

		const legacyOrderId = await ctx.db.insert("orders", {
			...base,
			status: "served",
			totalAmount: 5000,
			paidAt: PAID_AT,
			submittedAt: PAID_AT,
		});
		await ctx.db.insert("payments", {
			restaurantId: ids.restaurantId,
			orderId: legacyOrderId,
			amount: 5500,
			gratuityAmount: 500,
			currency: "MXN",
			status: PAYMENT_STATUS.SUCCEEDED,
			refundStatus: PAYMENT_REFUND_STATUS.NONE,
			attemptNumber: 1,
			succeededAt: PAID_AT,
			createdAt: PAID_AT,
			updatedAt: PAID_AT,
		});

		await ctx.db.insert("orders", {
			...base,
			status: "served",
			totalAmount: 3000,
			paidAt: PAID_AT,
			submittedAt: PAID_AT,
			settledBy: SETTLED_BY.STAFF,
		});
	});
}

const EXPECTED_RESTAURANT_REVENUE = 10000 + 5500 + 3000;

describe("analytics.revenueOverTime (ADR 008 semantics)", () => {
	it("buckets restaurant revenue: no service fee, no tips, cash included", async () => {
		const t = convexTest(schema, modules);
		const ids = await seedManagedRestaurant(t);
		await seedMixedVintages(t, ids);

		const [result, err] = await t
			.withIdentity({ subject: "mgr" })
			.query(api.analytics.revenueOverTime.compute, {
				scopeKind: "restaurant",
				restaurantId: ids.restaurantId,
				range: RANGE,
				compareToPrev: false,
			});

		expect(err).toBeNull();
		expect(result?.buckets).toEqual([{ date: "2026-03-10", amount: EXPECTED_RESTAURANT_REVENUE }]);
	});

	it("counts a cash order even when it is the only revenue in the window", async () => {
		const t = convexTest(schema, modules);
		const ids = await seedManagedRestaurant(t);
		await t.run(async (ctx) => {
			await ctx.db.insert("orders", {
				sessionId: ids.sessionId,
				restaurantId: ids.restaurantId,
				tableId: ids.tableId,
				status: "served",
				totalAmount: 4200,
				paidAt: PAID_AT,
				submittedAt: PAID_AT,
				settledBy: SETTLED_BY.STAFF,
				createdAt: PAID_AT,
				updatedAt: PAID_AT,
			});
		});

		const [result] = await t
			.withIdentity({ subject: "mgr" })
			.query(api.analytics.revenueOverTime.compute, {
				scopeKind: "restaurant",
				restaurantId: ids.restaurantId,
				range: RANGE,
				compareToPrev: false,
			});

		expect(result?.buckets).toEqual([{ date: "2026-03-10", amount: 4200 }]);
	});

	it("ignores an order awaiting in-person payment until staff collect it", async () => {
		const t = convexTest(schema, modules);
		const ids = await seedManagedRestaurant(t);
		await t.run(async (ctx) => {
			await ctx.db.insert("orders", {
				sessionId: ids.sessionId,
				restaurantId: ids.restaurantId,
				tableId: ids.tableId,
				status: "awaiting_payment",
				totalAmount: 4200,
				awaitingPaymentAt: PAID_AT,
				settledBy: SETTLED_BY.STAFF,
				createdAt: PAID_AT,
				updatedAt: PAID_AT,
			});
		});

		const [result] = await t
			.withIdentity({ subject: "mgr" })
			.query(api.analytics.revenueOverTime.compute, {
				scopeKind: "restaurant",
				restaurantId: ids.restaurantId,
				range: RANGE,
				compareToPrev: false,
			});

		expect(result?.buckets).toEqual([]);
	});

	it("ignores a failed charge", async () => {
		const t = convexTest(schema, modules);
		const ids = await seedManagedRestaurant(t);
		await t.run(async (ctx) => {
			await ctx.db.insert("payments", {
				restaurantId: ids.restaurantId,
				sessionId: ids.sessionId,
				amount: 11200,
				subtotalAmount: 10000,
				feeAmount: 1200,
				kind: PAYMENT_KIND.ORDER,
				currency: "MXN",
				status: PAYMENT_STATUS.FAILED,
				refundStatus: PAYMENT_REFUND_STATUS.NONE,
				attemptNumber: 1,
				failedAt: PAID_AT,
				createdAt: PAID_AT,
				updatedAt: PAID_AT,
			});
		});

		const [result] = await t
			.withIdentity({ subject: "mgr" })
			.query(api.analytics.revenueOverTime.compute, {
				scopeKind: "restaurant",
				restaurantId: ids.restaurantId,
				range: RANGE,
				compareToPrev: false,
			});

		expect(result?.buckets).toEqual([]);
	});
});

describe("analytics.tipsTotal (ADR 008 semantics)", () => {
	it("counts card tips alongside the cash tips staff key in", async () => {
		const t = convexTest(schema, modules);
		const ids = await seedManagedRestaurant(t);
		await seedMixedVintages(t, ids);
		await t.run(async (ctx) => {
			await ctx.db.insert("tipEntries", {
				restaurantId: ids.restaurantId,
				source: "cash",
				amountCents: 700,
				enteredBy: "mgr",
				enteredAt: PAID_AT,
				businessDate: "2026-03-10",
				createdAt: PAID_AT,
				updatedAt: PAID_AT,
			});
		});

		const [result, err] = await t
			.withIdentity({ subject: "mgr" })
			.query(api.analytics.tipsTotal.compute, {
				restaurantId: ids.restaurantId,
				range: RANGE,
				compareToPrev: false,
			});

		expect(err).toBeNull();
		// 700 cash entry + 2,000 post-visit tip row + 500 legacy tab gratuity.
		expect(result?.totalCents).toBe(3200);
		expect(result?.buckets).toEqual([{ date: "2026-03-10", amountCents: 3200 }]);
	});

	it("never counts the food or the service fee as a tip", async () => {
		const t = convexTest(schema, modules);
		const ids = await seedManagedRestaurant(t);
		await t.run(async (ctx) => {
			const orderId = await ctx.db.insert("orders", {
				sessionId: ids.sessionId,
				restaurantId: ids.restaurantId,
				tableId: ids.tableId,
				status: "served",
				totalAmount: 10000,
				paidAt: PAID_AT,
				submittedAt: PAID_AT,
				settledBy: SETTLED_BY.STRIPE,
				createdAt: PAID_AT,
				updatedAt: PAID_AT,
			});
			await ctx.db.insert("payments", {
				restaurantId: ids.restaurantId,
				orderId,
				amount: 11200,
				subtotalAmount: 10000,
				feeAmount: 1200,
				kind: PAYMENT_KIND.ORDER,
				currency: "MXN",
				status: PAYMENT_STATUS.SUCCEEDED,
				refundStatus: PAYMENT_REFUND_STATUS.NONE,
				attemptNumber: 1,
				succeededAt: PAID_AT,
				createdAt: PAID_AT,
				updatedAt: PAID_AT,
			});
		});

		const [result] = await t
			.withIdentity({ subject: "mgr" })
			.query(api.analytics.tipsTotal.compute, {
				restaurantId: ids.restaurantId,
				range: RANGE,
				compareToPrev: false,
			});

		expect(result?.totalCents).toBe(0);
	});
});

describe("analytics.numberWithDelta money metrics (ADR 008 semantics)", () => {
	it("reports restaurant revenue, not what the diner was charged", async () => {
		const t = convexTest(schema, modules);
		const ids = await seedManagedRestaurant(t);
		await seedMixedVintages(t, ids);

		const [result, err] = await t
			.withIdentity({ subject: "mgr" })
			.query(api.analytics.numberWithDelta.compute, {
				scopeKind: "restaurant",
				restaurantId: ids.restaurantId,
				metric: "payments.revenueTotal",
				range: RANGE,
				compareToPrev: false,
			});

		expect(err).toBeNull();
		// 11,200 charged − 1,200 fee + 5,500 legacy + 3,000 cash; the 2,000 tip
		// row is not sales.
		expect(result?.current).toBe(EXPECTED_RESTAURANT_REVENUE);
	});

	it("divides average check by every paid order, cash included", async () => {
		const t = convexTest(schema, modules);
		const ids = await seedManagedRestaurant(t);
		await seedMixedVintages(t, ids);

		const [result] = await t
			.withIdentity({ subject: "mgr" })
			.query(api.analytics.numberWithDelta.compute, {
				scopeKind: "restaurant",
				restaurantId: ids.restaurantId,
				metric: "orders.avgCheck",
				range: RANGE,
				compareToPrev: false,
			});

		expect(result?.current).toBeCloseTo(EXPECTED_RESTAURANT_REVENUE / 3, 5);
	});
});
