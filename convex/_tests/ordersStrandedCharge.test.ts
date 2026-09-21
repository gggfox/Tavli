/**
 * A charge the webhook cannot place against its order is accepted or refunded —
 * never dropped (TAVLI-104).
 *
 * `orders.confirmPayment` had three dead ends: the payment was no longer the
 * order's `activePaymentId`, the order's `updatedAt` had moved past the
 * payment's snapshot, or the order total no longer matched. Each one logged a
 * warning and returned. Stripe had the diner's money in all three, and the order
 * stayed unreleased with nobody told.
 *
 * The deciding question is not "is this the payment we were waiting for" but
 * "does this money pay for what the order costs right now", recomputed through
 * the same helper `createPaymentIntent` uses (`currentOrderChargeAmount`):
 *
 * - equal → ACCEPT. Settle normally with this payment, adopt it as the order's
 *   active one, retire any newer attempt and cancel its intent at Stripe.
 * - not equal (or the order was already paid by another payment) → REFUND in
 *   full, order stays unpaid and owed, severe operator alert with both amounts.
 *
 * The refund is a Stripe call and `confirmPayment` is a mutation, so the row
 * records the decision (`succeeded` + `refundStatus: requested`) and
 * `stripe.refundStrandedCharge` does the Stripe half on a `runAfter(0)` hop.
 */
import { convexTest } from "convex-test";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { mockStripeClient } from "./_fixtures/stripeMock.fixture";

const modules = import.meta.glob("../**/*.ts");

vi.mock("stripe", async () => (await import("./_fixtures/stripeMock.fixture")).stripeModuleMock());

/** 200.00 of food: 12% fee = 24.00, plus a 20.00 tip the diner chose. */
const SUBTOTAL = 20000;
const FEE = 2400;
const GRATUITY = 2000;
const CHARGED = SUBTOTAL + FEE + GRATUITY;

type Seeded = {
	restaurantId: Id<"restaurants">;
	orderId: Id<"orders">;
	paymentId: Id<"payments">;
};

/**
 * A draft order with one line and a `processing` order payment that has already
 * been charged at Stripe — the state a `payment_intent.succeeded` lands on.
 */
