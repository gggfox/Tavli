/**
 * `stripeHelpers.createPayment` re-checks the ORDER inside the inserting
 * transaction.
 *
 * The bug these pin: `createPaymentIntent` reads the order, then spends a
 * Stripe round trip or two (the diner's Customer, standing down an old intent)
 * before `createPayment` inserts the row and repoints the order. In that window
 * a waiter can tap "mark paid in person" — `markOrderPaidInPerson` only refuses
 * while a LIVE card attempt exists, and there is none yet — and the card charge
 * then goes ahead and `confirmPayment` accepts it over the cash settlement. The
 * same window lets a row priced on a stale total go in after another member
 * edits the shared draft.
 *
 * So `createPayment` refuses, with a stable code, unless the order still exists,
 * is draft / awaiting_payment, is not already settled, and its `updatedAt` still
 * equals the snapshot the action priced from. Refusing happens before anything
 * is written and before Stripe is asked for an intent.
 */
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { insertMenuForRestaurant } from "../menus";
import schema from "../schema";
import { mockStripeClient } from "./_fixtures/stripeMock.fixture";

const modules = import.meta.glob("../**/*.ts");

vi.mock("stripe", async () => (await import("./_fixtures/stripeMock.fixture")).stripeModuleMock());

type TestConvex = ReturnType<typeof convexTest>;

const OWNER = "owner-order-guard";
const DINER = "diner-order-guard";

/**
 * A card-ready restaurant with an owner, one table, an active session and one
 * menu item, plus a draft order the diner built through the real mutations.
 * `cash: true` also commits the round to cash (`awaiting_payment`), which is
 * the state a diner can still switch back to card from.
 */
