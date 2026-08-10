/**
 * TAVLI-71 Phase 3B — per-member post-visit tips (ADR 008).
 *
 * Covers the caller-scoped visit summary (`sessions.getVisitSummary`), the
 * tip charge action (`stripe.createTipCharge`: one-tap params with NO
 * application fee, invalid amounts, double-submit reuse, Elements fallback),
 * the webhook halves (`payments.confirmTipPayment` / `failTipPayment`), and
 * the regression that a kind-"tip" payment flows into the tip pool's digital
 * total for the right business date (`convex/tips.ts` unchanged).
 */
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

const mockStripeClient = {
	paymentIntents: {
		create: vi.fn(),
		retrieve: vi.fn(),
		cancel: vi.fn(),
	},
	customers: {
		create: vi.fn(),
	},
	refunds: {
		create: vi.fn(),
	},
	webhooks: {
		constructEvent: vi.fn(),
	},
};

vi.mock("stripe", () => ({
	default: vi.fn(() => mockStripeClient),
}));

const DINER_A = "diner-a-closeout";
const DINER_B = "diner-b-closeout";
const STAFF = "owner-closeout";
const BUSINESS_DATE = "2026-06-21";

/**
 * An active session with two members who each paid their own rounds
 * (pay-at-submit, ADR 008):
 * - DINER_A: two paid orders (1500 + 1000) — the first payment carries the
 *   saved card `pm_a` — plus one cancelled order (999) that must not count.
 * - DINER_B: one paid order (2000) whose payment has NO saved card.
 * DINER_A also has a platform Stripe Customer (`cus_a`).
 */
