/**
 * The webhook refuses to settle a charge whose amount disagrees with the
 * payment row it names (TAVLI-69).
 *
 * `handlePaymentIntentSuccess` used to trust `payment_intent.succeeded`
 * completely: whatever Stripe said had succeeded, the matching row was marked
 * paid. Only the order path re-checked anything, and it re-checked the wrong
 * axis — `orders.confirmPayment` compares the ORDER's total against the payment
 * row, which catches an order edited after the intent was created but says
 * nothing about what Stripe actually collected. The tab and tip paths compared
 * nothing at all.
 *
 * So the guard here is a different question from `confirmPayment`'s: not "does
 * this order still cost what we charged for" but "did Stripe collect what this
 * row says it collected". It sits in `handlePaymentIntentSuccess` before any
 * dispatch, so all three kinds get it, and it runs before `confirmPayment`'s own
 * order-total check rather than instead of it.
 *
 * On a mismatch nothing settles, a `payment_amount_mismatch` operator alert is
 * raised (severe — money moved and Tavli cannot account for it), and the event
 * is still recorded as processed so Stripe stops redelivering. The tests below
 * pin all three of those, per kind.
 */
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { mockStripeClient } from "./_fixtures/stripeMock.fixture";

const modules = import.meta.glob("../**/*.ts");

vi.mock("stripe", async () => (await import("./_fixtures/stripeMock.fixture")).stripeModuleMock());

