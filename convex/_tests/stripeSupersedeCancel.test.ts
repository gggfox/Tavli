/**
 * A superseded PaymentIntent is stood down at Stripe before its row is retired
 * (TAVLI-104).
 *
 * The bug these pin: a diner opens the pay screen (intent A), the order is
 * edited or the tip slider moves, and the next call creates intent B while
 * patching A's row to `superseded`. Nobody told Stripe. A stayed live, its
 * client secret stayed in the diner's browser, and a stale tab, a back button, a
 * double tap or a retry could still confirm it. Stripe charged the card,
 * `payment_intent.succeeded` arrived for A, and `orders.confirmPayment` could not
 * place it against the order — money gone, order never released.
 *
 * So every supersede path (order, tab, tip) now cancels at Stripe FIRST and
 * patches second, and refuses to create anything when it cannot:
 * - the old intent already `succeeded` → ERROR_PAYMENT_ALREADY_PAID, create
 *   nothing, let the webhook settle it;
 * - Stripe unreachable → ERROR_PAYMENT_CANCEL_FAILED, create nothing, "try
 *   again";
 * - the old attempt's own `create` call still in flight → ERROR_PAYMENT_IN_PROGRESS,
 *   because superseding a row whose `confirm: true` charge is mid-flight is how
 *   one tap becomes two charges (carried from the TAVLI-105 sign-off).
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

/** Records the order Stripe calls arrive in — the whole point of this ticket. */
const stripeCallLog: string[] = [];

