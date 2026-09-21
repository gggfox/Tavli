/**
 * The stuck order/tip payment sweep (TAVLI-106).
 *
 * Its own suite rather than more of `stripe.test.ts`, which is already the
 * longest file in `convex/_tests` and covers a different concern (the webhook
 * and the checkout actions). Everything here is the cron path: candidate
 * selection off `payments.by_status_updated`, and each branch of
 * `decidePaymentReconciliation` driven through the action with
 * `paymentIntents.retrieve` mocked.
 */
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
	ORDER_PAYMENT_RECONCILE_ALERT_AGE_MS,
	STUCK_PAYMENT_RECONCILE_BATCH_SIZE,
	TIP_PAYMENT_RECONCILE_ALERT_AGE_MS,
} from "../constants";
import { insertMenuForRestaurant } from "../menus";
import schema from "../schema";
import { mockStripeClient } from "./_fixtures/stripeMock.fixture";

const modules = import.meta.glob("../**/*.ts");

vi.mock("stripe", async () => (await import("./_fixtures/stripeMock.fixture")).stripeModuleMock());

const MINUTE = 60 * 1000;

async function seedRestaurant(t: ReturnType<typeof convexTest>) {
	let restaurantId: Id<"restaurants">;
	await t.run(async (ctx) => {
		const organizationId = await ctx.db.insert("organizations", {
			name: "Sweep Org",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		const slug = `sweep-${Math.random().toString(36).slice(2, 10)}`;
		restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner-sweep",
			organizationId,
			name: "Sweep Test Restaurant",
			slug,
			currency: "usd",
			stripeAccountId: "acct_sweep",
			stripeOnboardingComplete: true,
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		await insertMenuForRestaurant(ctx, { restaurantId, name: slug, userId: "owner-sweep" });
	});
	return restaurantId!;
}

/**
 * An order mid-checkout: the diner confirmed the card sheet, the row moved to
 * `processing` with its intent id, and `payment_intent.succeeded` never came.
 *
 * `orderStatus` is what separates the two interesting shapes — `awaiting_payment`
 * is the diner still at the sheet, anything later is a round the kitchen was
 * already released to cook and that staff now want to settle in cash.
 */
async function seedStuckOrderPayment(
	t: ReturnType<typeof convexTest>,
	args: {
		restaurantId: Id<"restaurants">;
		stripePaymentIntentId: string;
		amount: number;
		ageMs: number;
		orderStatus?: "awaiting_payment" | "submitted" | "served";
		/** Omitted on a legacy pre-pivot row, which carries no `kind` at all. */
		kind?: "order";
		paymentState?: "processing" | "unpaid";
	}
) {
	const now = Date.now();
	const stamp = now - args.ageMs;
	let orderId: Id<"orders">;
	let paymentId: Id<"payments">;
	let sessionId: Id<"sessions">;

	await t.run(async (ctx) => {
		const tableId = await ctx.db.insert("tables", {
			restaurantId: args.restaurantId,
			tableNumber: 3,
			isActive: true,
			createdAt: stamp,
		});
		sessionId = await ctx.db.insert("sessions", {
			restaurantId: args.restaurantId,
			tableId,
			userId: "diner-sweep",
			status: "active",
			startedAt: stamp,
		});
		orderId = await ctx.db.insert("orders", {
			sessionId,
			restaurantId: args.restaurantId,
			tableId,
			status: args.orderStatus ?? "awaiting_payment",
			totalAmount: args.amount,
			paymentState: args.paymentState ?? "processing",
			submittedAt: stamp,
			createdAt: stamp,
			updatedAt: stamp,
		});
		// `orders.confirmPayment` refuses an order with no lines, so the round
		// needs something on it for the settle branch to be real.
		const menuId = await ctx.db.insert("menus", {
			restaurantId: args.restaurantId,
			name: "Sweep Menu",
			isActive: true,
			displayOrder: 0,
			createdAt: stamp,
			updatedAt: stamp,
		});
		const categoryId = await ctx.db.insert("menuCategories", {
			menuId,
			restaurantId: args.restaurantId,
			name: "Sweep Category",
			displayOrder: 0,
			createdAt: stamp,
			updatedAt: stamp,
		});
		const menuItemId = await ctx.db.insert("menuItems", {
			categoryId,
			restaurantId: args.restaurantId,
			name: "Pozole",
			basePrice: args.amount,
			isAvailable: true,
			displayOrder: 0,
			createdAt: stamp,
			updatedAt: stamp,
		});
		await ctx.db.insert("orderItems", {
			orderId,
			menuItemId,
			menuItemName: "Pozole",
			quantity: 1,
			unitPrice: args.amount,
			selectedOptions: [],
			lineTotal: args.amount,
			createdAt: stamp,
		});
		paymentId = await ctx.db.insert("payments", {
			restaurantId: args.restaurantId,
			orderId,
			amount: args.amount,
			currency: "usd",
			status: "processing",
			refundStatus: "none",
			attemptNumber: 1,
			stripePaymentIntentId: args.stripePaymentIntentId,
			...(args.kind !== undefined && { kind: args.kind }),
			createdAt: stamp,
			updatedAt: stamp,
		});
		await ctx.db.patch(orderId, {
			activePaymentId: paymentId,
			stripePaymentIntentId: args.stripePaymentIntentId,
		});
	});

	return { orderId: orderId!, paymentId: paymentId!, sessionId: sessionId! };
}

/** A post-visit tip charge that never came back from Stripe. */
async function seedStuckTipPayment(
	t: ReturnType<typeof convexTest>,
	args: {
		restaurantId: Id<"restaurants">;
		stripePaymentIntentId: string;
		amount: number;
		ageMs: number;
	}
) {
	const stamp = Date.now() - args.ageMs;
	let paymentId: Id<"payments">;
	let sessionId: Id<"sessions">;

	await t.run(async (ctx) => {
		const tableId = await ctx.db.insert("tables", {
			restaurantId: args.restaurantId,
			tableNumber: 4,
			isActive: true,
			createdAt: stamp,
		});
		sessionId = await ctx.db.insert("sessions", {
			restaurantId: args.restaurantId,
			tableId,
			userId: "diner-tipper",
			status: "active",
			startedAt: stamp,
		});
		paymentId = await ctx.db.insert("payments", {
			restaurantId: args.restaurantId,
			sessionId,
			kind: "tip",
			paidByUserId: "diner-tipper",
			amount: args.amount,
			subtotalAmount: args.amount,
			feeAmount: 0,
			currency: "usd",
			status: "processing",
			refundStatus: "none",
			attemptNumber: 1,
			stripePaymentIntentId: args.stripePaymentIntentId,
			createdAt: stamp,
			updatedAt: stamp,
		});
	});

	return { paymentId: paymentId!, sessionId: sessionId! };
}

/** A legacy tab payment — no `kind`, a `sessionId`, and the tab sweep's problem. */
async function seedStuckTabPayment(
	t: ReturnType<typeof convexTest>,
	args: { restaurantId: Id<"restaurants">; ageMs: number }
) {
	const stamp = Date.now() - args.ageMs;
	let paymentId: Id<"payments">;

	await t.run(async (ctx) => {
		const tableId = await ctx.db.insert("tables", {
			restaurantId: args.restaurantId,
			tableNumber: 5,
			isActive: true,
			createdAt: stamp,
		});
		const sessionId = await ctx.db.insert("sessions", {
			restaurantId: args.restaurantId,
			tableId,
			userId: "diner-tab",
			status: "active",
			startedAt: stamp,
			lockedForPaymentAt: stamp,
			paymentState: "processing",
		});
		paymentId = await ctx.db.insert("payments", {
			restaurantId: args.restaurantId,
			sessionId,
			amount: 4200,
			currency: "usd",
			status: "processing",
			refundStatus: "none",
			attemptNumber: 1,
			stripePaymentIntentId: "pi_legacy_tab",
			createdAt: stamp,
			updatedAt: stamp,
		});
		await ctx.db.patch(sessionId, { activePaymentId: paymentId });
	});

	return { paymentId: paymentId! };
}

describe("payments.listStuckPayments — candidate selection (TAVLI-106)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.env.STRIPE_SECRET_KEY = "sk_test_123";
	});

	it("returns an order payment untouched past the order minimum", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const { paymentId } = await seedStuckOrderPayment(t, {
			restaurantId,
			stripePaymentIntentId: "pi_order_old",
			amount: 2400,
			ageMs: 6 * MINUTE,
			kind: "order",
		});

		const rows = await t.query(internal.payments.listStuckPayments, {
			now: Date.now(),
			limit: STUCK_PAYMENT_RECONCILE_BATCH_SIZE,
		});

		expect(rows.map((row) => row._id)).toEqual([paymentId]);
	});

	it("ignores an order payment touched within the last five minutes", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		await seedStuckOrderPayment(t, {
			restaurantId,
			stripePaymentIntentId: "pi_order_fresh",
			amount: 2400,
			ageMs: 2 * MINUTE,
			kind: "order",
		});

		const rows = await t.query(internal.payments.listStuckPayments, {
			now: Date.now(),
			limit: STUCK_PAYMENT_RECONCILE_BATCH_SIZE,
		});

		expect(rows).toEqual([]);
	});

	it("holds a tip back until its own thirty-minute minimum", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		await seedStuckTipPayment(t, {
			restaurantId,
			stripePaymentIntentId: "pi_tip_young",
			amount: 500,
			ageMs: 10 * MINUTE,
		});

		// Inside the index range (older than five minutes) but not yet a tip
		// candidate: nobody is waiting on a tip, so it gets more rope.
		expect(
			await t.query(internal.payments.listStuckPayments, {
				now: Date.now(),
				limit: STUCK_PAYMENT_RECONCILE_BATCH_SIZE,
			})
		).toEqual([]);

		const rows = await t.query(internal.payments.listStuckPayments, {
			now: Date.now() + 25 * MINUTE,
			limit: STUCK_PAYMENT_RECONCILE_BATCH_SIZE,
		});
		expect(rows).toHaveLength(1);
		expect(rows[0].kind).toBe("tip");
	});

	it("excludes a legacy tab payment — the tab sweep owns those", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		await seedStuckTabPayment(t, { restaurantId, ageMs: 45 * MINUTE });

		const rows = await t.query(internal.payments.listStuckPayments, {
			now: Date.now(),
			limit: STUCK_PAYMENT_RECONCILE_BATCH_SIZE,
		});

		expect(rows).toEqual([]);
	});

	it("includes a legacy per-order payment that carries no kind", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const { paymentId } = await seedStuckOrderPayment(t, {
			restaurantId,
			stripePaymentIntentId: "pi_legacy_order",
			amount: 1500,
			ageMs: 20 * MINUTE,
		});

		const rows = await t.query(internal.payments.listStuckPayments, {
			now: Date.now(),
			limit: STUCK_PAYMENT_RECONCILE_BATCH_SIZE,
		});

		expect(rows.map((row) => row._id)).toEqual([paymentId]);
		expect(rows[0].kind).toBeUndefined();
	});

	it("reads no more than the batch bound, oldest first", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		for (let i = 0; i < 4; i++) {
			await seedStuckOrderPayment(t, {
				restaurantId,
				stripePaymentIntentId: `pi_batch_${i}`,
				amount: 1000 + i,
				// Oldest last, so a limit of 2 that returned insertion order would
				// pick the wrong two.
				ageMs: (40 - i * 5) * MINUTE,
				kind: "order",
			});
		}

		const rows = await t.query(internal.payments.listStuckPayments, {
			now: Date.now(),
			limit: 2,
		});

		expect(rows).toHaveLength(2);
		expect(rows.map((row) => row.stripePaymentIntentId)).toEqual(["pi_batch_0", "pi_batch_1"]);
	});

	it("skips a processing row that never recorded an intent id", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const { paymentId } = await seedStuckOrderPayment(t, {
			restaurantId,
			stripePaymentIntentId: "pi_to_be_removed",
			amount: 900,
			ageMs: 30 * MINUTE,
			kind: "order",
		});
		await t.run(async (ctx) => {
			await ctx.db.patch(paymentId, { stripePaymentIntentId: undefined });
		});

		const rows = await t.query(internal.payments.listStuckPayments, {
			now: Date.now(),
			limit: STUCK_PAYMENT_RECONCILE_BATCH_SIZE,
		});

		expect(rows).toEqual([]);
	});

	it("ignores rows that already reached a terminal status", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const { paymentId } = await seedStuckOrderPayment(t, {
			restaurantId,
			stripePaymentIntentId: "pi_already_done",
			amount: 900,
			ageMs: ORDER_PAYMENT_RECONCILE_ALERT_AGE_MS + MINUTE,
			kind: "order",
		});
		await t.run(async (ctx) => {
			await ctx.db.patch(paymentId, { status: "succeeded" });
		});

		const rows = await t.query(internal.payments.listStuckPayments, {
			now: Date.now(),
			limit: STUCK_PAYMENT_RECONCILE_BATCH_SIZE,
		});

		expect(rows).toEqual([]);
	});
});

