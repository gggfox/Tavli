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
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
	ORDER_PAYMENT_RECONCILE_ALERT_AGE_MS,
	STUCK_PAYMENT_RECONCILE_BATCH_SIZE,
} from "../constants";
import { insertMenuForRestaurant } from "../menus";
import schema from "../schema";

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