async function seedVisit(t: ReturnType<typeof convexTest>) {
	let restaurantId: Id<"restaurants">;
	let sessionId: Id<"sessions">;
	let tableId: Id<"tables">;
	let orderA1: Id<"orders">;

	await t.run(async (ctx) => {
		const now = Date.now();
		const organizationId = await ctx.db.insert("organizations", {
			name: "Closeout Org",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		restaurantId = await ctx.db.insert("restaurants", {
			ownerId: STAFF,
			organizationId,
			name: "Closeout Test Restaurant",
			slug: `closeout-test-${Math.random().toString(36).slice(2, 10)}`,
			currency: "USD",
			timezone: "UTC",
			stripeAccountId: "acct_tip",
			stripeOnboardingComplete: true,
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		await ctx.db.insert("userRoles", {
			userId: STAFF,
			roles: ["owner"],
			organizationId,
			createdAt: now,
			updatedAt: now,
		});
		// Manager identity for the tip-pool regression checks.
		await ctx.db.insert("userRoles", {
			userId: "closeout-manager",
			roles: ["manager"],
			organizationId,
			createdAt: now,
			updatedAt: now,
		});
		await ctx.db.insert("restaurantMembers", {
			userId: "closeout-manager",
			restaurantId,
			organizationId,
			role: "manager",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		tableId = await ctx.db.insert("tables", {
			restaurantId,
			tableNumber: 9,
			isActive: true,
			createdAt: now,
		});
		sessionId = await ctx.db.insert("sessions", {
			restaurantId,
			tableId,
			userId: DINER_A,
			memberUserIds: [DINER_B],
			status: "active",
			startedAt: now,
		});

		const makePaidOrder = async (
			paidByUserId: string,
			totalAmount: number,
			status: "submitted" | "served" | "cancelled",
			paymentMethodId?: string
		) => {
			const orderId = await ctx.db.insert("orders", {
				sessionId,
				restaurantId,
				tableId,
				status,
				totalAmount,
				paymentState: "paid",
				settledBy: "stripe",
				paidByUserId,
				orderServiceDateKey: BUSINESS_DATE,
				paidAt: now,
				submittedAt: now,
				createdAt: now,
				updatedAt: now,
			});
			const paymentId = await ctx.db.insert("payments", {
				restaurantId,
				orderId,
				amount: Math.round(totalAmount * 1.12),
				subtotalAmount: totalAmount,
				feeAmount: Math.round(totalAmount * 0.12),
				kind: "order",
				paidByUserId,
				...(paymentMethodId && { stripePaymentMethodId: paymentMethodId }),
				currency: "usd",
				status: "succeeded",
				refundStatus: "none",
				attemptNumber: 1,
				stripePaymentIntentId: `pi_order_${orderId}`,
				succeededAt: now,
				createdAt: now,
				updatedAt: now,
			});
			await ctx.db.patch(orderId, { activePaymentId: paymentId });
			return orderId;
		};

		orderA1 = await makePaidOrder(DINER_A, 1500, "served", "pm_a");
		await makePaidOrder(DINER_A, 1000, "submitted");
		await makePaidOrder(DINER_B, 2000, "served");
		// Cancelled after payment (fully refunded elsewhere) — excluded from the
		// member's tippable total.
		await makePaidOrder(DINER_A, 999, "cancelled");

		await ctx.db.insert("stripeCustomers", {
			userId: DINER_A,
			stripeCustomerId: "cus_a",
			createdAt: now,
			updatedAt: now,
		});
	});

	return {
		restaurantId: restaurantId!,
		sessionId: sessionId!,
		tableId: tableId!,
		orderA1: orderA1!,
		dinerA: t.withIdentity({ subject: DINER_A }),
		dinerB: t.withIdentity({ subject: DINER_B }),
		manager: t.withIdentity({ subject: "closeout-manager" }),
	};
}

/** Inserts an already-succeeded tip payment row (a prior re-tip). */
async function insertSucceededTip(
	t: ReturnType<typeof convexTest>,
	restaurantId: Id<"restaurants">,
	sessionId: Id<"sessions">,
	paidByUserId: string,
	amount: number
) {
	return await t.run(async (ctx) => {
		const now = Date.now();
		return await ctx.db.insert("payments", {
			restaurantId,
			sessionId,
			amount,
			subtotalAmount: 0,
			feeAmount: 0,
			gratuityAmount: amount,
			kind: "tip",
			paidByUserId,
			currency: "usd",
			status: "succeeded",
			refundStatus: "none",
			attemptNumber: 1,
			stripePaymentIntentId: `pi_prior_tip_${Math.random().toString(36).slice(2, 8)}`,
			succeededAt: now,
			createdAt: now,
			updatedAt: now,
		});
	});
}

describe("visit close-out (TAVLI-71 Phase 3B)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.env.STRIPE_SECRET_KEY = "sk_test_123";
	});

	describe("sessions.getVisitSummary", () => {
		it("scopes totals to the caller: each member sees only their own paid rounds", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, dinerA, dinerB } = await seedVisit(t);

			const summaryA = await dinerA.query(api.sessions.getVisitSummary, { sessionId });
			// 1500 + 1000; the cancelled 999 order is excluded.
			expect(summaryA).toMatchObject({
				myPaidTotal: 2500,
				myOrderCount: 2,
				hasSavedCard: true,
				sessionStatus: "active",
				currency: "USD",
				canClose: true,
				closeBlockedReason: null,
			});
			expect(summaryA?.myTipPayments).toEqual([]);

			const summaryB = await dinerB.query(api.sessions.getVisitSummary, { sessionId });
			expect(summaryB).toMatchObject({
				myPaidTotal: 2000,
				myOrderCount: 1,
				// B's payment carries no saved card.
				hasSavedCard: false,
			});
		});

		it("lists the caller's succeeded tip payments (and only theirs)", async () => {
			const t = convexTest(schema, modules);
			const { restaurantId, sessionId, dinerA, dinerB } = await seedVisit(t);
			await insertSucceededTip(t, restaurantId, sessionId, DINER_A, 300);

			const summaryA = await dinerA.query(api.sessions.getVisitSummary, { sessionId });
			expect(summaryA?.myTipPayments.map((p) => p.amount)).toEqual([300]);

			const summaryB = await dinerB.query(api.sessions.getVisitSummary, { sessionId });
			expect(summaryB?.myTipPayments).toEqual([]);
		});

		it("mirrors the close guards: an uncollected cash order blocks the close", async () => {
			const t = convexTest(schema, modules);
			const { restaurantId, sessionId, tableId, dinerA } = await seedVisit(t);

			await t.run(async (ctx) => {
				await ctx.db.insert("orders", {
					sessionId,
					restaurantId,
					tableId,
					status: "awaiting_payment",
					totalAmount: 700,
					paymentState: "unpaid",
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
			});

			const summary = await dinerA.query(api.sessions.getVisitSummary, { sessionId });
			expect(summary?.canClose).toBe(false);
			expect(summary?.closeBlockedReason).toBe("ERROR_SESSION_AWAITING_PAYMENT_ORDERS");
		});

		it("returns null for non-members", async () => {
			const t = convexTest(schema, modules);
			const { sessionId } = await seedVisit(t);

			const stranger = t.withIdentity({ subject: "someone-else" });
			await expect(stranger.query(api.sessions.getVisitSummary, { sessionId })).resolves.toBeNull();
		});
	});

	describe("stripe.createTipCharge", () => {
		it("one-taps the saved card for exactly tipAmount with NO application fee", async () => {
			const t = convexTest(schema, modules);
			const { restaurantId, sessionId, dinerA } = await seedVisit(t);

			mockStripeClient.paymentIntents.create.mockResolvedValueOnce({
				id: "pi_tip_1",
				status: "succeeded",
				client_secret: "pi_secret_tip_1",
			});

			const result = await dinerA.action(api.stripe.createTipCharge, {
				sessionId,
				tipAmount: 2500,
			});
			expect(result.clientSecret).toBeNull();

			const [createArgs, createOptions] = mockStripeClient.paymentIntents.create.mock.calls[0];
			expect(createArgs).toEqual({
				amount: 2500,
				currency: "usd",
				transfer_data: { destination: "acct_tip" },
				on_behalf_of: "acct_tip",
				metadata: {
					kind: "tip",
					sessionId,
					restaurantId,
					paymentId: result.paymentId,
					paidByUserId: DINER_A,
				},
				customer: "cus_a",
				payment_method: "pm_a",
				off_session: true,
				confirm: true,
			});
			// No commission on tips (ADR 008): the fee field must be absent, not 0.
			expect(createArgs).not.toHaveProperty("application_fee_amount");
			expect(createOptions).toEqual({ idempotencyKey: `tip-payment:${result.paymentId}` });

			const payment = await t.run(async (ctx) => ctx.db.get(result.paymentId));
			expect(payment).toMatchObject({
				kind: "tip",
				sessionId,
				amount: 2500,
				subtotalAmount: 0,
				feeAmount: 0,
				gratuityAmount: 2500,
				paidByUserId: DINER_A,
				status: "processing",
				stripePaymentIntentId: "pi_tip_1",
			});
			// Session-scoped: a tip belongs to the visit, not any single order.
			expect(payment?.orderId).toBeUndefined();
		});

		it("rejects zero, negative, and fractional amounts with a stable code", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, dinerA } = await seedVisit(t);

			for (const tipAmount of [0, -100, 12.5]) {
				await expect(
					dinerA.action(api.stripe.createTipCharge, { sessionId, tipAmount })
				).rejects.toThrow(/ERROR_TIP_INVALID_AMOUNT/);
			}
			expect(mockStripeClient.paymentIntents.create).not.toHaveBeenCalled();
		});

		it("hands back the 3DS client secret and reuses the in-flight attempt on re-submit", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, dinerA } = await seedVisit(t);

			mockStripeClient.paymentIntents.create.mockRejectedValueOnce(
				Object.assign(new Error("authentication required"), {
					code: "authentication_required",
					raw: {
						payment_intent: { id: "pi_tip_3ds", client_secret: "pi_secret_tip_3ds" },
					},
				})
			);
			mockStripeClient.paymentIntents.retrieve.mockResolvedValueOnce({
				id: "pi_tip_3ds",
				status: "requires_action",
				client_secret: "pi_secret_tip_3ds",
			});

			const first = await dinerA.action(api.stripe.createTipCharge, {
				sessionId,
				tipAmount: 2500,
			});
			expect(first.clientSecret).toBe("pi_secret_tip_3ds");

			// Double-submit guard: the pending attempt is handed back, not doubled.
			const second = await dinerA.action(api.stripe.createTipCharge, {
				sessionId,
				tipAmount: 2500,
			});
			expect(second.paymentId).toBe(first.paymentId);
			expect(second.clientSecret).toBe("pi_secret_tip_3ds");
			expect(mockStripeClient.paymentIntents.create).toHaveBeenCalledTimes(1);
		});

		it("falls back to an unconfirmed Elements intent when the member has no saved card", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, dinerB } = await seedVisit(t);

			// DINER_B has no platform Customer yet — it is created on first charge.
			mockStripeClient.customers.create.mockResolvedValueOnce({ id: "cus_b" });
			mockStripeClient.paymentIntents.create.mockResolvedValueOnce({
				id: "pi_tip_b",
				status: "requires_payment_method",
				client_secret: "pi_secret_tip_b",
			});

			const result = await dinerB.action(api.stripe.createTipCharge, {
				sessionId,
				tipAmount: 400,
			});
			expect(result.clientSecret).toBe("pi_secret_tip_b");

			const createArgs = mockStripeClient.paymentIntents.create.mock.calls[0][0];
			expect(createArgs.confirm).toBeUndefined();
			expect(createArgs.off_session).toBeUndefined();
			// The card confirmed in the sheet saves for future one-taps.
			expect(createArgs.setup_future_usage).toBe("off_session");
			expect(createArgs.customer).toBe("cus_b");
			expect(createArgs).not.toHaveProperty("application_fee_amount");
		});

		it("re-tipping is allowed: a settled tip does not block a fresh charge", async () => {
			const t = convexTest(schema, modules);
			const { restaurantId, sessionId, dinerA } = await seedVisit(t);
			await insertSucceededTip(t, restaurantId, sessionId, DINER_A, 300);

			mockStripeClient.paymentIntents.create.mockResolvedValueOnce({
				id: "pi_tip_again",
				status: "succeeded",
				client_secret: "pi_secret_again",
			});

			const result = await dinerA.action(api.stripe.createTipCharge, {
				sessionId,
				tipAmount: 500,
			});
			expect(result.clientSecret).toBeNull();
			expect(mockStripeClient.paymentIntents.create).toHaveBeenCalledTimes(1);
		});

		it("rejects strangers and inactive sessions", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, dinerA } = await seedVisit(t);

			const stranger = t.withIdentity({ subject: "someone-else" });
			await expect(
				stranger.action(api.stripe.createTipCharge, { sessionId, tipAmount: 500 })
			).rejects.toMatchObject({ name: "NOT_AUTHORIZED" });

			await t.run(async (ctx) => {
				await ctx.db.patch(sessionId, { status: "closed" });
			});
			await expect(
				dinerA.action(api.stripe.createTipCharge, { sessionId, tipAmount: 500 })
			).rejects.toMatchObject({ name: "NOT_AUTHORIZED" });
		});
	});

	describe("webhook halves (payments.confirmTipPayment / failTipPayment)", () => {
		async function chargeOneTap(seed: Awaited<ReturnType<typeof seedVisit>>) {
			mockStripeClient.paymentIntents.create.mockResolvedValueOnce({
				id: "pi_tip_hook",
				status: "succeeded",
				client_secret: "pi_secret_hook",
			});
			return await seed.dinerA.action(api.stripe.createTipCharge, {
				sessionId: seed.sessionId,
				tipAmount: 2500,
			});
		}

		it("confirm marks the payment succeeded and audits sessions.tipPaid — idempotently", async () => {
			const t = convexTest(schema, modules);
			const seed = await seedVisit(t);
			const { paymentId } = await chargeOneTap(seed);

			await t.mutation(internal.payments.confirmTipPayment, {
				paymentId,
				stripePaymentIntentId: "pi_tip_hook",
				stripeChargeId: "ch_tip_hook",
			});

			const payment = await t.run(async (ctx) => ctx.db.get(paymentId));
			expect(payment).toMatchObject({
				status: "succeeded",
				stripePaymentIntentId: "pi_tip_hook",
				stripeChargeId: "ch_tip_hook",
			});
			expect(payment?.succeededAt).toBeGreaterThan(0);

			// The session is untouched: not closed, and the legacy tab tip field
			// stays unset — per-member tips live on payments rows only.
			const session = await t.run(async (ctx) => ctx.db.get(seed.sessionId));
			expect(session?.status).toBe("active");
			expect(session?.tipAmount).toBeUndefined();

			const tipEvents = await t.run(async (ctx) => {
				const events = await ctx.db.query("allEvents").collect();
				return events.filter((e) => e.eventType === "sessions.tipPaid");
			});
			expect(tipEvents).toHaveLength(1);
			expect(tipEvents[0].payload).toMatchObject({
				paymentId,
				amount: 2500,
				paidByUserId: DINER_A,
			});

			// Replayed delivery: no double audit, status unchanged.
			await t.mutation(internal.payments.confirmTipPayment, {
				paymentId,
				stripePaymentIntentId: "pi_tip_hook",
			});
			const replayedEvents = await t.run(async (ctx) => {
				const events = await ctx.db.query("allEvents").collect();
				return events.filter((e) => e.eventType === "sessions.tipPaid");
			});
			expect(replayedEvents).toHaveLength(1);
		});

		it("failure marks the payment failed so the diner can retry", async () => {
			const t = convexTest(schema, modules);
			const seed = await seedVisit(t);
			const { paymentId } = await chargeOneTap(seed);

			await t.mutation(internal.payments.failTipPayment, {
				paymentId,
				stripePaymentIntentId: "pi_tip_hook",
				failureCode: "card_declined",
				failureMessage: "Your card was declined.",
			});

			const payment = await t.run(async (ctx) => ctx.db.get(paymentId));
			expect(payment).toMatchObject({
				status: "failed",
				failureCode: "card_declined",
				failureMessage: "Your card was declined.",
			});
			expect(payment?.failedAt).toBeGreaterThan(0);
		});
	});

	describe("tip pool regression (convex/tips.ts unchanged)", () => {
		it("a kind-tip payment surfaces in digital tips for the session's business date", async () => {
			const t = convexTest(schema, modules);
			const { restaurantId, sessionId, manager } = await seedVisit(t);
			await insertSucceededTip(t, restaurantId, sessionId, DINER_A, 2500);

			// Recording a cash entry recomputes the pool total for that date.
			const [, err] = await manager.mutation(api.tips.addTipEntry, {
				restaurantId,
				businessDate: BUSINESS_DATE,
				amountCents: 500,
				source: "cash",
			});
			expect(err).toBeNull();

			const [poolResult, poolErr] = await manager.query(api.tips.getTipPoolForDate, {
				restaurantId,
				businessDate: BUSINESS_DATE,
			});
			expect(poolErr).toBeNull();
			const pool = (poolResult as { pool: { totalAmountCents: number } | null }).pool;
			// 2500 digital (the session-scoped tip payment) + 500 cash.
			expect(pool?.totalAmountCents).toBe(3000);
		});

		it("does not leak the tip into a business date the session has no orders on", async () => {
			const t = convexTest(schema, modules);
			const { restaurantId, sessionId, manager } = await seedVisit(t);
			await insertSucceededTip(t, restaurantId, sessionId, DINER_A, 2500);

			const [, err] = await manager.mutation(api.tips.addTipEntry, {
				restaurantId,
				businessDate: "2026-06-25",
				amountCents: 100,
				source: "cash",
			});
			expect(err).toBeNull();

			const [poolResult, poolErr] = await manager.query(api.tips.getTipPoolForDate, {
				restaurantId,
				businessDate: "2026-06-25",
			});
			expect(poolErr).toBeNull();
			const pool = (poolResult as { pool: { totalAmountCents: number } | null }).pool;
			expect(pool?.totalAmountCents).toBe(100);
		});
	});
});