/** Grants `userId` manager access to the restaurant, for the cash-settle step. */
async function seedManager(
	t: ReturnType<typeof convexTest>,
	args: { restaurantId: Id<"restaurants">; userId: string }
) {
	await t.run(async (ctx) => {
		const restaurant = await ctx.db.get(args.restaurantId);
		await ctx.db.insert("userRoles", {
			userId: args.userId,
			roles: ["manager"],
			organizationId: restaurant!.organizationId,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		await ctx.db.insert("restaurantMembers", {
			userId: args.userId,
			restaurantId: args.restaurantId,
			organizationId: restaurant!.organizationId,
			role: "manager",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			updatedBy: "system",
		});
	});
	return t.withIdentity({ subject: args.userId });
}

describe("stripe.reconcileStuckPayments (TAVLI-106)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.env.STRIPE_SECRET_KEY = "sk_test_123";
	});

	it("settles an order whose PaymentIntent already succeeded", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const { orderId, paymentId } = await seedStuckOrderPayment(t, {
			restaurantId,
			stripePaymentIntentId: "pi_sweep_success",
			amount: 2400,
			ageMs: 8 * MINUTE,
			kind: "order",
		});

		mockStripeClient.paymentIntents.retrieve.mockResolvedValueOnce({
			id: "pi_sweep_success",
			status: "succeeded",
			amount: 2400,
			amount_received: 2400,
			latest_charge: "ch_sweep",
			metadata: {},
		});

		await t.action(internal.stripe.reconcileStuckPayments, {});

		await t.run(async (ctx) => {
			const payment = await ctx.db.get(paymentId);
			expect(payment!.status).toBe("succeeded");
			expect(payment!.stripeChargeId).toBe("ch_sweep");

			// Settled through `handlePaymentIntentSuccess`, the webhook's own
			// handler — so the order is released exactly as a live webhook would
			// have released it.
			const order = await ctx.db.get(orderId);
			expect(order!.paymentState).toBe("paid");
		});
	});

	it("credits the member when a stuck tip charge already succeeded", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const { paymentId, sessionId } = await seedStuckTipPayment(t, {
			restaurantId,
			stripePaymentIntentId: "pi_sweep_tip",
			amount: 600,
			ageMs: 35 * MINUTE,
		});

		mockStripeClient.paymentIntents.retrieve.mockResolvedValueOnce({
			id: "pi_sweep_tip",
			status: "succeeded",
			amount: 600,
			amount_received: 600,
			latest_charge: "ch_sweep_tip",
			metadata: {},
		});

		await t.action(internal.stripe.reconcileStuckPayments, {});

		await t.run(async (ctx) => {
			const payment = await ctx.db.get(paymentId);
			expect(payment!.status).toBe("succeeded");
			expect(payment!.succeededAt).toBeDefined();
			expect(payment!.stripeChargeId).toBe("ch_sweep_tip");

			// The tip is recorded against the visit, and the visit stays open —
			// `confirmTipPayment` never closes a session.
			const session = await ctx.db.get(sessionId);
			expect(session!.status).toBe("active");
		});
	});

	it("clears an order attempt whose PaymentIntent was canceled at Stripe", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const { orderId, paymentId } = await seedStuckOrderPayment(t, {
			restaurantId,
			stripePaymentIntentId: "pi_sweep_canceled",
			amount: 2400,
			ageMs: 9 * MINUTE,
			kind: "order",
		});

		mockStripeClient.paymentIntents.retrieve.mockResolvedValueOnce({
			id: "pi_sweep_canceled",
			status: "canceled",
		});

		await t.action(internal.stripe.reconcileStuckPayments, {});

		// Already terminal at Stripe, so nothing is stood down a second time.
		expect(mockStripeClient.paymentIntents.cancel).not.toHaveBeenCalled();

		await t.run(async (ctx) => {
			const payment = await ctx.db.get(paymentId);
			expect(payment!.status).toBe("cancelled");

			const order = await ctx.db.get(orderId);
			expect(order!.activePaymentId).toBeUndefined();
			expect(order!.stripePaymentIntentId).toBeUndefined();
			expect(order!.paymentState).toBe("unpaid");
		});
	});

	/**
	 * The scenario carried over from TAVLI-104's review, end to end.
	 *
	 * The round was released to the kitchen and eaten; the diner opened the card
	 * sheet and walked away, leaving a `processing` row and an intent Stripe
	 * still reports as `requires_payment_method`. Staff want the cash, and
	 * `markOrderPaidInPerson` refuses with ERROR_ORDER_PAYMENT_IN_FLIGHT because
	 * the order still points at a live-looking attempt. Nothing in the product
	 * released it before this sweep.
	 */
	it("releases a served, cash-owed round whose diner abandoned the card sheet", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const manager = await seedManager(t, { restaurantId, userId: "manager-sweep" });
		const { orderId, paymentId } = await seedStuckOrderPayment(t, {
			restaurantId,
			stripePaymentIntentId: "pi_sweep_abandoned",
			amount: 3100,
			ageMs: 12 * MINUTE,
			orderStatus: "served",
			kind: "order",
			paymentState: "processing",
		});
		await t.run(async (ctx) => {
			// Committed for cash first, then the diner changed their mind at the
			// table and opened the card sheet: `awaitingPaymentAt` is what makes
			// this order still owe money in person.
			await ctx.db.patch(orderId, { awaitingPaymentAt: Date.now() - 40 * MINUTE });
		});

		// Before the sweep, staff cannot collect.
		await expect(manager.mutation(api.orders.markOrderPaidInPerson, { orderId })).rejects.toThrow(
			"ERROR_ORDER_PAYMENT_IN_FLIGHT"
		);

		mockStripeClient.paymentIntents.retrieve
			.mockResolvedValueOnce({ id: "pi_sweep_abandoned", status: "requires_payment_method" })
			// `standDownPaymentIntent` re-reads before cancelling.
			.mockResolvedValueOnce({ id: "pi_sweep_abandoned", status: "requires_payment_method" });
		mockStripeClient.paymentIntents.cancel.mockResolvedValueOnce({
			id: "pi_sweep_abandoned",
			status: "canceled",
		});

		await t.action(internal.stripe.reconcileStuckPayments, {});

		// Stripe first: the intent is dead at Stripe before the row is retired,
		// so a stale client secret cannot charge the card after staff take cash.
		expect(mockStripeClient.paymentIntents.cancel).toHaveBeenCalledWith("pi_sweep_abandoned");

		await t.run(async (ctx) => {
			const payment = await ctx.db.get(paymentId);
			expect(payment!.status).toBe("failed");
		});

		// And now they can.
		const [settledOrderId, error] = await manager.mutation(api.orders.markOrderPaidInPerson, {
			orderId,
		});
		expect(error).toBeNull();
		expect(settledOrderId).toBe(orderId);

		await t.run(async (ctx) => {
			const order = await ctx.db.get(orderId);
			expect(order!.paymentState).toBe("paid");
			expect(order!.settledBy).toBe("staff");
		});
	});

	it("fails a stuck tip whose charge was abandoned, so the diner can tip again", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const { paymentId } = await seedStuckTipPayment(t, {
			restaurantId,
			stripePaymentIntentId: "pi_sweep_tip_dead",
			amount: 600,
			ageMs: 40 * MINUTE,
		});

		mockStripeClient.paymentIntents.retrieve.mockResolvedValueOnce({
			id: "pi_sweep_tip_dead",
			status: "canceled",
		});

		await t.action(internal.stripe.reconcileStuckPayments, {});

		await t.run(async (ctx) => {
			const payment = await ctx.db.get(paymentId);
			expect(payment!.status).toBe("failed");
			expect(payment!.failedAt).toBeDefined();
		});
	});

	it("waits on an order still processing under the alert age", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const { paymentId } = await seedStuckOrderPayment(t, {
			restaurantId,
			stripePaymentIntentId: "pi_sweep_waiting",
			amount: 2400,
			ageMs: 7 * MINUTE,
			kind: "order",
		});

		mockStripeClient.paymentIntents.retrieve.mockResolvedValueOnce({
			id: "pi_sweep_waiting",
			status: "processing",
		});

		await t.action(internal.stripe.reconcileStuckPayments, {});

		await t.run(async (ctx) => {
			expect((await ctx.db.get(paymentId))!.status).toBe("processing");
			expect(await ctx.db.query("operatorAlerts").collect()).toEqual([]);
		});
	});

	it("raises one severe alert for an order past the alert age, and not a second one", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const { orderId, paymentId } = await seedStuckOrderPayment(t, {
			restaurantId,
			stripePaymentIntentId: "pi_sweep_stuck",
			amount: 2400,
			ageMs: ORDER_PAYMENT_RECONCILE_ALERT_AGE_MS + MINUTE,
			kind: "order",
		});

		mockStripeClient.paymentIntents.retrieve.mockResolvedValue({
			id: "pi_sweep_stuck",
			status: "processing",
		});

		await t.action(internal.stripe.reconcileStuckPayments, {});
		// Five minutes later the row is still stuck and still a candidate.
		await t.action(internal.stripe.reconcileStuckPayments, {});

		await t.run(async (ctx) => {
			const alerts = await ctx.db.query("operatorAlerts").collect();
			expect(alerts).toHaveLength(1);
			expect(alerts[0].kind).toBe("payment_stuck");
			expect(alerts[0].severity).toBe("severe");
			expect(alerts[0].dedupeKey).toBe(`payment_stuck:${paymentId}`);
			expect(alerts[0].paymentId).toBe(paymentId);
			expect(alerts[0].orderId).toBe(orderId);
			expect(alerts[0].restaurantId).toBe(restaurantId);
			expect(alerts[0].stripeObjectId).toBe("pi_sweep_stuck");
			expect(alerts[0].messageParams).toMatchObject({ kind: "order" });

			// The row is left exactly as it was: the money is mid-flight at
			// Stripe and only a human can say what it should become.
			expect((await ctx.db.get(paymentId))!.status).toBe("processing");
		});
	});

	it("raises a warning, not a severe alert, for a stuck tip", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		await seedStuckTipPayment(t, {
			restaurantId,
			stripePaymentIntentId: "pi_sweep_tip_stuck",
			amount: 600,
			ageMs: TIP_PAYMENT_RECONCILE_ALERT_AGE_MS + MINUTE,
		});

		mockStripeClient.paymentIntents.retrieve.mockResolvedValueOnce({
			id: "pi_sweep_tip_stuck",
			status: "processing",
		});

		await t.action(internal.stripe.reconcileStuckPayments, {});

		await t.run(async (ctx) => {
			const alerts = await ctx.db.query("operatorAlerts").collect();
			expect(alerts).toHaveLength(1);
			// Nobody is waiting at a table for a tip, so it never mails every
			// platform admin.
			expect(alerts[0].severity).toBe("warning");
			expect(alerts[0].messageParams).toMatchObject({ kind: "tip" });
		});
	});

	it("alerts immediately on a PaymentIntent status it does not recognise", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const { paymentId } = await seedStuckOrderPayment(t, {
			restaurantId,
			stripePaymentIntentId: "pi_sweep_unknown",
			amount: 2400,
			// Well under the alert age: an unrecognised status is not something
			// waiting resolves.
			ageMs: 6 * MINUTE,
			kind: "order",
		});

		mockStripeClient.paymentIntents.retrieve.mockResolvedValueOnce({
			id: "pi_sweep_unknown",
			status: "some_future_stripe_status",
		});

		await t.action(internal.stripe.reconcileStuckPayments, {});

		await t.run(async (ctx) => {
			const alerts = await ctx.db.query("operatorAlerts").collect();
			expect(alerts).toHaveLength(1);
			expect(alerts[0].kind).toBe("payment_stuck");
			// Unclassified rather than urgent — worth a human's eye, not an inbox.
			expect(alerts[0].severity).toBe("warning");
			expect((await ctx.db.get(paymentId))!.status).toBe("processing");
		});
	});

	/**
	 * The amount assertion belongs to `handlePaymentIntentSuccess` and stays
	 * there. The sweep hands the intent over and adds nothing: no second
	 * comparison, and above all no `payment_stuck` alert on top of the
	 * `payment_amount_mismatch` the handler already raised.
	 *
	 * Unlike the tab sweep, this one needs no pre-check to stop the repetition:
	 * the handler fails the row, which takes it out of `status = processing` and
	 * therefore out of this sweep's candidate range for good.
	 */
	it("does not settle a mismatched amount, and raises no alert of its own", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const { orderId, paymentId } = await seedStuckOrderPayment(t, {
			restaurantId,
			stripePaymentIntentId: "pi_sweep_mismatch",
			amount: 2400,
			ageMs: ORDER_PAYMENT_RECONCILE_ALERT_AGE_MS + MINUTE,
			kind: "order",
		});

		mockStripeClient.paymentIntents.retrieve.mockResolvedValueOnce({
			id: "pi_sweep_mismatch",
			status: "succeeded",
			amount: 1800,
			amount_received: 1800,
			latest_charge: "ch_sweep_mismatch",
			metadata: {},
		});

		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		await t.action(internal.stripe.reconcileStuckPayments, {});
		errorSpy.mockRestore();

		await t.run(async (ctx) => {
			const payment = await ctx.db.get(paymentId);
			expect(payment!.status).toBe("failed");
			expect(payment!.failureCode).toBe("amount_mismatch");
			expect(payment!.succeededAt).toBeUndefined();

			const order = await ctx.db.get(orderId);
			expect(order!.paymentState).not.toBe("paid");

			// One alert, and it is the handler's.
			const alerts = await ctx.db.query("operatorAlerts").collect();
			expect(alerts).toHaveLength(1);
			expect(alerts[0].kind).toBe("payment_amount_mismatch");
		});
	});

	it("logs a candidate whose retrieve throws and carries on with the batch", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const broken = await seedStuckOrderPayment(t, {
			restaurantId,
			stripePaymentIntentId: "pi_sweep_broken",
			amount: 2400,
			// Older, so it is read first and fails first.
			ageMs: 30 * MINUTE,
			kind: "order",
		});
		const healthy = await seedStuckOrderPayment(t, {
			restaurantId,
			stripePaymentIntentId: "pi_sweep_healthy",
			amount: 1500,
			ageMs: 10 * MINUTE,
			kind: "order",
		});

		mockStripeClient.paymentIntents.retrieve
			.mockRejectedValueOnce(new Error("Stripe is having a day"))
			.mockResolvedValueOnce({
				id: "pi_sweep_healthy",
				status: "succeeded",
				amount: 1500,
				amount_received: 1500,
				latest_charge: "ch_sweep_healthy",
				metadata: {},
			});

		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		// Never throws for one bad candidate — the cron must not be retried for it.
		await t.action(internal.stripe.reconcileStuckPayments, {});
		const logged = [...errorSpy.mock.calls];
		errorSpy.mockRestore();

		expect(
			logged.some((call) => String(call[0]).includes("reconcileStuckPayments")),
			"the failed candidate must still be logged"
		).toBe(true);

		await t.run(async (ctx) => {
			expect((await ctx.db.get(broken.paymentId))!.status).toBe("processing");
			expect((await ctx.db.get(healthy.paymentId))!.status).toBe("succeeded");
		});
	});
});