async function seedRestaurant(t: ReturnType<typeof convexTest>): Promise<Id<"restaurants">> {
	let restaurantId: Id<"restaurants">;
	await t.run(async (ctx) => {
		const organizationId = await ctx.db.insert("organizations", {
			name: "Mismatch Org",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner-1",
			organizationId,
			name: "Mismatch Test Restaurant",
			slug: `mismatch-${Math.random().toString(36).slice(2, 10)}`,
			currency: "USD",
			stripeAccountId: "acct_mismatch",
			stripeOnboardingComplete: true,
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});
	return restaurantId!;
}

/**
 * A submitted, fully payable ADR 008 order with a `kind: "order"` payment in
 * `processing` — the state a `payment_intent.succeeded` delivery lands on. Every
 * precondition `orders.confirmPayment` checks is satisfied, so if the order does
 * not settle in a test below, the amount guard is the only thing that stopped it.
 */
async function seedOrderPayment(
	t: ReturnType<typeof convexTest>,
	args: {
		restaurantId: Id<"restaurants">;
		subtotalAmount: number;
		feeAmount: number;
		paymentIntentId: string;
	}
): Promise<{ orderId: Id<"orders">; paymentId: Id<"payments"> }> {
	let orderId: Id<"orders">;
	let paymentId: Id<"payments">;
	await t.run(async (ctx) => {
		const tableId = await ctx.db.insert("tables", {
			restaurantId: args.restaurantId,
			tableNumber: 3,
			isActive: true,
			createdAt: Date.now(),
		});
		const sessionId = await ctx.db.insert("sessions", {
			restaurantId: args.restaurantId,
			tableId,
			userId: "diner-mismatch",
			status: "active",
			startedAt: Date.now(),
		});
		orderId = await ctx.db.insert("orders", {
			sessionId,
			restaurantId: args.restaurantId,
			tableId,
			status: "submitted",
			totalAmount: args.subtotalAmount,
			paymentState: "unpaid",
			submittedAt: Date.now(),
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});

		const menuId = await ctx.db.insert("menus", {
			restaurantId: args.restaurantId,
			name: "Menu",
			isActive: true,
			displayOrder: 0,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		const categoryId = await ctx.db.insert("menuCategories", {
			menuId,
			restaurantId: args.restaurantId,
			name: "Cat",
			displayOrder: 0,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		const menuItemId = await ctx.db.insert("menuItems", {
			categoryId,
			restaurantId: args.restaurantId,
			name: "Pozole",
			basePrice: args.subtotalAmount,
			isAvailable: true,
			displayOrder: 0,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		await ctx.db.insert("orderItems", {
			orderId,
			menuItemId,
			menuItemName: "Pozole",
			quantity: 1,
			unitPrice: args.subtotalAmount,
			selectedOptions: [],
			lineTotal: args.subtotalAmount,
			createdAt: Date.now(),
		});

		const order = await ctx.db.get(orderId);
		paymentId = await ctx.db.insert("payments", {
			restaurantId: args.restaurantId,
			orderId,
			amount: args.subtotalAmount + args.feeAmount,
			subtotalAmount: args.subtotalAmount,
			feeAmount: args.feeAmount,
			kind: "order",
			paidByUserId: "diner-mismatch",
			currency: "usd",
			status: "processing",
			refundStatus: "none",
			attemptNumber: 1,
			orderUpdatedAtSnapshot: order!.updatedAt,
			stripePaymentIntentId: args.paymentIntentId,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		await ctx.db.patch(orderId, {
			activePaymentId: paymentId,
			stripePaymentIntentId: args.paymentIntentId,
		});
	});
	return { orderId: orderId!, paymentId: paymentId! };
}

/** A post-visit tip payment (`kind: "tip"`, no service fee) mid-flight. */
async function seedTipPayment(
	t: ReturnType<typeof convexTest>,
	args: { restaurantId: Id<"restaurants">; tipAmount: number; paymentIntentId: string }
): Promise<{ sessionId: Id<"sessions">; paymentId: Id<"payments"> }> {
	let sessionId: Id<"sessions">;
	let paymentId: Id<"payments">;
	await t.run(async (ctx) => {
		const tableId = await ctx.db.insert("tables", {
			restaurantId: args.restaurantId,
			tableNumber: 4,
			isActive: true,
			createdAt: Date.now(),
		});
		sessionId = await ctx.db.insert("sessions", {
			restaurantId: args.restaurantId,
			tableId,
			userId: "diner-tip",
			status: "active",
			startedAt: Date.now(),
		});
		paymentId = await ctx.db.insert("payments", {
			restaurantId: args.restaurantId,
			sessionId,
			amount: args.tipAmount,
			subtotalAmount: 0,
			feeAmount: 0,
			gratuityAmount: args.tipAmount,
			kind: "tip",
			paidByUserId: "diner-tip",
			currency: "usd",
			status: "processing",
			refundStatus: "none",
			attemptNumber: 1,
			stripePaymentIntentId: args.paymentIntentId,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});
	return { sessionId: sessionId!, paymentId: paymentId! };
}

/**
 * A legacy tab payment: `sessionId` set, no `kind`. Settles the whole session
 * through `sessions.confirmTabPayment`.
 */
async function seedTabPayment(
	t: ReturnType<typeof convexTest>,
	args: {
		restaurantId: Id<"restaurants">;
		amount: number;
		gratuityAmount: number;
		paymentIntentId: string;
	}
): Promise<{ sessionId: Id<"sessions">; orderId: Id<"orders">; paymentId: Id<"payments"> }> {
	let sessionId: Id<"sessions">;
	let orderId: Id<"orders">;
	let paymentId: Id<"payments">;
	await t.run(async (ctx) => {
		const tableId = await ctx.db.insert("tables", {
			restaurantId: args.restaurantId,
			tableNumber: 7,
			isActive: true,
			createdAt: Date.now(),
		});
		sessionId = await ctx.db.insert("sessions", {
			restaurantId: args.restaurantId,
			tableId,
			userId: "diner-tab",
			status: "active",
			startedAt: Date.now() - 60 * 60 * 1000,
			lockedForPaymentAt: Date.now(),
			paymentState: "processing",
		});
		orderId = await ctx.db.insert("orders", {
			sessionId,
			restaurantId: args.restaurantId,
			tableId,
			status: "submitted",
			totalAmount: args.amount - args.gratuityAmount,
			paymentState: "unpaid",
			submittedAt: Date.now(),
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		paymentId = await ctx.db.insert("payments", {
			restaurantId: args.restaurantId,
			sessionId,
			amount: args.amount,
			currency: "usd",
			status: "processing",
			refundStatus: "none",
			attemptNumber: 1,
			gratuityAmount: args.gratuityAmount,
			stripePaymentIntentId: args.paymentIntentId,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		await ctx.db.patch(sessionId, { activePaymentId: paymentId });
	});
	return { sessionId: sessionId!, orderId: orderId!, paymentId: paymentId! };
}

function succeededIntentEvent(args: {
	eventId: string;
	paymentIntentId: string;
	amountReceived: number;
	/** Defaults to `amountReceived`; set separately only to test the fallback. */
	amount?: number;
	gratuityAmount?: number;
	omitAmountReceived?: boolean;
}) {
	return {
		id: args.eventId,
		type: "payment_intent.succeeded",
		created: 1_700_000_000,
		data: {
			object: {
				id: args.paymentIntentId,
				amount: args.amount ?? args.amountReceived,
				...(args.omitAmountReceived ? {} : { amount_received: args.amountReceived }),
				currency: "usd",
				latest_charge: "ch_mismatch",
				payment_method: "pm_mismatch",
				metadata: {
					...(args.gratuityAmount !== undefined && {
						gratuityAmount: String(args.gratuityAmount),
					}),
				},
			},
		},
	};
}

async function alertsOf(t: ReturnType<typeof convexTest>) {
	return await t.run(async (ctx) => ctx.db.query("operatorAlerts").collect());
}

async function fulfill(t: ReturnType<typeof convexTest>) {
	await t.action(internal.stripe.fulfillPayment, {
		payloadString: "{}",
		signatureHeader: "sig",
	});
}

describe("payment_intent.succeeded — amount assertion (TAVLI-69)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.env.STRIPE_SECRET_KEY = "sk_test_123";
		process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
	});

	describe("kind: order", () => {
		it("settles when the collected amount matches the payment row exactly", async () => {
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const { orderId, paymentId } = await seedOrderPayment(t, {
				restaurantId,
				subtotalAmount: 5000,
				feeAmount: 600,
				paymentIntentId: "pi_order_ok",
			});

			mockStripeClient.webhooks.constructEvent.mockReturnValue(
				succeededIntentEvent({
					eventId: "evt_order_ok",
					paymentIntentId: "pi_order_ok",
					// subtotal + fee, exactly what `payments.amount` holds.
					amountReceived: 5600,
				})
			);

			await fulfill(t);

			const { order, payment } = await t.run(async (ctx) => ({
				order: await ctx.db.get(orderId),
				payment: await ctx.db.get(paymentId),
			}));
			expect(payment?.status).toBe("succeeded");
			expect(order?.paymentState).toBe("paid");
			expect(await alertsOf(t)).toHaveLength(0);
		});

		it("does not settle, and alerts, when Stripe collected less than the row says", async () => {
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const { orderId, paymentId } = await seedOrderPayment(t, {
				restaurantId,
				subtotalAmount: 5000,
				feeAmount: 600,
				paymentIntentId: "pi_order_short",
			});

			mockStripeClient.webhooks.constructEvent.mockReturnValue(
				succeededIntentEvent({
					eventId: "evt_order_short",
					paymentIntentId: "pi_order_short",
					// 5600 was expected.
					amountReceived: 100,
				})
			);

			await fulfill(t);

			const { order, payment } = await t.run(async (ctx) => ({
				order: await ctx.db.get(orderId),
				payment: await ctx.db.get(paymentId),
			}));
			// Untouched: still processing, order still unpaid and out of the kitchen.
			expect(payment?.status).toBe("processing");
			expect(payment?.succeededAt).toBeUndefined();
			expect(order?.paymentState).toBe("unpaid");

			const alerts = await alertsOf(t);
			expect(alerts).toHaveLength(1);
			expect(alerts[0]).toMatchObject({
				kind: "payment_amount_mismatch",
				severity: "severe",
				status: "open",
				paymentId,
				restaurantId,
				dedupeKey: `amount_mismatch:${paymentId}`,
			});
			// The operator needs both numbers and the object to look up in Stripe.
			expect(alerts[0].messageParams).toMatchObject({ expected: 5600, received: 100 });
			expect(alerts[0].stripeObjectId).toBe("pi_order_short");
		});

		it("does not save the card off a charge it refuses to settle", async () => {
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const { paymentId } = await seedOrderPayment(t, {
				restaurantId,
				subtotalAmount: 5000,
				feeAmount: 600,
				paymentIntentId: "pi_order_card",
			});

			mockStripeClient.webhooks.constructEvent.mockReturnValue(
				succeededIntentEvent({
					eventId: "evt_order_card",
					paymentIntentId: "pi_order_card",
					amountReceived: 9900,
				})
			);

			await fulfill(t);

			const payment = await t.run(async (ctx) => ctx.db.get(paymentId));
			// The guard runs before the `setup_future_usage` persist, so a suspect
			// charge never leaves a saved card behind for one-tap tips to reuse.
			expect(payment?.stripePaymentMethodId).toBeUndefined();
		});
	});

	describe("kind: tip", () => {
		it("records the tip when the collected amount matches", async () => {
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const { paymentId } = await seedTipPayment(t, {
				restaurantId,
				tipAmount: 2500,
				paymentIntentId: "pi_tip_ok",
			});

			mockStripeClient.webhooks.constructEvent.mockReturnValue(
				succeededIntentEvent({
					eventId: "evt_tip_ok",
					paymentIntentId: "pi_tip_ok",
					amountReceived: 2500,
				})
			);

			await fulfill(t);

			const payment = await t.run(async (ctx) => ctx.db.get(paymentId));
			expect(payment?.status).toBe("succeeded");
			expect(await alertsOf(t)).toHaveLength(0);
		});

		it("does not record the tip, and alerts, when the amounts disagree", async () => {
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const { sessionId, paymentId } = await seedTipPayment(t, {
				restaurantId,
				tipAmount: 2500,
				paymentIntentId: "pi_tip_bad",
			});

			mockStripeClient.webhooks.constructEvent.mockReturnValue(
				succeededIntentEvent({
					eventId: "evt_tip_bad",
					paymentIntentId: "pi_tip_bad",
					// A tip charged for more than the diner chose.
					amountReceived: 25000,
				})
			);

			await fulfill(t);

			const payment = await t.run(async (ctx) => ctx.db.get(paymentId));
			expect(payment?.status).toBe("processing");
			expect(payment?.succeededAt).toBeUndefined();

			// No `sessions.tipPaid` audit event either: the tip is not recorded.
			const tipEvents = await t.run(async (ctx) =>
				ctx.db
					.query("allEvents")
					.filter((q) => q.eq(q.field("eventType"), "sessions.tipPaid"))
					.collect()
			);
			expect(tipEvents).toHaveLength(0);

			const alerts = await alertsOf(t);
			expect(alerts).toHaveLength(1);
			expect(alerts[0]).toMatchObject({
				kind: "payment_amount_mismatch",
				severity: "severe",
				paymentId,
				dedupeKey: `amount_mismatch:${paymentId}`,
			});
			expect(alerts[0].messageParams).toMatchObject({ expected: 2500, received: 25000 });
			expect(sessionId).toBeDefined();
		});
	});

	describe("legacy tab payment (no kind)", () => {
		it("settles the tab when the collected amount matches", async () => {
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const { orderId, paymentId } = await seedTabPayment(t, {
				restaurantId,
				amount: 1980,
				gratuityAmount: 180,
				paymentIntentId: "pi_tab_ok",
			});

			mockStripeClient.webhooks.constructEvent.mockReturnValue(
				succeededIntentEvent({
					eventId: "evt_tab_ok",
					paymentIntentId: "pi_tab_ok",
					amountReceived: 1980,
					gratuityAmount: 180,
				})
			);

			await fulfill(t);

			const { order, payment } = await t.run(async (ctx) => ({
				order: await ctx.db.get(orderId),
				payment: await ctx.db.get(paymentId),
			}));
			expect(payment?.status).toBe("succeeded");
			expect(order?.paymentState).toBe("paid");
			expect(await alertsOf(t)).toHaveLength(0);
		});

		it("leaves the tab unpaid, and alerts, when the amounts disagree", async () => {
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const { sessionId, orderId, paymentId } = await seedTabPayment(t, {
				restaurantId,
				amount: 1980,
				gratuityAmount: 180,
				paymentIntentId: "pi_tab_bad",
			});

			mockStripeClient.webhooks.constructEvent.mockReturnValue(
				succeededIntentEvent({
					eventId: "evt_tab_bad",
					paymentIntentId: "pi_tab_bad",
					amountReceived: 1800,
					gratuityAmount: 180,
				})
			);

			await fulfill(t);

			const { order, payment, session } = await t.run(async (ctx) => ({
				order: await ctx.db.get(orderId),
				payment: await ctx.db.get(paymentId),
				session: await ctx.db.get(sessionId),
			}));
			expect(payment?.status).toBe("processing");
			expect(order?.paymentState).toBe("unpaid");
			// The tab is emphatically not closed out.
			expect(session?.status).toBe("active");

			const alerts = await alertsOf(t);
			expect(alerts).toHaveLength(1);
			expect(alerts[0]).toMatchObject({
				kind: "payment_amount_mismatch",
				severity: "severe",
				paymentId,
				dedupeKey: `amount_mismatch:${paymentId}`,
			});
			expect(alerts[0].messageParams).toMatchObject({ expected: 1980, received: 1800 });
		});
	});

	describe("webhook mechanics on a mismatch", () => {
		it("still records the event as processed so Stripe stops redelivering", async () => {
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const { paymentId } = await seedTipPayment(t, {
				restaurantId,
				tipAmount: 2500,
				paymentIntentId: "pi_dedup",
			});

			mockStripeClient.webhooks.constructEvent.mockReturnValue(
				succeededIntentEvent({
					eventId: "evt_dedup",
					paymentIntentId: "pi_dedup",
					amountReceived: 1,
				})
			);

			await fulfill(t);

			const recorded = await t.run(async (ctx) => ctx.db.query("stripeWebhookEvents").collect());
			expect(recorded).toHaveLength(1);
			expect(recorded[0]).toMatchObject({
				eventId: "evt_dedup",
				eventType: "payment_intent.succeeded",
				paymentId,
			});
		});

		it("raises one alert, not one per delivery, when Stripe redelivers", async () => {
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const { paymentId } = await seedTipPayment(t, {
				restaurantId,
				tipAmount: 2500,
				paymentIntentId: "pi_replay",
			});

			// Two DIFFERENT event ids for the same problem: the webhook-event dedup
			// does not cover this, so only `dedupeKey` keeps the alert list bounded.
			mockStripeClient.webhooks.constructEvent.mockReturnValueOnce(
				succeededIntentEvent({
					eventId: "evt_replay_1",
					paymentIntentId: "pi_replay",
					amountReceived: 1,
				})
			);
			await fulfill(t);

			mockStripeClient.webhooks.constructEvent.mockReturnValueOnce(
				succeededIntentEvent({
					eventId: "evt_replay_2",
					paymentIntentId: "pi_replay",
					amountReceived: 1,
				})
			);
			await fulfill(t);

			const alerts = await alertsOf(t);
			expect(alerts).toHaveLength(1);
			expect(alerts[0].paymentId).toBe(paymentId);
		});

		it("logs the mismatch loudly, with redacted ids", async () => {
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			await seedTipPayment(t, {
				restaurantId,
				tipAmount: 2500,
				paymentIntentId: "pi_logged_mismatch",
			});

			mockStripeClient.webhooks.constructEvent.mockReturnValue(
				succeededIntentEvent({
					eventId: "evt_logged",
					paymentIntentId: "pi_logged_mismatch",
					amountReceived: 7,
				})
			);

			const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
			await fulfill(t);
			// Read the calls BEFORE restoring: `mockRestore` resets the spy's
			// recorded calls along with its implementation.
			const calls = [...errorSpy.mock.calls];
			errorSpy.mockRestore();

			const logged = calls.find(
				(call) => typeof call[1] === "object" && call[1] !== null && "expectedAmount" in call[1]
			);
			expect(logged, "the mismatch must reach the logs, not just the alert").toBeDefined();
			expect(logged?.[1]).toMatchObject({
				integration: "stripe-webhook",
				operation: "handlePaymentIntentSuccess",
				expectedAmount: 2500,
				receivedAmount: 7,
			});
			// Raw Stripe ids never go to the logs verbatim.
			expect(JSON.stringify(logged?.[1])).not.toContain("pi_logged_mismatch");
		});

		it("falls back to `amount` and settles when Stripe omits `amount_received`", async () => {
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const { paymentId } = await seedTipPayment(t, {
				restaurantId,
				tipAmount: 2500,
				paymentIntentId: "pi_no_received",
			});

			mockStripeClient.webhooks.constructEvent.mockReturnValue(
				succeededIntentEvent({
					eventId: "evt_no_received",
					paymentIntentId: "pi_no_received",
					amountReceived: 2500,
					omitAmountReceived: true,
				})
			);

			await fulfill(t);

			// Refusing to settle on a field Stripe simply did not send would strand
			// good money; `amount` is the documented equivalent on a success.
			const payment = await t.run(async (ctx) => ctx.db.get(paymentId));
			expect(payment?.status).toBe("succeeded");
			expect(await alertsOf(t)).toHaveLength(0);
		});
	});
});