async function seed(t: TestConvex, options: { cash?: boolean } = {}) {
	let restaurantId: Id<"restaurants">;
	let tableId: Id<"tables">;
	let sessionId: Id<"sessions">;
	let menuItemId: Id<"menuItems">;

	await t.run(async (ctx) => {
		const organizationId = await ctx.db.insert("organizations", {
			name: "Order Guard Org",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		restaurantId = await ctx.db.insert("restaurants", {
			ownerId: OWNER,
			organizationId,
			name: "Order Guard Restaurant",
			slug: `order-guard-${Math.random().toString(36).slice(2, 10)}`,
			currency: "USD",
			stripeAccountId: "acct_order_guard",
			stripeOnboardingComplete: true,
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		await ctx.db.insert("userRoles", {
			userId: OWNER,
			roles: ["owner"],
			organizationId,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		const menuId = await insertMenuForRestaurant(ctx, {
			restaurantId,
			name: "main",
			userId: OWNER,
		});
		const categoryId = await ctx.db.insert("menuCategories", {
			menuId,
			restaurantId,
			name: "Starters",
			displayOrder: 0,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		menuItemId = await ctx.db.insert("menuItems", {
			categoryId,
			restaurantId,
			name: "Tacos",
			basePrice: 600,
			isAvailable: true,
			displayOrder: 0,
			prepStation: "kitchen",
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		tableId = await ctx.db.insert("tables", {
			restaurantId,
			tableNumber: 7,
			isActive: true,
			createdAt: Date.now(),
		});
		sessionId = await ctx.db.insert("sessions", {
			restaurantId,
			tableId,
			userId: DINER,
			status: "active",
			startedAt: Date.now(),
		});
	});

	const diner = t.withIdentity({ subject: DINER });
	const staff = t.withIdentity({ subject: OWNER });

	const orderId = await diner.mutation(api.orders.createDraft, {
		sessionId: sessionId!,
		tableId: tableId!,
	});
	await diner.mutation(api.orders.addItem, {
		orderId,
		menuItemId: menuItemId!,
		quantity: 2,
		selectedOptions: [],
	});
	if (options.cash) {
		await diner.mutation(api.orders.requestPayInPerson, { orderId });
	}

	return { restaurantId: restaurantId!, menuItemId: menuItemId!, orderId, diner, staff };
}

async function readOrder(t: TestConvex, orderId: Id<"orders">) {
	return await t.run(async (ctx) => ctx.db.get(orderId));
}

async function paymentsOf(t: TestConvex) {
	return await t.run(async (ctx) => ctx.db.query("payments").collect());
}

/** The row `createPaymentIntent` would insert for a 1_200 order, minus the snapshot. */
function orderRow(restaurantId: Id<"restaurants">, orderId: Id<"orders">) {
	return {
		restaurantId,
		orderId,
		amount: 1_344,
		subtotalAmount: 1_200,
		feeAmount: 144,
		kind: "order" as const,
		paidByUserId: DINER,
		currency: "usd",
		status: "pending" as const,
		refundStatus: "none" as const,
		attemptNumber: 1,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	process.env.STRIPE_SECRET_KEY = "sk_test_123";
	mockStripeClient.customers.create.mockResolvedValue({ id: "cus_order_guard" });
	mockStripeClient.paymentIntents.create.mockResolvedValue({
		id: "pi_order_guard",
		client_secret: "cs_order_guard",
	});
});

describe("createPaymentIntent — the order moves between the snapshot and the insert", () => {
	it("refuses the card when staff mark the round paid in person mid-flight", async () => {
		const t = convexTest(schema, modules);
		const { orderId, diner, staff } = await seed(t, { cash: true });

		// `customers.create` runs AFTER the action read its snapshot and BEFORE
		// `createPayment` — exactly the window a waiter's tap lands in.
		mockStripeClient.customers.create.mockImplementationOnce(async () => {
			const [, error] = await staff.mutation(api.orders.markOrderPaidInPerson, { orderId });
			expect(error).toBeNull();
			return { id: "cus_order_guard" };
		});

		await expect(diner.action(api.stripe.createPaymentIntent, { orderId })).rejects.toThrow(
			/ERROR_PAYMENT_ALREADY_PAID/
		);

		// No row, no intent, and the cash settlement stands exactly as staff left
		// it — in particular the action's catch never ran to mark it `failed`.
		expect(await paymentsOf(t)).toHaveLength(0);
		expect(mockStripeClient.paymentIntents.create).not.toHaveBeenCalled();
		const order = await readOrder(t, orderId);
		expect(order?.paymentState).toBe("paid");
		expect(order?.settledBy).toBe("staff");
		expect(order?.status).toBe("submitted");
		expect(order?.activePaymentId).toBeUndefined();
	});

	it("refuses a charge priced on a total the shared draft has since changed", async () => {
		const t = convexTest(schema, modules);
		const { orderId, menuItemId, diner } = await seed(t);

		const secondTab = t.withIdentity({ subject: DINER });
		mockStripeClient.customers.create.mockImplementationOnce(async () => {
			// `updatedAt` is millisecond-grained; a real edit arrives at least a
			// network round trip after the snapshot, never inside the same ms.
			await new Promise((resolve) => setTimeout(resolve, 5));
			await secondTab.mutation(api.orders.addItem, {
				orderId,
				menuItemId,
				quantity: 1,
				selectedOptions: [],
			});
			return { id: "cus_order_guard" };
		});
		const before = await readOrder(t, orderId);

		await expect(diner.action(api.stripe.createPaymentIntent, { orderId })).rejects.toThrow(
			/ERROR_PAYMENT_ORDER_CHANGED/
		);

		expect(await paymentsOf(t)).toHaveLength(0);
		expect(mockStripeClient.paymentIntents.create).not.toHaveBeenCalled();
		const after = await readOrder(t, orderId);
		// The edit landed; the payment bookkeeping did not.
		expect(after?.totalAmount).toBeGreaterThan(before!.totalAmount);
		expect(after?.paymentState).toBe(before?.paymentState);
		expect(after?.activePaymentId).toBeUndefined();
	});

	it("still creates the payment and the intent when nothing moved", async () => {
		const t = convexTest(schema, modules);
		const { orderId, diner } = await seed(t);
		const before = await readOrder(t, orderId);

		const result = await diner.action(api.stripe.createPaymentIntent, { orderId });

		expect(result.clientSecret).toBe("cs_order_guard");
		expect(mockStripeClient.paymentIntents.create).toHaveBeenCalledTimes(1);
		const payments = await paymentsOf(t);
		expect(payments).toHaveLength(1);
		expect(payments[0]).toMatchObject({
			orderId,
			status: "processing",
			orderUpdatedAtSnapshot: before!.updatedAt,
		});
		const order = await readOrder(t, orderId);
		expect(order?.activePaymentId).toBe(result.paymentId);
		expect(order?.paymentState).toBe("processing");
		// The bookkeeping writes keep `updatedAt`, so a re-tap still matches.
		expect(order?.updatedAt).toBe(before!.updatedAt);
	});
});

describe("stripeHelpers.createPayment — the order guard itself", () => {
	it("throws ERROR_PAYMENT_ALREADY_PAID for an order paid in person, inserting nothing", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, orderId, staff } = await seed(t, { cash: true });
		const snapshot = (await readOrder(t, orderId))!.updatedAt;

		const [, error] = await staff.mutation(api.orders.markOrderPaidInPerson, { orderId });
		expect(error).toBeNull();
		const settled = await readOrder(t, orderId);

		await expect(
			t.mutation(internal.stripeHelpers.createPayment, {
				...orderRow(restaurantId, orderId),
				orderUpdatedAtSnapshot: snapshot,
			})
		).rejects.toThrow(/ERROR_PAYMENT_ALREADY_PAID/);

		expect(await paymentsOf(t)).toHaveLength(0);
		expect(await readOrder(t, orderId)).toEqual(settled);
	});

	it("throws ERROR_PAYMENT_ALREADY_PAID even when the caller's snapshot is current", async () => {
		// Settled is settled: the status/payment-state checks do not lean on
		// `updatedAt` having moved.
		const t = convexTest(schema, modules);
		const { restaurantId, orderId, staff } = await seed(t, { cash: true });
		await staff.mutation(api.orders.markOrderPaidInPerson, { orderId });
		const settled = await readOrder(t, orderId);

		await expect(
			t.mutation(internal.stripeHelpers.createPayment, {
				...orderRow(restaurantId, orderId),
				orderUpdatedAtSnapshot: settled!.updatedAt,
			})
		).rejects.toThrow(/ERROR_PAYMENT_ALREADY_PAID/);
		expect(await paymentsOf(t)).toHaveLength(0);
	});

	it("throws ERROR_PAYMENT_ORDER_CHANGED when updatedAt moved since the snapshot", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, orderId } = await seed(t);
		const snapshot = (await readOrder(t, orderId))!.updatedAt;
		await t.run(async (ctx) => {
			await ctx.db.patch(orderId, { updatedAt: snapshot + 5_000 });
		});
		const edited = await readOrder(t, orderId);

		await expect(
			t.mutation(internal.stripeHelpers.createPayment, {
				...orderRow(restaurantId, orderId),
				orderUpdatedAtSnapshot: snapshot,
			})
		).rejects.toThrow(/ERROR_PAYMENT_ORDER_CHANGED/);

		expect(await paymentsOf(t)).toHaveLength(0);
		expect(await readOrder(t, orderId)).toEqual(edited);
	});

	it("throws ERROR_PAYMENT_ORDER_CHANGED for an order no longer in a payable status", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, orderId } = await seed(t);
		const snapshot = (await readOrder(t, orderId))!.updatedAt;
		// Cancelled without touching `updatedAt`, so only the status can refuse.
		await t.run(async (ctx) => {
			await ctx.db.patch(orderId, { status: "cancelled" });
		});

		await expect(
			t.mutation(internal.stripeHelpers.createPayment, {
				...orderRow(restaurantId, orderId),
				orderUpdatedAtSnapshot: snapshot,
			})
		).rejects.toThrow(/ERROR_PAYMENT_ORDER_CHANGED/);
		expect(await paymentsOf(t)).toHaveLength(0);
	});

	it("inserts and repoints the order, keeping updatedAt, when the snapshot matches", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, orderId } = await seed(t, { cash: true });
		const before = await readOrder(t, orderId);

		const paymentId = await t.mutation(internal.stripeHelpers.createPayment, {
			...orderRow(restaurantId, orderId),
			orderUpdatedAtSnapshot: before!.updatedAt,
		});

		expect(await paymentsOf(t)).toHaveLength(1);
		const after = await readOrder(t, orderId);
		expect(after?.activePaymentId).toBe(paymentId);
		expect(after?.paymentState).toBe("pending");
		expect(after?.updatedAt).toBe(before!.updatedAt);
	});
});