async function seedRestaurant(t: ReturnType<typeof convexTest>): Promise<Id<"restaurants">> {
	let restaurantId: Id<"restaurants">;
	await t.run(async (ctx) => {
		const organizationId = await ctx.db.insert("organizations", {
			name: "Supersede Org",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		const slug = `supersede-${Math.random().toString(36).slice(2, 10)}`;
		restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner-supersede",
			organizationId,
			name: "Supersede Test Restaurant",
			slug,
			currency: "USD",
			stripeAccountId: "acct_supersede",
			stripeOnboardingComplete: true,
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		await insertMenuForRestaurant(ctx, {
			restaurantId,
			name: slug,
			userId: "owner-supersede",
		});
	});
	return restaurantId!;
}

async function seedDraftOrder(
	t: ReturnType<typeof convexTest>,
	args: { restaurantId: Id<"restaurants">; totalAmount: number }
) {
	const dinerId = "diner-supersede";
	let orderId: Id<"orders">;
	let sessionId: Id<"sessions">;
	await t.run(async (ctx) => {
		const tableId = await ctx.db.insert("tables", {
			restaurantId: args.restaurantId,
			tableNumber: 11,
			isActive: true,
			createdAt: Date.now(),
		});
		sessionId = await ctx.db.insert("sessions", {
			restaurantId: args.restaurantId,
			tableId,
			userId: dinerId,
			status: "active",
			startedAt: Date.now(),
		});
		orderId = await ctx.db.insert("orders", {
			sessionId,
			restaurantId: args.restaurantId,
			tableId,
			status: "draft",
			totalAmount: args.totalAmount,
			paymentState: "unpaid",
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});
	return {
		orderId: orderId!,
		sessionId: sessionId!,
		diner: t.withIdentity({ subject: dinerId }),
	};
}

/** Bumps `updatedAt` so the next `createPaymentIntent` must supersede. */
async function editOrder(t: ReturnType<typeof convexTest>, orderId: Id<"orders">) {
	await t.run(async (ctx) => {
		await ctx.db.patch(orderId, { updatedAt: Date.now() + 5_000 });
	});
}

async function paymentsOf(t: ReturnType<typeof convexTest>) {
	return await t.run(async (ctx) => ctx.db.query("payments").collect());
}

describe("superseding a payment attempt cancels its intent at Stripe first (TAVLI-104)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		stripeCallLog.length = 0;
		process.env.STRIPE_SECRET_KEY = "sk_test_123";
		mockStripeClient.customers.create.mockResolvedValue({ id: "cus_supersede" });
	});

	describe("order path — createPaymentIntent", () => {
		it("cancels the old intent BEFORE creating the replacement", async () => {
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const { orderId, diner } = await seedDraftOrder(t, { restaurantId, totalAmount: 20000 });

			mockStripeClient.paymentIntents.create
				.mockImplementationOnce(async () => {
					stripeCallLog.push("create:A");
					return { id: "pi_A", client_secret: "cs_A" };
				})
				.mockImplementationOnce(async () => {
					stripeCallLog.push("create:B");
					return { id: "pi_B", client_secret: "cs_B" };
				});
			mockStripeClient.paymentIntents.retrieve.mockImplementation(async (id: string) => {
				stripeCallLog.push(`retrieve:${id}`);
				return { id, status: "requires_payment_method", client_secret: "cs_A" };
			});
			mockStripeClient.paymentIntents.cancel.mockImplementation(async (id: string) => {
				stripeCallLog.push(`cancel:${id}`);
				return { id, status: "canceled" };
			});

			await diner.action(api.stripe.createPaymentIntent, { orderId });
			await editOrder(t, orderId);
			const second = await diner.action(api.stripe.createPaymentIntent, { orderId });

			expect(second.clientSecret).toBe("cs_B");
			// A is dead at Stripe before B exists. Reversed, the diner holds two
			// live client secrets for one order.
			expect(stripeCallLog).toEqual(["create:A", "retrieve:pi_A", "cancel:pi_A", "create:B"]);

			const payments = await paymentsOf(t);
			expect(payments).toHaveLength(2);
			expect(payments.find((p) => p.stripePaymentIntentId === "pi_A")?.status).toBe("superseded");
			expect(payments.find((p) => p.stripePaymentIntentId === "pi_B")?.status).toBe("processing");
		});

		it("creates nothing and says already paid when the old intent won the race", async () => {
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const { orderId, diner } = await seedDraftOrder(t, { restaurantId, totalAmount: 20000 });

			mockStripeClient.paymentIntents.create.mockResolvedValueOnce({
				id: "pi_won",
				client_secret: "cs_won",
			});
			await diner.action(api.stripe.createPaymentIntent, { orderId });
			await editOrder(t, orderId);

			// The stale tab confirmed it between the edit and this call.
			mockStripeClient.paymentIntents.retrieve.mockResolvedValue({
				id: "pi_won",
				status: "succeeded",
				client_secret: "cs_won",
			});

			await expect(diner.action(api.stripe.createPaymentIntent, { orderId })).rejects.toThrow(
				/ERROR_PAYMENT_ALREADY_PAID/
			);

			expect(mockStripeClient.paymentIntents.cancel).not.toHaveBeenCalled();
			expect(mockStripeClient.paymentIntents.create).toHaveBeenCalledTimes(1);
			// The row is untouched, so the webhook still settles it.
			const payments = await paymentsOf(t);
			expect(payments).toHaveLength(1);
			expect(payments[0].status).toBe("processing");
		});

		it("creates nothing and says try again when Stripe cannot be reached", async () => {
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const { orderId, diner } = await seedDraftOrder(t, { restaurantId, totalAmount: 20000 });

			mockStripeClient.paymentIntents.create.mockResolvedValueOnce({
				id: "pi_unreachable",
				client_secret: "cs_unreachable",
			});
			await diner.action(api.stripe.createPaymentIntent, { orderId });
			await editOrder(t, orderId);

			mockStripeClient.paymentIntents.retrieve.mockRejectedValue(new Error("connection error"));

			await expect(diner.action(api.stripe.createPaymentIntent, { orderId })).rejects.toThrow(
				/ERROR_PAYMENT_CANCEL_FAILED/
			);

			// One live intent we cannot prove is dead is bad; two is worse.
			expect(mockStripeClient.paymentIntents.create).toHaveBeenCalledTimes(1);
			const payments = await paymentsOf(t);
			expect(payments).toHaveLength(1);
			expect(payments[0].status).toBe("processing");
		});

		it("does not try to cancel an intent Stripe already reports as canceled", async () => {
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const { orderId, diner } = await seedDraftOrder(t, { restaurantId, totalAmount: 20000 });

			mockStripeClient.paymentIntents.create
				.mockResolvedValueOnce({ id: "pi_gone", client_secret: "cs_gone" })
				.mockResolvedValueOnce({ id: "pi_fresh", client_secret: "cs_fresh" });
			await diner.action(api.stripe.createPaymentIntent, { orderId });
			await editOrder(t, orderId);

			mockStripeClient.paymentIntents.retrieve.mockResolvedValue({
				id: "pi_gone",
				status: "canceled",
				client_secret: "cs_gone",
			});

			const second = await diner.action(api.stripe.createPaymentIntent, { orderId });

			expect(second.clientSecret).toBe("cs_fresh");
			expect(mockStripeClient.paymentIntents.cancel).not.toHaveBeenCalled();
		});

		it("refuses a second tap while the first attempt's create call is still in flight", async () => {
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const { orderId, diner } = await seedDraftOrder(t, { restaurantId, totalAmount: 20000 });

			// The shape the first tap leaves while `paymentIntents.create` runs:
			// row written, no intent id yet, seconds old.
			const paymentId = await t.run(async (ctx) => {
				const id = await ctx.db.insert("payments", {
					restaurantId,
					orderId,
					amount: 22400,
					subtotalAmount: 20000,
					feeAmount: 2400,
					kind: "order",
					paidByUserId: "diner-supersede",
					currency: "usd",
					status: "pending",
					refundStatus: "none",
					attemptNumber: 1,
					createdAt: Date.now() - 2_000,
					updatedAt: Date.now() - 2_000,
				});
				await ctx.db.patch(orderId, { activePaymentId: id, paymentState: "pending" });
				return id;
			});

			await expect(diner.action(api.stripe.createPaymentIntent, { orderId })).rejects.toThrow(
				/ERROR_PAYMENT_IN_PROGRESS/
			);

			expect(mockStripeClient.paymentIntents.create).not.toHaveBeenCalled();
			const payments = await paymentsOf(t);
			expect(payments).toHaveLength(1);
			expect(payments[0]._id).toBe(paymentId);
			expect(payments[0].status).toBe("pending");
		});

		it("lets a retry claim a pending row whose create call died long ago", async () => {
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const { orderId, diner } = await seedDraftOrder(t, { restaurantId, totalAmount: 20000 });

			// Past PAYMENT_CREATE_IN_FLIGHT_WINDOW_MS: debris, not an in-flight call.
			await t.run(async (ctx) => {
				const id = await ctx.db.insert("payments", {
					restaurantId,
					orderId,
					amount: 22400,
					subtotalAmount: 20000,
					feeAmount: 2400,
					kind: "order",
					paidByUserId: "diner-supersede",
					currency: "usd",
					status: "pending",
					refundStatus: "none",
					attemptNumber: 1,
					createdAt: Date.now() - 10 * 60 * 1000,
					updatedAt: Date.now() - 10 * 60 * 1000,
				});
				await ctx.db.patch(orderId, { activePaymentId: id, paymentState: "pending" });
			});

			mockStripeClient.paymentIntents.create.mockResolvedValueOnce({
				id: "pi_after_debris",
				client_secret: "cs_after_debris",
			});

			const result = await diner.action(api.stripe.createPaymentIntent, { orderId });

			expect(result.clientSecret).toBe("cs_after_debris");
			// Nothing to cancel: the dead row never got an intent id.
			expect(mockStripeClient.paymentIntents.retrieve).not.toHaveBeenCalled();
			const payments = await paymentsOf(t);
			expect(payments.filter((p) => p.status === "superseded")).toHaveLength(1);
		});

		it("still refuses a tap at 100s, while a retried create can legitimately be running", async () => {
			// The review catch. The first window was a flat 90s "against
			// stripe-node's 80s default timeout", which ignored `maxNetworkRetries`
			// — the worst case is `(retries + 1) × timeout` plus backoff. A tap at
			// 100s would have superseded a create that was still going; that create
			// then returns, and the webhook's metadata fallback settles the retired
			// row. The window is now derived from the same two constants the Stripe
			// client is built with, so the two cannot drift apart.
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const { orderId, diner } = await seedDraftOrder(t, { restaurantId, totalAmount: 20000 });

			await t.run(async (ctx) => {
				const id = await ctx.db.insert("payments", {
					restaurantId,
					orderId,
					amount: 22400,
					subtotalAmount: 20000,
					feeAmount: 2400,
					kind: "order",
					paidByUserId: "diner-supersede",
					currency: "usd",
					status: "pending",
					refundStatus: "none",
					attemptNumber: 1,
					createdAt: Date.now() - 100_000,
					updatedAt: Date.now() - 100_000,
				});
				await ctx.db.patch(orderId, { activePaymentId: id, paymentState: "pending" });
			});

			await expect(diner.action(api.stripe.createPaymentIntent, { orderId })).rejects.toThrow(
				/ERROR_PAYMENT_IN_PROGRESS/
			);
			expect(mockStripeClient.paymentIntents.create).not.toHaveBeenCalled();
		});

		it("refuses the second of two taps that both got past the snapshot check", async () => {
			// The action's guard reads a snapshot; two taps a few hundred
			// milliseconds apart both pass it. Only the inserting transaction can
			// order them, which is why the same question is asked again inside
			// `createPayment` — and why that mutation moves the order's pointer in
			// the same transaction, so the two collide on one document.
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const { orderId } = await seedDraftOrder(t, { restaurantId, totalAmount: 20000 });

			const firstId = await t.mutation(internal.stripeHelpers.createPayment, {
				restaurantId,
				orderId,
				amount: 22400,
				subtotalAmount: 20000,
				feeAmount: 2400,
				kind: "order",
				paidByUserId: "diner-supersede",
				currency: "usd",
				status: "pending",
				refundStatus: "none",
				attemptNumber: 1,
			});

			// The second tap believes there was nothing to replace — exactly what a
			// stale snapshot looks like.
			await expect(
				t.mutation(internal.stripeHelpers.createPayment, {
					restaurantId,
					orderId,
					amount: 22400,
					subtotalAmount: 20000,
					feeAmount: 2400,
					kind: "order",
					paidByUserId: "diner-supersede",
					currency: "usd",
					status: "pending",
					refundStatus: "none",
					attemptNumber: 2,
				})
			).rejects.toThrow(/ERROR_PAYMENT_IN_PROGRESS/);

			const payments = await paymentsOf(t);
			expect(payments).toHaveLength(1);
			expect(payments[0]._id).toBe(firstId);
			// And the pointer moved inside that insert, which is what gives the two
			// taps something to collide on.
			const order = await t.run(async (ctx) => ctx.db.get(orderId));
			expect(order?.activePaymentId).toBe(firstId);
		});
	});

	describe("tip path — createTipCharge", () => {
		/** A session the diner is a member of, with a member row to tip. */
		async function seedTippableSession(
			t: ReturnType<typeof convexTest>,
			restaurantId: Id<"restaurants">
		) {
			let sessionId: Id<"sessions">;
			await t.run(async (ctx) => {
				const tableId = await ctx.db.insert("tables", {
					restaurantId,
					tableNumber: 12,
					isActive: true,
					createdAt: Date.now(),
				});
				sessionId = await ctx.db.insert("sessions", {
					restaurantId,
					tableId,
					userId: "diner-tipper",
					status: "active",
					startedAt: Date.now(),
				});
			});
			return { sessionId: sessionId!, diner: t.withIdentity({ subject: "diner-tipper" }) };
		}

		it("refuses the second tap while the first tip charge is still in flight", async () => {
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const { sessionId, diner } = await seedTippableSession(t, restaurantId);

			// THE carried TAVLI-105 finding: `off_session` + `confirm: true` moves the
			// money inside the create call, so this row's charge may be happening
			// right now. Superseding it tipped the server twice for one tap.
			const paymentId = await t.run(async (ctx) =>
				ctx.db.insert("payments", {
					restaurantId,
					sessionId,
					amount: 5000,
					subtotalAmount: 0,
					feeAmount: 0,
					gratuityAmount: 5000,
					kind: "tip",
					paidByUserId: "diner-tipper",
					currency: "usd",
					status: "pending",
					refundStatus: "none",
					attemptNumber: 1,
					createdAt: Date.now() - 1_000,
					updatedAt: Date.now() - 1_000,
				})
			);

			await expect(
				diner.action(api.stripe.createTipCharge, { sessionId, tipAmount: 5000 })
			).rejects.toThrow(/ERROR_PAYMENT_IN_PROGRESS/);

			expect(mockStripeClient.paymentIntents.create).not.toHaveBeenCalled();
			const payments = await paymentsOf(t);
			expect(payments).toHaveLength(1);
			expect(payments[0]._id).toBe(paymentId);
			expect(payments[0].status).toBe("pending");
		});

		it("refuses the second of two tip taps that both got past the snapshot check", async () => {
			// The one-tap charge moves money INSIDE `paymentIntents.create`, so two
			// rows is two tips. The scope here is the session's tip rows rather
			// than an order document; Convex tracks the query's read set, so the
			// loser's insert conflicts and it re-runs into this guard.
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const { sessionId } = await seedTippableSession(t, restaurantId);

			const row = {
				restaurantId,
				sessionId,
				amount: 5000,
				subtotalAmount: 0,
				feeAmount: 0,
				gratuityAmount: 5000,
				kind: "tip" as const,
				paidByUserId: "diner-tipper",
				currency: "usd",
				status: "pending" as const,
				refundStatus: "none" as const,
			};
			const firstId = await t.mutation(internal.stripeHelpers.createPayment, {
				...row,
				attemptNumber: 1,
			});

			await expect(
				t.mutation(internal.stripeHelpers.createPayment, { ...row, attemptNumber: 2 })
			).rejects.toThrow(/ERROR_PAYMENT_IN_PROGRESS/);

			const payments = await paymentsOf(t);
			expect(payments).toHaveLength(1);
			expect(payments[0]._id).toBe(firstId);
		});

		it("does not attach a late intent to a row that was retired under it", async () => {
			// The residue the window cannot cover: the create finally returns after
			// the row was superseded. Attaching the id would hand the webhook's
			// metadata fallback a target, and `confirmTipPayment` settles anything
			// that is not already SUCCEEDED — the double tip, by the back door.
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const { sessionId } = await seedTippableSession(t, restaurantId);

			const paymentId = await t.run(async (ctx) =>
				ctx.db.insert("payments", {
					restaurantId,
					sessionId,
					amount: 5000,
					subtotalAmount: 0,
					feeAmount: 0,
					gratuityAmount: 5000,
					kind: "tip",
					paidByUserId: "diner-tipper",
					currency: "usd",
					status: "superseded",
					refundStatus: "none",
					attemptNumber: 1,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				})
			);

			mockStripeClient.paymentIntents.retrieve.mockResolvedValue({
				id: "pi_late",
				status: "requires_payment_method",
			});
			mockStripeClient.paymentIntents.cancel.mockResolvedValue({
				id: "pi_late",
				status: "canceled",
			});

			vi.useFakeTimers();
			try {
				await t.mutation(internal.stripeHelpers.attachIntentToPayment, {
					paymentId,
					stripePaymentIntentId: "pi_late",
				});
				await t.finishAllScheduledFunctions(() => vi.runAllTimers());
			} finally {
				vi.useRealTimers();
			}

			const payment = await t.run(async (ctx) => ctx.db.get(paymentId));
			expect(payment?.stripePaymentIntentId).toBeUndefined();
			expect(payment?.status).toBe("superseded");
			// The orphan is killed at Stripe instead, so it can never be confirmed.
			expect(mockStripeClient.paymentIntents.cancel).toHaveBeenCalledWith("pi_late");
		});

		it("alerts when the late intent had already charged the card", async () => {
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const { sessionId } = await seedTippableSession(t, restaurantId);

			const paymentId = await t.run(async (ctx) =>
				ctx.db.insert("payments", {
					restaurantId,
					sessionId,
					amount: 5000,
					subtotalAmount: 0,
					feeAmount: 0,
					gratuityAmount: 5000,
					kind: "tip",
					paidByUserId: "diner-tipper",
					currency: "usd",
					status: "superseded",
					refundStatus: "none",
					attemptNumber: 1,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				})
			);

			mockStripeClient.paymentIntents.retrieve.mockResolvedValue({
				id: "pi_late_charged",
				status: "succeeded",
			});

			vi.useFakeTimers();
			try {
				await t.mutation(internal.stripeHelpers.attachIntentToPayment, {
					paymentId,
					stripePaymentIntentId: "pi_late_charged",
				});
				await t.finishAllScheduledFunctions(() => vi.runAllTimers());
			} finally {
				vi.useRealTimers();
			}

			expect(mockStripeClient.paymentIntents.cancel).not.toHaveBeenCalled();
			// A tip charge nothing will look at again — only an alert carries it to
			// a human.
			const alerts = await t.run(async (ctx) => ctx.db.query("operatorAlerts").collect());
			expect(alerts).toHaveLength(1);
			expect(alerts[0]).toMatchObject({
				kind: "charge_needs_review",
				severity: "severe",
				paymentId,
				stripeObjectId: "pi_late_charged",
				dedupeKey: `charge_on_retired_attempt:${paymentId}`,
			});
			expect(alerts[0].messageParams).toEqual({ collected: "50.00", currency: "USD" });
		});

		it("cancels a live tip intent before retiring its row", async () => {
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const { sessionId, diner } = await seedTippableSession(t, restaurantId);

			await t.run(async (ctx) =>
				ctx.db.insert("payments", {
					restaurantId,
					sessionId,
					amount: 5000,
					subtotalAmount: 0,
					feeAmount: 0,
					gratuityAmount: 5000,
					kind: "tip",
					paidByUserId: "diner-tipper",
					currency: "usd",
					status: "processing",
					refundStatus: "none",
					attemptNumber: 1,
					stripePaymentIntentId: "pi_tip_old",
					createdAt: Date.now() - 10 * 60 * 1000,
					updatedAt: Date.now() - 10 * 60 * 1000,
				})
			);

			// No client secret to hand back, so the existing reuse branch falls
			// through to the supersede — which now has to cancel first.
			mockStripeClient.paymentIntents.retrieve.mockImplementation(async (id: string) => {
				stripeCallLog.push(`retrieve:${id}`);
				return { id, status: "requires_action", client_secret: null };
			});
			mockStripeClient.paymentIntents.cancel.mockImplementation(async (id: string) => {
				stripeCallLog.push(`cancel:${id}`);
				return { id, status: "canceled" };
			});
			mockStripeClient.paymentIntents.create.mockImplementationOnce(async () => {
				stripeCallLog.push("create:new");
				return { id: "pi_tip_new", client_secret: "cs_tip_new" };
			});

			await diner.action(api.stripe.createTipCharge, { sessionId, tipAmount: 5000 });

			expect(stripeCallLog).toEqual([
				// once by the reuse branch, once by the stand-down
				"retrieve:pi_tip_old",
				"retrieve:pi_tip_old",
				"cancel:pi_tip_old",
				"create:new",
			]);
			const payments = await paymentsOf(t);
			expect(payments.find((p) => p.stripePaymentIntentId === "pi_tip_old")?.status).toBe(
				"superseded"
			);
		});
	});

	describe("tab path — createTabPaymentIntent", () => {
		async function seedPayableTab(
			t: ReturnType<typeof convexTest>,
			restaurantId: Id<"restaurants">,
			subtotal: number
		) {
			let sessionId: Id<"sessions">;
			await t.run(async (ctx) => {
				const tableId = await ctx.db.insert("tables", {
					restaurantId,
					tableNumber: 13,
					isActive: true,
					createdAt: Date.now(),
				});
				sessionId = await ctx.db.insert("sessions", {
					restaurantId,
					tableId,
					userId: "diner-tab",
					status: "active",
					startedAt: Date.now(),
				});
				await ctx.db.insert("orders", {
					sessionId,
					restaurantId,
					tableId,
					status: "served",
					totalAmount: subtotal,
					paymentState: "unpaid",
					submittedAt: Date.now(),
					servedAt: Date.now(),
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
			});
			return { sessionId: sessionId!, diner: t.withIdentity({ subject: "diner-tab" }) };
		}

		it("cancels the previous tab intent before the mutation retires its row", async () => {
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const { sessionId, diner } = await seedPayableTab(t, restaurantId, 30000);

			mockStripeClient.paymentIntents.create
				.mockImplementationOnce(async () => {
					stripeCallLog.push("create:tab_A");
					return { id: "pi_tab_A", client_secret: "cs_tab_A" };
				})
				.mockImplementationOnce(async () => {
					stripeCallLog.push("create:tab_B");
					return { id: "pi_tab_B", client_secret: "cs_tab_B" };
				});
			mockStripeClient.paymentIntents.retrieve.mockImplementation(async (id: string) => {
				stripeCallLog.push(`retrieve:${id}`);
				return { id, status: "requires_payment_method", client_secret: "cs_tab_A" };
			});
			mockStripeClient.paymentIntents.cancel.mockImplementation(async (id: string) => {
				stripeCallLog.push(`cancel:${id}`);
				return { id, status: "canceled" };
			});

			await diner.action(api.stripe.createTabPaymentIntent, { sessionId, tipAmount: 0 });
			// A different tip: the amount no longer matches, so the reuse branch
			// falls through to the supersede.
			const second = await diner.action(api.stripe.createTabPaymentIntent, {
				sessionId,
				tipAmount: 4000,
			});

			expect(second.clientSecret).toBe("cs_tab_B");
			expect(stripeCallLog).toEqual([
				"create:tab_A",
				"retrieve:pi_tab_A",
				"cancel:pi_tab_A",
				"create:tab_B",
			]);
			const payments = await paymentsOf(t);
			expect(payments.find((p) => p.stripePaymentIntentId === "pi_tab_A")?.status).toBe(
				"superseded"
			);
		});

		it("refuses the second of two members tapping Pay at the same moment", async () => {
			// Any tab member can pay, so this is a normal Tuesday. Both taps read
			// the same `activePaymentId`, both stand the same intent down, and both
			// arrive at `beginTabPayment`. Without naming the attempt it is allowed
			// to retire, the second one retires the FIRST diner's live row — whose
			// client secret is on their screen — and points the session at its own.
			// That diner then pays an intent the session has forgotten, and
			// `confirmTabPayment` warns and returns.
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const { sessionId, diner } = await seedPayableTab(t, restaurantId, 30000);

			mockStripeClient.paymentIntents.create.mockResolvedValueOnce({
				id: "pi_tab_first",
				client_secret: "cs_tab_first",
			});
			const first = await diner.action(api.stripe.createTabPaymentIntent, {
				sessionId,
				tipAmount: 0,
			});

			// The second member's action ran against the snapshot from BEFORE the
			// first tap locked the tab: it believes there is nothing to replace.
			await expect(
				t.mutation(internal.sessions.beginTabPayment, {
					sessionId,
					restaurantId,
					amount: 30000,
					currency: "usd",
					gratuityAmount: 0,
					userId: "diner-tab-2",
				})
			).rejects.toThrow(/ERROR_PAYMENT_IN_PROGRESS/);

			const session = await t.run(async (ctx) => ctx.db.get(sessionId));
			expect(session?.activePaymentId).toBe(first.paymentId);
			const payments = await paymentsOf(t);
			expect(payments).toHaveLength(1);
			expect(payments[0].status).toBe("processing");
		});

		it("refuses to retire a tab attempt whose own create call is still running", async () => {
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const { sessionId } = await seedPayableTab(t, restaurantId, 30000);

			const inFlightId = await t.run(async (ctx) => {
				const id = await ctx.db.insert("payments", {
					restaurantId,
					sessionId,
					amount: 30000,
					currency: "usd",
					status: "pending",
					refundStatus: "none",
					attemptNumber: 1,
					gratuityAmount: 0,
					createdAt: Date.now() - 2_000,
					updatedAt: Date.now() - 2_000,
				});
				await ctx.db.patch(sessionId, { activePaymentId: id, lockedForPaymentAt: Date.now() });
				return id;
			});

			// Even naming it correctly is not enough: there was no intent to cancel,
			// so retiring the row would let this tap charge the tab a second time.
			await expect(
				t.mutation(internal.sessions.beginTabPayment, {
					sessionId,
					restaurantId,
					amount: 30000,
					currency: "usd",
					gratuityAmount: 0,
					userId: "diner-tab-2",
					supersededPaymentId: inFlightId,
				})
			).rejects.toThrow(/ERROR_PAYMENT_IN_PROGRESS/);

			const payments = await paymentsOf(t);
			expect(payments).toHaveLength(1);
			expect(payments[0].status).toBe("pending");
		});

		it("does the same on the tab path, leaving the session unlocked for the live attempt", async () => {
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const { sessionId, diner } = await seedPayableTab(t, restaurantId, 30000);

			mockStripeClient.paymentIntents.create.mockImplementationOnce(async () => {
				await t.run(async (ctx) => {
					const rows = await ctx.db.query("payments").collect();
					await ctx.db.patch(rows[0]._id, { status: "superseded" });
				});
				return { id: "pi_tab_orphan", client_secret: "cs_tab_orphan" };
			});
			mockStripeClient.paymentIntents.retrieve.mockResolvedValue({
				id: "pi_tab_orphan",
				status: "requires_payment_method",
			});
			mockStripeClient.paymentIntents.cancel.mockResolvedValue({
				id: "pi_tab_orphan",
				status: "canceled",
			});

			vi.useFakeTimers();
			try {
				await expect(
					diner.action(api.stripe.createTabPaymentIntent, { sessionId, tipAmount: 0 })
				).rejects.toThrow(/ERROR_PAYMENT_IN_PROGRESS/);
				await t.finishAllScheduledFunctions(() => vi.runAllTimers());
			} finally {
				vi.useRealTimers();
			}

			const { session, payments } = await t.run(async (ctx) => ({
				session: await ctx.db.get(sessionId),
				payments: await ctx.db.query("payments").collect(),
			}));
			expect(payments[0].stripePaymentIntentId).toBeUndefined();
			expect(session?.paymentState).not.toBe("processing");
			expect(mockStripeClient.paymentIntents.cancel).toHaveBeenCalledWith("pi_tab_orphan");
		});

		it("leaves the tab lock and the old row alone when Stripe cannot be reached", async () => {
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const { sessionId, diner } = await seedPayableTab(t, restaurantId, 30000);

			mockStripeClient.paymentIntents.create.mockResolvedValueOnce({
				id: "pi_tab_stuck",
				client_secret: "cs_tab_stuck",
			});
			await diner.action(api.stripe.createTabPaymentIntent, { sessionId, tipAmount: 0 });

			const lockBefore = await t.run(async (ctx) => (await ctx.db.get(sessionId))!.activePaymentId);
			mockStripeClient.paymentIntents.retrieve.mockRejectedValue(new Error("connection error"));

			await expect(
				diner.action(api.stripe.createTabPaymentIntent, { sessionId, tipAmount: 4000 })
			).rejects.toThrow(/ERROR_PAYMENT_CANCEL_FAILED/);

			// `beginTabPayment` was never reached: no second row, no new lock, and
			// the first attempt still owns the tab.
			const payments = await paymentsOf(t);
			expect(payments).toHaveLength(1);
			expect(payments[0].status).toBe("processing");
			const session = await t.run(async (ctx) => ctx.db.get(sessionId));
			expect(session?.activePaymentId).toBe(lockBefore);
			expect(mockStripeClient.paymentIntents.create).toHaveBeenCalledTimes(1);
		});
	});

	describe("cancelOrderPaymentIntent still behaves after the extraction", () => {
		it("stands the intent down and clears the order's pointer", async () => {
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const { orderId, diner } = await seedDraftOrder(t, { restaurantId, totalAmount: 20000 });

			mockStripeClient.paymentIntents.create.mockResolvedValueOnce({
				id: "pi_abandon",
				client_secret: "cs_abandon",
			});
			await diner.action(api.stripe.createPaymentIntent, { orderId });

			mockStripeClient.paymentIntents.retrieve.mockResolvedValue({
				id: "pi_abandon",
				status: "requires_payment_method",
			});
			mockStripeClient.paymentIntents.cancel.mockResolvedValue({
				id: "pi_abandon",
				status: "canceled",
			});

			const result = await diner.action(api.stripe.cancelOrderPaymentIntent, { orderId });

			expect(result).toEqual({ cancelled: true, settled: false });
			const order = await t.run(async (ctx) => ctx.db.get(orderId));
			expect(order?.activePaymentId).toBeUndefined();
			expect(order?.paymentState).toBe("unpaid");
		});

		it("reports the charge won the race instead of cancelling it", async () => {
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const { orderId, diner } = await seedDraftOrder(t, { restaurantId, totalAmount: 20000 });

			mockStripeClient.paymentIntents.create.mockResolvedValueOnce({
				id: "pi_race",
				client_secret: "cs_race",
			});
			await diner.action(api.stripe.createPaymentIntent, { orderId });

			mockStripeClient.paymentIntents.retrieve.mockResolvedValue({
				id: "pi_race",
				status: "succeeded",
			});

			const result = await diner.action(api.stripe.cancelOrderPaymentIntent, { orderId });

			expect(result).toEqual({ cancelled: false, settled: true });
			expect(mockStripeClient.paymentIntents.cancel).not.toHaveBeenCalled();
		});

		it("rethrows when the stand-down never reached Stripe", async () => {
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const { orderId, diner } = await seedDraftOrder(t, { restaurantId, totalAmount: 20000 });

			mockStripeClient.paymentIntents.create.mockResolvedValueOnce({
				id: "pi_throw",
				client_secret: "cs_throw",
			});
			await diner.action(api.stripe.createPaymentIntent, { orderId });

			mockStripeClient.paymentIntents.retrieve.mockResolvedValue({
				id: "pi_throw",
				status: "requires_payment_method",
			});
			mockStripeClient.paymentIntents.cancel.mockRejectedValue(new Error("cancel exploded"));

			await expect(diner.action(api.stripe.cancelOrderPaymentIntent, { orderId })).rejects.toThrow(
				/cancel exploded/
			);

			// The order still points at the intent, so nothing pretends it is gone.
			const order = await t.run(async (ctx) => ctx.db.get(orderId));
			expect(order?.activePaymentId).toBeTruthy();
		});
	});

	describe("a row retired while its own create call was running", () => {
		it("returns no client secret and leaves the order pointer alone", async () => {
			// The create came back with an intent the row is no longer entitled to:
			// a concurrent tap retired it in the meantime. Handing that client
			// secret to the diner would let them confirm a charge no row will ever
			// settle, and re-pointing the order at it would make it look live.
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const { orderId, diner } = await seedDraftOrder(t, { restaurantId, totalAmount: 20000 });

			// Retire the row the moment it is created, which is what a racing tap
			// does between `createPayment` and the Stripe response.
			mockStripeClient.paymentIntents.create.mockImplementationOnce(async () => {
				await t.run(async (ctx) => {
					const rows = await ctx.db.query("payments").collect();
					await ctx.db.patch(rows[0]._id, { status: "superseded" });
				});
				return { id: "pi_orphan", client_secret: "cs_orphan" };
			});
			mockStripeClient.paymentIntents.retrieve.mockResolvedValue({
				id: "pi_orphan",
				status: "requires_payment_method",
			});
			mockStripeClient.paymentIntents.cancel.mockResolvedValue({
				id: "pi_orphan",
				status: "canceled",
			});

			vi.useFakeTimers();
			try {
				await expect(diner.action(api.stripe.createPaymentIntent, { orderId })).rejects.toThrow(
					/ERROR_PAYMENT_IN_PROGRESS/
				);
				await t.finishAllScheduledFunctions(() => vi.runAllTimers());
			} finally {
				vi.useRealTimers();
			}

			const { order, payments } = await t.run(async (ctx) => ({
				order: await ctx.db.get(orderId),
				payments: await ctx.db.query("payments").collect(),
			}));
			// The row never learned the orphan's id, and the order was not moved to
			// `processing` or pointed at it.
			expect(payments[0].stripePaymentIntentId).toBeUndefined();
			expect(payments[0].status).toBe("superseded");
			expect(order?.paymentState).not.toBe("processing");
			expect(order?.stripePaymentIntentId).toBeUndefined();
			// And the orphan is killed at Stripe rather than left confirmable.
			expect(mockStripeClient.paymentIntents.cancel).toHaveBeenCalledWith("pi_orphan");
		});
	});

	describe("a cancel whose intent slipped through", () => {
		it("reports already paid, not try again, when the intent succeeded mid-cancel", async () => {
			// Stripe answers `payment_intent_unexpected_state` when the intent
			// stopped being cancellable between the retrieve and the cancel — the
			// diner's stale tab confirmed it in that sliver. Reporting "unreachable"
			// there sends them "try again", and the retry then fails with a blunter
			// error on an order that is already paying.
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const { orderId, diner } = await seedDraftOrder(t, { restaurantId, totalAmount: 20000 });

			mockStripeClient.paymentIntents.create.mockResolvedValueOnce({
				id: "pi_slipped",
				client_secret: "cs_slipped",
			});
			await diner.action(api.stripe.createPaymentIntent, { orderId });
			await editOrder(t, orderId);

			mockStripeClient.paymentIntents.retrieve
				.mockResolvedValueOnce({ id: "pi_slipped", status: "requires_payment_method" })
				// The re-read after the failed cancel.
				.mockResolvedValueOnce({ id: "pi_slipped", status: "succeeded" });
			mockStripeClient.paymentIntents.cancel.mockRejectedValue(
				Object.assign(new Error("You cannot cancel this PaymentIntent"), {
					code: "payment_intent_unexpected_state",
				})
			);

			await expect(diner.action(api.stripe.createPaymentIntent, { orderId })).rejects.toThrow(
				/ERROR_PAYMENT_ALREADY_PAID/
			);
			expect(mockStripeClient.paymentIntents.create).toHaveBeenCalledTimes(1);
		});

		it("still says try again when the re-read cannot reach Stripe either", async () => {
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const { orderId, diner } = await seedDraftOrder(t, { restaurantId, totalAmount: 20000 });

			mockStripeClient.paymentIntents.create.mockResolvedValueOnce({
				id: "pi_down",
				client_secret: "cs_down",
			});
			await diner.action(api.stripe.createPaymentIntent, { orderId });
			await editOrder(t, orderId);

			mockStripeClient.paymentIntents.retrieve
				.mockResolvedValueOnce({ id: "pi_down", status: "requires_payment_method" })
				.mockRejectedValueOnce(new Error("connection error"));
			mockStripeClient.paymentIntents.cancel.mockRejectedValue(new Error("connection error"));

			await expect(diner.action(api.stripe.createPaymentIntent, { orderId })).rejects.toThrow(
				/ERROR_PAYMENT_CANCEL_FAILED/
			);
		});
	});

	describe("the superseded-intent hop", () => {
		it("cancels the intent of a row the webhook retired", async () => {
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const { orderId } = await seedDraftOrder(t, { restaurantId, totalAmount: 20000 });

			const paymentId = await t.run(async (ctx) =>
				ctx.db.insert("payments", {
					restaurantId,
					orderId,
					amount: 22400,
					subtotalAmount: 20000,
					feeAmount: 2400,
					kind: "order",
					paidByUserId: "diner-supersede",
					currency: "usd",
					status: "superseded",
					refundStatus: "none",
					attemptNumber: 2,
					stripePaymentIntentId: "pi_loser",
					createdAt: Date.now(),
					updatedAt: Date.now(),
				})
			);

			mockStripeClient.paymentIntents.retrieve.mockResolvedValue({
				id: "pi_loser",
				status: "requires_payment_method",
			});
			mockStripeClient.paymentIntents.cancel.mockResolvedValue({
				id: "pi_loser",
				status: "canceled",
			});

			await t.action(internal.stripe.standDownSupersededIntent, { paymentId });

			expect(mockStripeClient.paymentIntents.cancel).toHaveBeenCalledWith("pi_loser");
		});

		it("leaves a row that settled in the meantime alone", async () => {
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const { orderId } = await seedDraftOrder(t, { restaurantId, totalAmount: 20000 });

			const paymentId = await t.run(async (ctx) =>
				ctx.db.insert("payments", {
					restaurantId,
					orderId,
					amount: 22400,
					subtotalAmount: 20000,
					feeAmount: 2400,
					kind: "order",
					paidByUserId: "diner-supersede",
					currency: "usd",
					status: "succeeded",
					refundStatus: "none",
					attemptNumber: 2,
					stripePaymentIntentId: "pi_settled",
					succeededAt: Date.now(),
					createdAt: Date.now(),
					updatedAt: Date.now(),
				})
			);

			await t.action(internal.stripe.standDownSupersededIntent, { paymentId });

			expect(mockStripeClient.paymentIntents.retrieve).not.toHaveBeenCalled();
			expect(mockStripeClient.paymentIntents.cancel).not.toHaveBeenCalled();
		});
	});
});