async function seedOrderAndPayment(
	t: ReturnType<typeof convexTest>,
	args?: { intentId?: string }
): Promise<Seeded> {
	let restaurantId: Id<"restaurants">;
	let orderId: Id<"orders">;
	let paymentId: Id<"payments">;
	await t.run(async (ctx) => {
		const organizationId = await ctx.db.insert("organizations", {
			name: "Stranded Org",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner-stranded",
			organizationId,
			name: "Stranded Test Restaurant",
			slug: `stranded-${Math.random().toString(36).slice(2, 10)}`,
			currency: "USD",
			timezone: "America/Mexico_City",
			stripeAccountId: "acct_stranded",
			stripeOnboardingComplete: true,
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		const tableId = await ctx.db.insert("tables", {
			restaurantId,
			tableNumber: 21,
			isActive: true,
			createdAt: Date.now(),
		});
		const sessionId = await ctx.db.insert("sessions", {
			restaurantId,
			tableId,
			userId: "diner-stranded",
			status: "active",
			startedAt: Date.now(),
		});
		orderId = await ctx.db.insert("orders", {
			sessionId,
			restaurantId,
			tableId,
			status: "draft",
			totalAmount: SUBTOTAL,
			paymentState: "processing",
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});

		const menuId = await ctx.db.insert("menus", {
			restaurantId,
			name: "Menu",
			isActive: true,
			displayOrder: 0,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		const categoryId = await ctx.db.insert("menuCategories", {
			menuId,
			restaurantId,
			name: "Cat",
			displayOrder: 0,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		const menuItemId = await ctx.db.insert("menuItems", {
			categoryId,
			restaurantId,
			name: "Mole",
			basePrice: SUBTOTAL,
			isAvailable: true,
			displayOrder: 0,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		await ctx.db.insert("orderItems", {
			orderId,
			menuItemId,
			menuItemName: "Mole",
			quantity: 1,
			unitPrice: SUBTOTAL,
			selectedOptions: [],
			lineTotal: SUBTOTAL,
			createdAt: Date.now(),
		});

		const order = (await ctx.db.get(orderId))!;
		paymentId = await ctx.db.insert("payments", {
			restaurantId,
			orderId,
			amount: CHARGED,
			subtotalAmount: SUBTOTAL,
			feeAmount: FEE,
			gratuityAmount: GRATUITY,
			kind: "order",
			paidByUserId: "diner-stranded",
			currency: "usd",
			status: "processing",
			refundStatus: "none",
			attemptNumber: 1,
			orderUpdatedAtSnapshot: order.updatedAt,
			stripePaymentIntentId: args?.intentId ?? "pi_stranded",
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		await ctx.db.patch(orderId, {
			activePaymentId: paymentId,
			stripePaymentIntentId: args?.intentId ?? "pi_stranded",
		});
	});
	return { restaurantId: restaurantId!, orderId: orderId!, paymentId: paymentId! };
}

/** A newer attempt that took over the order's payment pointer. */
async function seedSuccessor(
	t: ReturnType<typeof convexTest>,
	seeded: Seeded,
	args: { status: "processing" | "succeeded"; intentId: string }
): Promise<Id<"payments">> {
	let successorId: Id<"payments">;
	await t.run(async (ctx) => {
		successorId = await ctx.db.insert("payments", {
			restaurantId: seeded.restaurantId,
			orderId: seeded.orderId,
			amount: CHARGED,
			subtotalAmount: SUBTOTAL,
			feeAmount: FEE,
			gratuityAmount: GRATUITY,
			kind: "order",
			paidByUserId: "diner-stranded",
			currency: "usd",
			status: args.status,
			refundStatus: "none",
			attemptNumber: 2,
			stripePaymentIntentId: args.intentId,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		await ctx.db.patch(seeded.orderId, {
			activePaymentId: successorId,
			// A second attempt only exists because something moved.
			updatedAt: Date.now() + 5_000,
			...(args.status === "succeeded" && { paymentState: "paid" }),
		});
	});
	return successorId!;
}

async function confirm(t: ReturnType<typeof convexTest>, seeded: Seeded, intentId = "pi_stranded") {
	await t.mutation(internal.orders.confirmPayment, {
		paymentId: seeded.paymentId,
		stripePaymentIntentId: intentId,
		stripeChargeId: "ch_stranded",
		gratuityAmount: GRATUITY,
	});
}

async function alertsOf(t: ReturnType<typeof convexTest>) {
	return await t.run(async (ctx) => ctx.db.query("operatorAlerts").collect());
}

describe("orders.confirmPayment — a charge that matches no active payment (TAVLI-104)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		process.env.STRIPE_SECRET_KEY = "sk_test_123";
		mockStripeClient.refunds.create.mockResolvedValue({
			id: "re_stranded",
			status: "succeeded",
			amount: CHARGED,
		});
		mockStripeClient.paymentIntents.retrieve.mockResolvedValue({
			id: "pi_successor",
			status: "requires_payment_method",
		});
		mockStripeClient.paymentIntents.cancel.mockResolvedValue({
			id: "pi_successor",
			status: "canceled",
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("accepted — the money still pays for what the order costs", () => {
		it("settles the order with a payment it had stopped pointing at, and stands the successor down", async () => {
			const t = convexTest(schema, modules);
			const seeded = await seedOrderAndPayment(t);
			const successorId = await seedSuccessor(t, seeded, {
				status: "processing",
				intentId: "pi_successor",
			});

			await confirm(t, seeded);

			const { order, payment, successor } = await t.run(async (ctx) => ({
				order: await ctx.db.get(seeded.orderId),
				payment: await ctx.db.get(seeded.paymentId),
				successor: await ctx.db.get(successorId),
			}));
			// The order is paid, by the payment that actually paid for it.
			expect(order?.paymentState).toBe("paid");
			expect(order?.status).toBe("submitted");
			expect(order?.activePaymentId).toBe(seeded.paymentId);
			expect(payment?.status).toBe("succeeded");
			expect(payment?.refundStatus).toBe("none");
			// The loser is retired and its intent comes down at Stripe.
			expect(successor?.status).toBe("superseded");
			await t.finishAllScheduledFunctions(() => vi.runAllTimers());
			expect(mockStripeClient.paymentIntents.cancel).toHaveBeenCalledWith("pi_successor");
			expect(mockStripeClient.refunds.create).not.toHaveBeenCalled();
			expect(await alertsOf(t)).toHaveLength(0);
		});

		it("settles through a stale updatedAt snapshot when the total is unchanged", async () => {
			const t = convexTest(schema, modules);
			const seeded = await seedOrderAndPayment(t);
			// An edit that did not change the price (a note, a re-save) still bumps
			// `updatedAt` and used to strand the charge.
			await t.run(async (ctx) => {
				await ctx.db.patch(seeded.orderId, { updatedAt: Date.now() + 9_000 });
			});

			await confirm(t, seeded);

			const order = await t.run(async (ctx) => ctx.db.get(seeded.orderId));
			expect(order?.paymentState).toBe("paid");
			expect(order?.activePaymentId).toBe(seeded.paymentId);
			await t.finishAllScheduledFunctions(() => vi.runAllTimers());
			expect(mockStripeClient.refunds.create).not.toHaveBeenCalled();
		});
	});

	describe("refunded — the order costs something else now", () => {
		it("refunds in full, leaves the order owed, and raises a severe alert", async () => {
			const t = convexTest(schema, modules);
			const seeded = await seedOrderAndPayment(t);
			// A line was removed from the order after the intent was created: 150.00
			// of food now, so the charge pays for something that no longer exists.
			await t.run(async (ctx) => {
				await ctx.db.patch(seeded.orderId, { totalAmount: 15000, updatedAt: Date.now() + 9_000 });
			});

			await confirm(t, seeded);

			// The window between the decision and the refund has to make sense: the
			// money WAS collected, and a refund is on its way.
			const midFlight = await t.run(async (ctx) => ctx.db.get(seeded.paymentId));
			expect(midFlight?.status).toBe("succeeded");
			expect(midFlight?.refundStatus).toBe("requested");

			await t.finishAllScheduledFunctions(() => vi.runAllTimers());

			expect(mockStripeClient.refunds.create).toHaveBeenCalledTimes(1);
			const [params, options] = mockStripeClient.refunds.create.mock.calls[0];
			// No `amount` key at all — a full refund, not a partial one.
			expect(params).toEqual({
				payment_intent: "pi_stranded",
				reverse_transfer: true,
				refund_application_fee: true,
			});
			expect(options).toEqual({
				idempotencyKey: `stranded-charge-refund:${seeded.paymentId}`,
			});

			const { order, payment } = await t.run(async (ctx) => ({
				order: await ctx.db.get(seeded.orderId),
				payment: await ctx.db.get(seeded.paymentId),
			}));
			// Still owed, still a draft the diner can pay again — NOT "refunded",
			// which would read as "this order was paid and then reversed".
			expect(order?.paymentState).toBe("unpaid");
			expect(order?.activePaymentId).toBeUndefined();
			expect(order?.status).toBe("draft");
			expect(order?.paidAt).toBeUndefined();
			expect(payment?.refundStatus).toBe("succeeded");
			expect(payment?.stripeRefundId).toBe("re_stranded");

			const alerts = await alertsOf(t);
			expect(alerts).toHaveLength(1);
			expect(alerts[0]).toMatchObject({
				kind: "charge_mismatched_refunded",
				severity: "severe",
				status: "open",
				orderId: seeded.orderId,
				paymentId: seeded.paymentId,
				stripeObjectId: "pi_stranded",
				dedupeKey: `charge_mismatched_refunded:${seeded.paymentId}`,
			});
			// Pre-formatted, like TAVLI-69: neither the alerts page nor the email
			// formats money, so a raw 24400 would reach the operator as "24400".
			expect(alerts[0].messageParams).toEqual({
				collected: "244.00",
				expected: "188.00",
				currency: "USD",
			});
		});

		it("refunds a duplicate charge rather than taking the settlement off the payment that paid", async () => {
			const t = convexTest(schema, modules);
			const seeded = await seedOrderAndPayment(t);
			await seedSuccessor(t, seeded, { status: "succeeded", intentId: "pi_successor" });

			await confirm(t, seeded);
			await t.finishAllScheduledFunctions(() => vi.runAllTimers());

			expect(mockStripeClient.refunds.create).toHaveBeenCalledTimes(1);
			const order = await t.run(async (ctx) => ctx.db.get(seeded.orderId));
			// The order keeps the payment that actually settled it.
			expect(order?.paymentState).toBe("paid");
			expect(order?.activePaymentId).not.toBe(seeded.paymentId);
			const alerts = await alertsOf(t);
			expect(alerts).toHaveLength(1);
			expect(alerts[0].kind).toBe("charge_mismatched_refunded");
		});

		it("does not refund twice on a redelivery", async () => {
			const t = convexTest(schema, modules);
			const seeded = await seedOrderAndPayment(t);
			await t.run(async (ctx) => {
				await ctx.db.patch(seeded.orderId, { totalAmount: 15000, updatedAt: Date.now() + 9_000 });
			});

			await confirm(t, seeded);
			await t.finishAllScheduledFunctions(() => vi.runAllTimers());
			// Stripe redelivers the same success, or the sweep re-runs the handler.
			await confirm(t, seeded);
			await t.finishAllScheduledFunctions(() => vi.runAllTimers());

			expect(mockStripeClient.refunds.create).toHaveBeenCalledTimes(1);
			expect(await alertsOf(t)).toHaveLength(1);
		});

		it("the refund job itself is idempotent when re-run against a refunded row", async () => {
			const t = convexTest(schema, modules);
			const seeded = await seedOrderAndPayment(t);
			await t.run(async (ctx) => {
				await ctx.db.patch(seeded.orderId, { totalAmount: 15000, updatedAt: Date.now() + 9_000 });
			});

			await confirm(t, seeded);
			await t.finishAllScheduledFunctions(() => vi.runAllTimers());
			await t.action(internal.stripe.refundStrandedCharge, {
				paymentId: seeded.paymentId,
				orderId: seeded.orderId,
			});

			expect(mockStripeClient.refunds.create).toHaveBeenCalledTimes(1);
		});
	});

	describe("unchanged behaviour", () => {
		it("still settles a payment that lines up with its order", async () => {
			const t = convexTest(schema, modules);
			const seeded = await seedOrderAndPayment(t);

			await confirm(t, seeded);

			const order = await t.run(async (ctx) => ctx.db.get(seeded.orderId));
			expect(order?.paymentState).toBe("paid");
			expect(order?.activePaymentId).toBe(seeded.paymentId);
			await t.finishAllScheduledFunctions(() => vi.runAllTimers());
			expect(mockStripeClient.refunds.create).not.toHaveBeenCalled();
			expect(mockStripeClient.paymentIntents.cancel).not.toHaveBeenCalled();
		});

		it("still walks away from an order that cannot be released at all", async () => {
			const t = convexTest(schema, modules);
			const seeded = await seedOrderAndPayment(t);
			await t.run(async (ctx) => {
				await ctx.db.patch(seeded.orderId, { status: "cancelled", totalAmount: 15000 });
			});

			await confirm(t, seeded);
			await t.finishAllScheduledFunctions(() => vi.runAllTimers());

			// Out of scope for this ticket: a cancelled order's refund is
			// `cancelOrderAndRefund`'s job, and inventing a settlement here would be
			// worse than the warning.
			const payment = await t.run(async (ctx) => ctx.db.get(seeded.paymentId));
			expect(payment?.status).toBe("processing");
			expect(mockStripeClient.refunds.create).not.toHaveBeenCalled();
		});
	});
});
