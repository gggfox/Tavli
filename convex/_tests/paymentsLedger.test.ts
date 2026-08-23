/**
 * `orders.getPaymentsLedgerByRestaurant` — the staff Payments dashboard feed.
 *
 * ADR 008 put two different things in the `payments` table (order charges and
 * post-visit tips) and took one thing out of it entirely (cash orders). These
 * tests pin what a row reports for each of those shapes.
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

const PAID_AT = Date.UTC(2026, 2, 10, 12, 0, 0);

async function seedRestaurant(t: ReturnType<typeof convexTest>) {
	return await t.run(async (ctx) => {
		const now = Date.now();
		const organizationId = await ctx.db.insert("organizations", {
			name: "Ledger Org",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		const restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner",
			organizationId,
			name: "Ledger R",
			slug: "ledger-r",
			currency: "MXN",
			timezone: "UTC",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		await ctx.db.insert("restaurantMembers", {
			userId: "staff",
			restaurantId,
			organizationId,
			role: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		const tableId = await ctx.db.insert("tables", {
			restaurantId,
			tableNumber: 5,
			isActive: true,
			createdAt: now,
		});
		const sessionId = await ctx.db.insert("sessions", {
			restaurantId,
			tableId,
			status: "active",
			startedAt: now,
		});
		return { restaurantId, tableId, sessionId };
	});
}

async function ledger(t: ReturnType<typeof convexTest>, restaurantId: Id<"restaurants">) {
	const [rows, err] = await t
		.withIdentity({ subject: "staff" })
		.query(api.orders.getPaymentsLedgerByRestaurant, { restaurantId });
	expect(err).toBeNull();
	if (!Array.isArray(rows)) throw new Error("expected ledger rows");
	return rows;
}

describe("orders.getPaymentsLedgerByRestaurant", () => {
	it("splits a card order into subtotal, service fee and net to restaurant", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, tableId, sessionId } = await seedRestaurant(t);
		await t.run(async (ctx) => {
			const orderId = await ctx.db.insert("orders", {
				sessionId,
				restaurantId,
				tableId,
				status: "served",
				totalAmount: 10000,
				paidAt: PAID_AT,
				submittedAt: PAID_AT,
				settledBy: SETTLED_BY.STRIPE,
				dailyOrderNumber: 4,
				createdAt: PAID_AT,
				updatedAt: PAID_AT,
			});
			const paymentId = await ctx.db.insert("payments", {
				restaurantId,
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
			await ctx.db.patch(orderId, { activePaymentId: paymentId });
		});

		const rows = await ledger(t, restaurantId);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			rowKind: "order",
			dailyOrderNumber: 4,
			subtotalCents: 10000,
			serviceFeeCents: 1200,
			tipCents: 0,
			chargedCents: 11200,
			netToRestaurantCents: 10000,
			settledBy: SETTLED_BY.STRIPE,
		});
	});

	it("reports a cash order as a known zero fee, not an unknown one", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, tableId, sessionId } = await seedRestaurant(t);
		await t.run(async (ctx) => {
			await ctx.db.insert("orders", {
				sessionId,
				restaurantId,
				tableId,
				status: "served",
				totalAmount: 3000,
				paidAt: PAID_AT,
				submittedAt: PAID_AT,
				settledBy: SETTLED_BY.STAFF,
				createdAt: PAID_AT,
				updatedAt: PAID_AT,
			});
		});

		const rows = await ledger(t, restaurantId);
		expect(rows[0]).toMatchObject({
			rowKind: "order",
			subtotalCents: 3000,
			serviceFeeCents: 0,
			chargedCents: 3000,
			netToRestaurantCents: 3000,
			settledBy: SETTLED_BY.STAFF,
		});
	});

	it("leaves the fee unknown on a pre-pivot order with no recorded split", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, tableId, sessionId } = await seedRestaurant(t);
		await t.run(async (ctx) => {
			const orderId = await ctx.db.insert("orders", {
				sessionId,
				restaurantId,
				tableId,
				status: "served",
				totalAmount: 5000,
				paidAt: PAID_AT,
				submittedAt: PAID_AT,
				createdAt: PAID_AT,
				updatedAt: PAID_AT,
			});
			const paymentId = await ctx.db.insert("payments", {
				restaurantId,
				orderId,
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
			await ctx.db.patch(orderId, { activePaymentId: paymentId });
		});

		const rows = await ledger(t, restaurantId);
		expect(rows[0]).toMatchObject({
			subtotalCents: 5000,
			serviceFeeCents: null,
			tipCents: 500,
			chargedCents: 5500,
			netToRestaurantCents: null,
		});
	});

	it("lists a post-visit tip as its own row with no food revenue", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, sessionId } = await seedRestaurant(t);
		await t.run(async (ctx) => {
			await ctx.db.insert("payments", {
				restaurantId,
				sessionId,
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
		});

		const rows = await ledger(t, restaurantId);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			rowKind: "tip",
			dailyOrderNumber: null,
			tableNumber: 5,
			subtotalCents: 0,
			serviceFeeCents: 0,
			tipCents: 2000,
			netToRestaurantCents: 2000,
			items: [],
		});
	});

	it("excludes an in-flight tip charge until it succeeds", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, sessionId } = await seedRestaurant(t);
		await t.run(async (ctx) => {
			await ctx.db.insert("payments", {
				restaurantId,
				sessionId,
				amount: 2000,
				subtotalAmount: 0,
				feeAmount: 0,
				gratuityAmount: 2000,
				kind: PAYMENT_KIND.TIP,
				currency: "MXN",
				status: PAYMENT_STATUS.PENDING,
				refundStatus: PAYMENT_REFUND_STATUS.NONE,
				attemptNumber: 1,
				createdAt: PAID_AT,
				updatedAt: PAID_AT,
			});
		});

		expect(await ledger(t, restaurantId)).toEqual([]);
	});

	it("counts a legacy tab's tip once, not once per order it covered", async () => {
		// `sessions.confirmTabPayment` stamps ONE tab payment as `activePaymentId`
		// on EVERY order it covers. Reading the gratuity off each order row
		// reported 4000 of tips for the 2000 actually collected.
		const t = convexTest(schema, modules);
		const { restaurantId, tableId, sessionId } = await seedRestaurant(t);
		await t.run(async (ctx) => {
			const paymentId = await ctx.db.insert("payments", {
				restaurantId,
				sessionId,
				amount: 10000,
				gratuityAmount: 2000,
				currency: "MXN",
				status: PAYMENT_STATUS.SUCCEEDED,
				refundStatus: PAYMENT_REFUND_STATUS.NONE,
				attemptNumber: 1,
				succeededAt: PAID_AT,
				createdAt: PAID_AT,
				updatedAt: PAID_AT,
			});
			for (const totalAmount of [5000, 3000]) {
				await ctx.db.insert("orders", {
					sessionId,
					restaurantId,
					tableId,
					status: "served",
					totalAmount,
					paidAt: PAID_AT,
					submittedAt: PAID_AT,
					activePaymentId: paymentId,
					createdAt: PAID_AT,
					updatedAt: PAID_AT,
				});
			}
		});

		const rows = await ledger(t, restaurantId);
		const orderRows = rows.filter((r) => r.rowKind === "order");
		const tipRows = rows.filter((r) => r.rowKind === "tip");

		expect(orderRows).toHaveLength(2);
		for (const row of orderRows) {
			// The tab's money is not this order's money.
			expect(row.tipCents).toBe(0);
			expect(row.serviceFeeCents).toBeNull();
			expect(row.netToRestaurantCents).toBeNull();
			expect(row.chargedCents).toBe(row.subtotalCents);
		}
		expect(orderRows.map((r) => r.subtotalCents).sort((a, b) => a - b)).toEqual([3000, 5000]);

		// The gratuity survives — exactly once, on its own row.
		expect(tipRows).toHaveLength(1);
		expect(tipRows[0]).toMatchObject({ subtotalCents: 0, tipCents: 2000, chargedCents: 2000 });
		expect(rows.reduce((sum, r) => sum + r.tipCents, 0)).toBe(2000);
		// Order rows + the tip row partition the tab charge exactly.
		expect(rows.reduce((sum, r) => sum + r.chargedCents, 0)).toBe(10000);
	});

	it("includes an accepted substitution's fee on the substituted order's row", async () => {
		// `applySubstitutionSwap` raises `orders.totalAmount` by the delta, but
		// the fee on that delta rode a separate PaymentIntent — reading only the
		// order payment's `feeAmount` under-reported what the diner paid Tavli.
		const t = convexTest(schema, modules);
		const { restaurantId, tableId, sessionId } = await seedRestaurant(t);
		await t.run(async (ctx) => {
			const orderId = await ctx.db.insert("orders", {
				sessionId,
				restaurantId,
				tableId,
				status: "served",
				// 10000 submitted + a 2000 substitution delta.
				totalAmount: 12000,
				paidAt: PAID_AT,
				submittedAt: PAID_AT,
				settledBy: SETTLED_BY.STRIPE,
				createdAt: PAID_AT,
				updatedAt: PAID_AT,
			});
			const paymentId = await ctx.db.insert("payments", {
				restaurantId,
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
			await ctx.db.patch(orderId, { activePaymentId: paymentId });
			await ctx.db.insert("payments", {
				restaurantId,
				orderId,
				sessionId,
				amount: 2240,
				subtotalAmount: 2000,
				feeAmount: 240,
				kind: PAYMENT_KIND.SUBSTITUTION,
				currency: "MXN",
				status: PAYMENT_STATUS.SUCCEEDED,
				refundStatus: PAYMENT_REFUND_STATUS.NONE,
				attemptNumber: 1,
				succeededAt: PAID_AT,
				createdAt: PAID_AT,
				updatedAt: PAID_AT,
			});
		});

		const rows = await ledger(t, restaurantId);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			rowKind: "order",
			subtotalCents: 12000,
			serviceFeeCents: 1440,
			chargedCents: 13440,
			netToRestaurantCents: 12000,
		});
	});
});
