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
import { api, internal } from "../_generated/api";
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

/** A manager identity for this restaurant — only managers may cancel. */
async function seedManager(t: ReturnType<typeof convexTest>, restaurantId: Id<"restaurants">) {
	await t.run(async (ctx) => {
		const restaurant = (await ctx.db.get(restaurantId))!;
		await ctx.db.insert("restaurantMembers", {
			restaurantId,
			organizationId: restaurant.organizationId,
			userId: "manager-stranded",
			role: "manager",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});
	return t.withIdentity({ subject: "manager-stranded" });
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
	});

	/**
	 * The stranded refund comes back as `charge.refunded` like any other, and the
	 * row it lands on is SUCCEEDED — which used to be the whole test for "this
	 * payment settled the order, so a full refund makes the order REFUNDED".
	 * TAVLI-104 made that test wrong: these rows are SUCCEEDED and were never the
	 * order's settlement. An order that is still owed must not be recorded as
	 * money that came and went.
	 */
	describe("cancelling an order closes the window instead of cleaning up after it", () => {
		it("stands the in-flight intent down at Stripe when staff void the ticket", async () => {
			const t = convexTest(schema, modules);
			const seeded = await seedOrderAndPayment(t);
			const manager = await seedManager(t, seeded.restaurantId);
			await t.run(async (ctx) => {
				// A submitted order with a card payment still in flight.
				await ctx.db.patch(seeded.orderId, { status: "submitted", paymentState: "processing" });
			});
			mockStripeClient.paymentIntents.retrieve.mockResolvedValue({
				id: "pi_stranded",
				status: "requires_payment_method",
			});
			mockStripeClient.paymentIntents.cancel.mockResolvedValue({
				id: "pi_stranded",
				status: "canceled",
			});

			const [, error] = await manager.mutation(api.orders.updateStatus, {
				orderId: seeded.orderId,
				newStatus: "cancelled",
			});
			expect(error).toBeNull();

			// Before the scheduled Stripe call even runs, the transaction that
			// voided the ticket has already let go of the payment: staff never see
			// a cancelled order that is still "processing" a card, and
			// `requestPayInPerson`'s in-flight guard no longer trips.
			const { order, payment } = await t.run(async (ctx) => ({
				order: await ctx.db.get(seeded.orderId),
				payment: await ctx.db.get(seeded.paymentId),
			}));
			expect(payment?.status).toBe("cancelled");
			expect(order?.activePaymentId).toBeUndefined();
			expect(order?.stripePaymentIntentId).toBeUndefined();
			expect(order?.paymentState).toBe("unpaid");

			await t.finishAllScheduledFunctions(() => vi.runAllTimers());

			// The diner's payment sheet can no longer charge a voided ticket.
			expect(mockStripeClient.paymentIntents.cancel).toHaveBeenCalledWith("pi_stranded");
		});

		it("leaves a settlement alone when the charge won the race to the cancel", async () => {
			const t = convexTest(schema, modules);
			const seeded = await seedOrderAndPayment(t);
			const manager = await seedManager(t, seeded.restaurantId);
			await t.run(async (ctx) => {
				// The webhook settled it a moment before staff hit cancel.
				await ctx.db.patch(seeded.paymentId, { status: "succeeded", succeededAt: Date.now() });
				await ctx.db.patch(seeded.orderId, { status: "submitted", paymentState: "paid" });
			});

			const [, error] = await manager.mutation(api.orders.updateStatus, {
				orderId: seeded.orderId,
				newStatus: "cancelled",
			});
			expect(error).toBeNull();
			await t.finishAllScheduledFunctions(() => vi.runAllTimers());

			// Untouched: a paid order's cancel is a refund, which
			// `cancelOrderAndRefund` owns.
			const { order, payment } = await t.run(async (ctx) => ({
				order: await ctx.db.get(seeded.orderId),
				payment: await ctx.db.get(seeded.paymentId),
			}));
			expect(payment?.status).toBe("succeeded");
			expect(order?.activePaymentId).toBe(seeded.paymentId);
			expect(order?.paymentState).toBe("refund_requested");
			expect(mockStripeClient.paymentIntents.cancel).not.toHaveBeenCalled();
		});
	});

	describe("a refunded card attempt never un-pays a cash settlement", () => {
		it("leaves a cash-settled order paid, clears the pointer, and refunds the card", async () => {
			// The cash→card switch, from the other side. The diner moved an
			// `awaiting_payment` round onto a card (intent A live, pointer A), staff
			// collected at the table anyway, and A confirmed afterwards. Refunding A
			// is right; writing UNPAID over the cash settlement is not — the
			// restaurant has the money, and the ticket would say otherwise while
			// `settledBy`/`paidAt` sat there contradicting it.
			const t = convexTest(schema, modules);
			const seeded = await seedOrderAndPayment(t);
			const cashPaidAt = Date.now();
			await t.run(async (ctx) => {
				await ctx.db.patch(seeded.orderId, {
					status: "submitted",
					paymentState: "paid",
					settledBy: "staff",
					paidAt: cashPaidAt,
					// Staff collected without touching the diner's card attempt:
					// `markOrderPaidInPerson` leaves the pointer exactly where it was.
					updatedAt: Date.now() + 9_000,
				});
			});

			await confirm(t, seeded);
			await t.finishAllScheduledFunctions(() => vi.runAllTimers());

			const { order, payment } = await t.run(async (ctx) => ({
				order: await ctx.db.get(seeded.orderId),
				payment: await ctx.db.get(seeded.paymentId),
			}));
			// The card charge goes back...
			expect(mockStripeClient.refunds.create).toHaveBeenCalledTimes(1);
			expect(payment?.refundStatus).toBe("succeeded");
			// ...and the cash settlement is untouched.
			expect(order?.paymentState).toBe("paid");
			expect(order?.settledBy).toBe("staff");
			expect(order?.paidAt).toBe(cashPaidAt);
			// But nothing points at the refunded attempt any more.
			expect(order?.activePaymentId).toBeUndefined();
			expect(order?.stripePaymentIntentId).toBeUndefined();

			const alerts = await alertsOf(t);
			expect(alerts.map((alert) => alert.kind)).toEqual(["charge_mismatched_refunded"]);
		});

		it("still returns an unpaid order to unpaid when its own attempt is refunded", async () => {
			const t = convexTest(schema, modules);
			const seeded = await seedOrderAndPayment(t);
			await t.run(async (ctx) => {
				await ctx.db.patch(seeded.orderId, { totalAmount: 15000, updatedAt: Date.now() + 9_000 });
			});

			await confirm(t, seeded);
			await t.finishAllScheduledFunctions(() => vi.runAllTimers());

			const order = await t.run(async (ctx) => ctx.db.get(seeded.orderId));
			expect(order?.paymentState).toBe("unpaid");
			expect(order?.activePaymentId).toBeUndefined();
		});

		it("refuses to collect cash while a card attempt is live", async () => {
			// The same interlock `requestPayInPerson` applies from the diner's
			// side. Refused rather than stood down: a scheduled Stripe cancel would
			// land after this transaction commits the cash, which is the window
			// being closed.
			const t = convexTest(schema, modules);
			const seeded = await seedOrderAndPayment(t);
			const staff = await seedManager(t, seeded.restaurantId);
			await t.run(async (ctx) => {
				await ctx.db.patch(seeded.orderId, {
					status: "awaiting_payment",
					paymentState: "processing",
				});
			});

			await expect(
				staff.mutation(api.orders.markOrderPaidInPerson, { orderId: seeded.orderId })
			).rejects.toThrow(/ERROR_ORDER_PAYMENT_IN_FLIGHT/);

			const order = await t.run(async (ctx) => ctx.db.get(seeded.orderId));
			expect(order?.paymentState).toBe("processing");
			expect(order?.paidAt).toBeUndefined();
			expect(order?.settledBy).toBeUndefined();
		});

		it("collects cash once the card attempt is no longer live", async () => {
			const t = convexTest(schema, modules);
			const seeded = await seedOrderAndPayment(t);
			const staff = await seedManager(t, seeded.restaurantId);
			await t.run(async (ctx) => {
				// The diner backed out: `cancelOrderPaymentIntent` stood it down.
				await ctx.db.patch(seeded.paymentId, { status: "cancelled" });
				await ctx.db.patch(seeded.orderId, {
					status: "awaiting_payment",
					paymentState: "unpaid",
					activePaymentId: undefined,
				});
			});

			const [orderId, error] = await staff.mutation(api.orders.markOrderPaidInPerson, {
				orderId: seeded.orderId,
			});
			expect(error).toBeNull();
			expect(orderId).toBe(seeded.orderId);
			const order = await t.run(async (ctx) => ctx.db.get(seeded.orderId));
			expect(order?.paymentState).toBe("paid");
			expect(order?.settledBy).toBe("staff");
		});
	});

	describe("the refund's own webhook does not restate the order", () => {
		it("leaves a refunded stranded charge's order unpaid, not refunded", async () => {
			const t = convexTest(schema, modules);
			const seeded = await seedOrderAndPayment(t);
			await t.run(async (ctx) => {
				await ctx.db.patch(seeded.orderId, { totalAmount: 15000, updatedAt: Date.now() + 9_000 });
			});

			await confirm(t, seeded);
			await t.finishAllScheduledFunctions(() => vi.runAllTimers());

			await t.mutation(internal.stripeHelpers.recordChargeRefund, {
				paymentId: seeded.paymentId,
				amountRefunded: CHARGED,
				amountCaptured: CHARGED,
				isFullyRefunded: true,
				stripeRefundId: "re_stranded",
				latestStripeEventId: "evt_charge_refunded",
			});

			const { order, payment } = await t.run(async (ctx) => ({
				order: await ctx.db.get(seeded.orderId),
				payment: await ctx.db.get(seeded.paymentId),
			}));
			// Still owed. "Refunded" would tell staff, exports and the diner that
			// this order was paid for once.
			expect(order?.paymentState).toBe("unpaid");
			expect(payment?.refundStatus).toBe("succeeded");
		});

		it("leaves an order paid by another payment alone", async () => {
			const t = convexTest(schema, modules);
			const seeded = await seedOrderAndPayment(t);
			await seedSuccessor(t, seeded, { status: "succeeded", intentId: "pi_successor" });

			await confirm(t, seeded);
			await t.finishAllScheduledFunctions(() => vi.runAllTimers());
			await t.mutation(internal.stripeHelpers.recordChargeRefund, {
				paymentId: seeded.paymentId,
				amountRefunded: CHARGED,
				amountCaptured: CHARGED,
				isFullyRefunded: true,
				stripeRefundId: "re_duplicate",
				latestStripeEventId: "evt_charge_refunded_dup",
			});

			const order = await t.run(async (ctx) => ctx.db.get(seeded.orderId));
			// The duplicate went back; the payment that actually paid still stands.
			expect(order?.paymentState).toBe("paid");
		});

		it("still records a genuine refund of the order's own payment", async () => {
			const t = convexTest(schema, modules);
			const seeded = await seedOrderAndPayment(t);

			// Settled normally, then refunded — the ordinary cancel-and-refund path.
			await confirm(t, seeded);
			await t.finishAllScheduledFunctions(() => vi.runAllTimers());
			await t.mutation(internal.stripeHelpers.recordChargeRefund, {
				paymentId: seeded.paymentId,
				amountRefunded: CHARGED,
				amountCaptured: CHARGED,
				isFullyRefunded: true,
				stripeRefundId: "re_genuine",
				latestStripeEventId: "evt_charge_refunded_genuine",
			});

			const order = await t.run(async (ctx) => ctx.db.get(seeded.orderId));
			expect(order?.paymentState).toBe("refunded");
		});
	});

	describe("the order cannot be released by this charge at all", () => {
		it("refunds a charge for an order that was cancelled under it", async () => {
			const t = convexTest(schema, modules);
			const seeded = await seedOrderAndPayment(t);
			// Staff voided the ticket while the diner was on the payment sheet.
			// `cancelOrderAndRefund` never sees this charge — it arrived after.
			await t.run(async (ctx) => {
				await ctx.db.patch(seeded.orderId, { status: "cancelled" });
			});

			await confirm(t, seeded);
			await t.finishAllScheduledFunctions(() => vi.runAllTimers());

			// Nobody is cooking this, so the money goes back automatically.
			expect(mockStripeClient.refunds.create).toHaveBeenCalledTimes(1);
			const { order, payment } = await t.run(async (ctx) => ({
				order: await ctx.db.get(seeded.orderId),
				payment: await ctx.db.get(seeded.paymentId),
			}));
			expect(payment?.status).toBe("succeeded");
			expect(payment?.refundStatus).toBe("succeeded");
			expect(order?.paymentState).toBe("unpaid");
			const alerts = await alertsOf(t);
			expect(alerts.map((alert) => alert.kind)).toEqual(["charge_mismatched_refunded"]);
		});

		it("settles the money on a served round whose cash was never collected", async () => {
			// `releaseCashOrdersImmediately` (TAVLI-81) cooks and serves a round
			// while its cash is uncollected, so a diner paying by card from another
			// tab lands exactly here. Marking the row SUCCEEDED beside an unpaid
			// order — what this used to do — invites staff to collect the cash too.
			const t = convexTest(schema, modules);
			const seeded = await seedOrderAndPayment(t);
			await t.run(async (ctx) => {
				await ctx.db.patch(seeded.orderId, {
					status: "served",
					servedAt: Date.now(),
					paymentState: "unpaid",
				});
			});

			await confirm(t, seeded);
			await t.finishAllScheduledFunctions(() => vi.runAllTimers());

			const { order, payment } = await t.run(async (ctx) => ({
				order: await ctx.db.get(seeded.orderId),
				payment: await ctx.db.get(seeded.paymentId),
			}));
			expect(payment?.status).toBe("succeeded");
			expect(payment?.refundStatus).toBe("none");
			// The MONEY settles; the kitchen status does not move — putting a
			// finished round back on the rail would be worse than the bug.
			expect(order?.status).toBe("served");
			expect(order?.paymentState).toBe("paid");
			expect(order?.activePaymentId).toBe(seeded.paymentId);
			expect(order?.settledBy).toBe("stripe");
			expect(order?.paidAt).toBeGreaterThan(0);
			expect(mockStripeClient.refunds.create).not.toHaveBeenCalled();
			expect(await alertsOf(t)).toHaveLength(0);
		});

		it("refunds a card charge on a served round the diner already paid in cash", async () => {
			const t = convexTest(schema, modules);
			const seeded = await seedOrderAndPayment(t);
			await t.run(async (ctx) => {
				// `markOrderPaidInPerson` leaves no payment row at all, which is why
				// `paymentState` is the test and not just the active row.
				await ctx.db.patch(seeded.orderId, {
					status: "served",
					servedAt: Date.now(),
					paymentState: "paid",
					settledBy: "staff",
					paidAt: Date.now(),
					activePaymentId: undefined,
				});
			});

			await confirm(t, seeded);
			await t.finishAllScheduledFunctions(() => vi.runAllTimers());

			expect(mockStripeClient.refunds.create).toHaveBeenCalledTimes(1);
			const { order, payment } = await t.run(async (ctx) => ({
				order: await ctx.db.get(seeded.orderId),
				payment: await ctx.db.get(seeded.paymentId),
			}));
			expect(payment?.refundStatus).toBe("succeeded");
			// The cash settlement stands.
			expect(order?.paymentState).toBe("paid");
			expect(order?.settledBy).toBe("staff");
			const alerts = await alertsOf(t);
			expect(alerts.map((alert) => alert.kind)).toEqual(["charge_mismatched_refunded"]);
		});

		it("refunds a charge on a served round for an amount nobody was served", async () => {
			const t = convexTest(schema, modules);
			const seeded = await seedOrderAndPayment(t);
			await t.run(async (ctx) => {
				await ctx.db.patch(seeded.orderId, {
					status: "served",
					servedAt: Date.now(),
					paymentState: "unpaid",
					totalAmount: 15000,
				});
			});

			await confirm(t, seeded);
			await t.finishAllScheduledFunctions(() => vi.runAllTimers());

			expect(mockStripeClient.refunds.create).toHaveBeenCalledTimes(1);
			const { order, payment } = await t.run(async (ctx) => ({
				order: await ctx.db.get(seeded.orderId),
				payment: await ctx.db.get(seeded.paymentId),
			}));
			expect(payment?.refundStatus).toBe("succeeded");
			// Still owed: the round was served but never paid for.
			expect(order?.paymentState).toBe("unpaid");
			expect(await alertsOf(t)).toHaveLength(1);
		});

		it("does not refund a served round twice on a redelivery", async () => {
			const t = convexTest(schema, modules);
			const seeded = await seedOrderAndPayment(t);
			await t.run(async (ctx) => {
				await ctx.db.patch(seeded.orderId, {
					status: "served",
					servedAt: Date.now(),
					paymentState: "unpaid",
					totalAmount: 15000,
				});
			});

			await confirm(t, seeded);
			await confirm(t, seeded);
			await t.finishAllScheduledFunctions(() => vi.runAllTimers());

			expect(mockStripeClient.refunds.create).toHaveBeenCalledTimes(1);
			expect(await alertsOf(t)).toHaveLength(1);
		});
	});
});
