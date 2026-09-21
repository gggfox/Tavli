/**
 * Lost disputes: the recovery ledger, the new events, and the visibility
 * fan-out (TAVLI-102).
 *
 * The behaviours under test are all "money or silence" ones — a deduction that
 * is too large, a ledger drawn down by a payment that never settled, a return
 * transfer issued twice, a manager told nothing — so every case here is written
 * against the real webhook entry point (`internal.stripe.fulfillPayment`) with
 * the shared Stripe mock, rather than against the mutations directly. The
 * mutations are reachable, but a test that calls them by hand cannot catch the
 * two defects that matter most: an event type that is never routed, and a
 * handler that reads the wrong field off the delivered object.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
	DISPUTE_RECOVERY_WRITE_OFF_MS,
	DISPUTE_RETURN_RESCHEDULE_AFTER_MS,
	OPERATOR_ALERT_KIND,
	OPERATOR_ALERT_SEVERITY,
} from "../constants";
import schema from "../schema";
import { registerDisputeComponents } from "./_fixtures/disputeComponents.fixture";
import { mockStripeClient } from "./_fixtures/stripeMock.fixture";

const modules = import.meta.glob("../**/*.ts");

vi.mock("stripe", async () => (await import("./_fixtures/stripeMock.fixture")).stripeModuleMock());

const OWNER = "owner-dispute";
const ADMIN = "admin-dispute";
const MANAGER = "manager-dispute";
const DINER = "diner-dispute";

/**
 * Loose on purpose, exactly as the other Stripe suites declare it: the helpers
 * below only insert rows. The test bodies keep the concrete instance returned
 * by `newTest`, whose inferred type carries the schema — which is what makes
 * `ctx.db.query(...).withIndex(...)` typecheck inside `t.run`.
 */
type TestConvex = ReturnType<typeof convexTest>;

/** The concrete instance, for helpers that need to READ rows by index. */
type SchemaAwareConvex = ReturnType<typeof newTest>;

/**
 * A restaurant that can take payments, with an owner and a manager who both
 * have an email — so the notification fan-out and the email fan-out both have
 * somebody real to reach.
 */
async function seedRestaurant(
	t: TestConvex,
	options: { disputeRecoveryPercent?: number } = {}
): Promise<Id<"restaurants">> {
	let restaurantId: Id<"restaurants">;
	await t.run(async (ctx) => {
		const organizationId = await ctx.db.insert("organizations", {
			name: "Dispute Org",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		restaurantId = await ctx.db.insert("restaurants", {
			ownerId: OWNER,
			organizationId,
			name: "La Disputa",
			slug: `disputa-${Math.random().toString(36).slice(2, 10)}`,
			currency: "MXN",
			stripeAccountId: "acct_dispute",
			stripeOnboardingComplete: true,
			isActive: true,
			...(options.disputeRecoveryPercent !== undefined && {
				disputeRecoveryPercent: options.disputeRecoveryPercent,
			}),
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		await ctx.db.insert("userRoles", {
			userId: OWNER,
			organizationId,
			roles: ["owner"],
			email: "owner@example.com",
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		await ctx.db.insert("userRoles", {
			userId: ADMIN,
			organizationId,
			roles: ["admin"],
			email: "admin@example.com",
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		await ctx.db.insert("userRoles", {
			userId: MANAGER,
			organizationId,
			roles: ["manager"],
			email: "manager@example.com",
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		await ctx.db.insert("restaurantMembers", {
			restaurantId,
			organizationId,
			userId: MANAGER,
			role: "manager",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});
	return restaurantId!;
}

/** A settled order and the card payment that paid for it. */
async function seedPaidOrder(
	t: TestConvex,
	args: {
		restaurantId: Id<"restaurants">;
		subtotal: number;
		paymentIntentId: string;
		chargeId?: string;
		dailyOrderNumber?: number;
	}
): Promise<{ orderId: Id<"orders">; paymentId: Id<"payments"> }> {
	let orderId: Id<"orders">;
	let paymentId: Id<"payments">;
	await t.run(async (ctx) => {
		const tableId = await ctx.db.insert("tables", {
			restaurantId: args.restaurantId,
			tableNumber: 1,
			isActive: true,
			createdAt: Date.now(),
		});
		const sessionId = await ctx.db.insert("sessions", {
			restaurantId: args.restaurantId,
			tableId,
			userId: DINER,
			status: "active",
			startedAt: Date.now(),
		});
		orderId = await ctx.db.insert("orders", {
			sessionId,
			restaurantId: args.restaurantId,
			tableId,
			status: "submitted",
			totalAmount: args.subtotal,
			paymentState: "paid",
			paidAt: Date.now(),
			submittedAt: Date.now(),
			...(args.dailyOrderNumber !== undefined && { dailyOrderNumber: args.dailyOrderNumber }),
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		paymentId = await ctx.db.insert("payments", {
			restaurantId: args.restaurantId,
			orderId,
			amount: Math.round(args.subtotal * 1.12),
			subtotalAmount: args.subtotal,
			feeAmount: Math.round(args.subtotal * 0.12),
			kind: "order",
			currency: "mxn",
			status: "succeeded",
			refundStatus: "none",
			attemptNumber: 1,
			stripePaymentIntentId: args.paymentIntentId,
			stripeChargeId: args.chargeId ?? "ch_dispute",
			succeededAt: Date.now(),
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});
	return { orderId: orderId!, paymentId: paymentId! };
}

/** A `charge.dispute.*` event as Stripe delivers it. */
function disputeEvent(args: {
	eventId: string;
	type:
		| "charge.dispute.created"
		| "charge.dispute.updated"
		| "charge.dispute.closed"
		| "charge.dispute.funds_reinstated";
	disputeId: string;
	paymentIntentId: string;
	status: string;
	amount: number;
	reason?: string;
	created?: number;
	/** `balance_transactions` as Stripe expands them on the dispute. */
	fee?: number;
	feeCreated?: number;
}) {
	return {
		id: args.eventId,
		type: args.type,
		created: args.created ?? 1_700_000_000,
		data: {
			object: {
				id: args.disputeId,
				charge: "ch_dispute",
				payment_intent: args.paymentIntentId,
				amount: args.amount,
				currency: "mxn",
				reason: args.reason ?? "fraudulent",
				status: args.status,
				created: 1_699_999_000,
				...(args.fee !== undefined && {
					balance_transactions: [{ fee: args.fee, created: args.feeCreated ?? 1_700_000_000 }],
				}),
			},
		},
	};
}

/** Deliver one event through the real webhook action. */
async function deliver(t: TestConvex, event: ReturnType<typeof disputeEvent>) {
	mockStripeClient.webhooks.constructEvent.mockReturnValueOnce(event);
	await t.action(internal.stripe.fulfillPayment, {
		payloadString: "{}",
		signatureHeader: "sig",
	});
}

function newTest() {
	const t = convexTest(schema, modules);
	registerDisputeComponents(t);
	return t;
}

beforeEach(() => {
	vi.clearAllMocks();
	process.env.STRIPE_SECRET_KEY = "sk_test_dispute";
	process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
	// The dispute log is deliberately `console.error`; silence it so a passing
	// run is readable, and so an unexpected error still stands out elsewhere.
	vi.spyOn(console, "error").mockImplementation(() => {});
	vi.spyOn(console, "warn").mockImplementation(() => {});
	// Every dispute handler resolves the fee. Unstubbed it throws, which the
	// handler swallows — stubbing it keeps the intent of each test explicit.
	mockStripeClient.disputes.retrieve.mockResolvedValue({ balance_transactions: [] });
	// Every phase schedules one email per recipient and a win schedules the
	// return transfer. Fake timers are what let a test drain those deterministically
	// with `t.finishAllScheduledFunctions`, instead of leaving convex-test to run
	// them after the assertions (which surfaces as "Write outside of transaction").
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

/** Run everything the mutations scheduled: the emails, and any return transfer. */
async function drainScheduled(t: TestConvex): Promise<void> {
	await t.finishAllScheduledFunctions(() => vi.runAllTimers());
}

describe("charge.dispute.* event coverage", () => {
	it("records every phase, including the two this ticket adds", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t);
		await seedPaidOrder(t, { restaurantId, subtotal: 50_000, paymentIntentId: "pi_phases" });

		await deliver(
			t,
			disputeEvent({
				eventId: "evt_created",
				type: "charge.dispute.created",
				disputeId: "dp_phases",
				paymentIntentId: "pi_phases",
				status: "needs_response",
				amount: 50_000,
			})
		);
		await deliver(
			t,
			disputeEvent({
				eventId: "evt_updated",
				type: "charge.dispute.updated",
				disputeId: "dp_phases",
				paymentIntentId: "pi_phases",
				status: "under_review",
				amount: 50_000,
				created: 1_700_100_000,
			})
		);
		await deliver(
			t,
			disputeEvent({
				eventId: "evt_closed",
				type: "charge.dispute.closed",
				disputeId: "dp_phases",
				paymentIntentId: "pi_phases",
				status: "lost",
				amount: 50_000,
				created: 1_700_200_000,
			})
		);
		await deliver(
			t,
			disputeEvent({
				eventId: "evt_reinstated",
				type: "charge.dispute.funds_reinstated",
				disputeId: "dp_phases",
				paymentIntentId: "pi_phases",
				status: "won",
				amount: 50_000,
				created: 1_700_300_000,
			})
		);

		const dispute = await t.run(async (ctx) =>
			ctx.db
				.query("stripeDisputes")
				.withIndex("by_dispute_id", (q) => q.eq("stripeDisputeId", "dp_phases"))
				.first()
		);
		expect(dispute?.openedAt).toBe(1_700_000_000_000);
		expect(dispute?.closedAt).toBe(1_700_200_000_000);
		expect(dispute?.reinstatedAt).toBe(1_700_300_000_000);

		// One row per dispute id, never one per delivery.
		const all = await t.run(async (ctx) => ctx.db.query("stripeDisputes").collect());
		expect(all).toHaveLength(1);

		const auditTypes = await t.run(async (ctx) =>
			(await ctx.db.query("allEvents").collect()).map((row) => row.eventType)
		);
		expect(auditTypes).toContain("payments.disputeOpened");
		expect(auditTypes).toContain("payments.disputeUpdated");
		expect(auditTypes).toContain("payments.disputeClosed");
		expect(auditTypes).toContain("payments.disputeFundsReinstated");
	});

	it("opens the ledger for a loss that arrives as `updated`, not `closed`", async () => {
		// Stripe's delivery order is not guaranteed and the two event types
		// overlap. Keying the money off the event NAME would miss this loss.
		const t = newTest();
		const restaurantId = await seedRestaurant(t, { disputeRecoveryPercent: 20 });
		await seedPaidOrder(t, { restaurantId, subtotal: 40_000, paymentIntentId: "pi_updlost" });

		await deliver(
			t,
			disputeEvent({
				eventId: "evt_updated_lost",
				type: "charge.dispute.updated",
				disputeId: "dp_updlost",
				paymentIntentId: "pi_updlost",
				status: "lost",
				amount: 40_000,
			})
		);

		const ledger = await t.run(async (ctx) => ctx.db.query("disputeRecoveries").collect());
		expect(ledger).toHaveLength(1);
		expect(ledger[0]).toMatchObject({ amount: 40_000, outstanding: 40_000, recovered: 0 });
	});
});

describe("the recovery ledger", () => {
	it("opens exactly one row for a lost dispute, for the disputed amount only", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t, { disputeRecoveryPercent: 25 });
		await seedPaidOrder(t, { restaurantId, subtotal: 30_000, paymentIntentId: "pi_lost" });

		await deliver(
			t,
			disputeEvent({
				eventId: "evt_lost_1",
				type: "charge.dispute.closed",
				disputeId: "dp_lost",
				paymentIntentId: "pi_lost",
				status: "lost",
				amount: 30_000,
				// The fee is Tavli's to absorb and must NOT reach the ledger.
				fee: 40_000,
			})
		);
		// A redelivered close, and a following `updated` that still says lost.
		await deliver(
			t,
			disputeEvent({
				eventId: "evt_lost_2",
				type: "charge.dispute.updated",
				disputeId: "dp_lost",
				paymentIntentId: "pi_lost",
				status: "lost",
				amount: 30_000,
			})
		);

		const ledger = await t.run(async (ctx) => ctx.db.query("disputeRecoveries").collect());
		expect(ledger).toHaveLength(1);
		expect(ledger[0].amount).toBe(30_000);
		expect(ledger[0].outstanding).toBe(30_000);
		expect(ledger[0].status).toBe("outstanding");

		const dispute = await t.run(async (ctx) =>
			ctx.db
				.query("stripeDisputes")
				.withIndex("by_dispute_id", (q) => q.eq("stripeDisputeId", "dp_lost"))
				.first()
		);
		expect(dispute?.disputeFeeAmount).toBe(40_000);
	});

	it("records no ledger row when the charge is not one of ours, but still alerts", async () => {
		// Dev and staging share one Stripe test account, so a dispute on a charge
		// nobody claims is normal — and is exactly the case an operator would
		// otherwise never see.
		const t = newTest();
		await seedRestaurant(t);

		await deliver(
			t,
			disputeEvent({
				eventId: "evt_orphan",
				type: "charge.dispute.closed",
				disputeId: "dp_orphan",
				paymentIntentId: "pi_not_ours",
				status: "lost",
				amount: 12_000,
			})
		);

		const ledger = await t.run(async (ctx) => ctx.db.query("disputeRecoveries").collect());
		expect(ledger).toHaveLength(0);

		const alerts = await t.run(async (ctx) => ctx.db.query("operatorAlerts").collect());
		expect(alerts).toHaveLength(1);
		expect(alerts[0]).toMatchObject({
			kind: OPERATOR_ALERT_KIND.DISPUTE_LOST,
			severity: OPERATOR_ALERT_SEVERITY.SEVERE,
		});
	});
});

describe("the deduction on the next order", () => {
	/** A draft order the diner can pay for. */
	async function seedDraftOrder(
		t: TestConvex,
		args: { restaurantId: Id<"restaurants">; totalAmount: number }
	) {
		let orderId: Id<"orders">;
		await t.run(async (ctx) => {
			const tableId = await ctx.db.insert("tables", {
				restaurantId: args.restaurantId,
				tableNumber: 2,
				isActive: true,
				createdAt: Date.now(),
			});
			const sessionId = await ctx.db.insert("sessions", {
				restaurantId: args.restaurantId,
				tableId,
				userId: DINER,
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

			// `orders.confirmPayment` refuses an order with no items, so the
			// settle half of these tests needs real menu scaffolding.
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
				basePrice: args.totalAmount,
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
				unitPrice: args.totalAmount,
				selectedOptions: [],
				lineTotal: args.totalAmount,
				createdAt: Date.now(),
			});
		});
		return { orderId: orderId!, diner: t.withIdentity({ subject: DINER }) };
	}

	/** Open a ledger row directly — the loss itself is covered above. */
	async function seedLedgerRow(
		t: TestConvex,
		args: { restaurantId: Id<"restaurants">; disputeId: string; amount: number; lostAt: number }
	): Promise<Id<"disputeRecoveries">> {
		let id: Id<"disputeRecoveries">;
		await t.run(async (ctx) => {
			id = await ctx.db.insert("disputeRecoveries", {
				restaurantId: args.restaurantId,
				stripeDisputeId: args.disputeId,
				amount: args.amount,
				outstanding: args.amount,
				recovered: 0,
				currency: "mxn",
				status: "outstanding",
				lostAt: args.lostAt,
				createdAt: args.lostAt,
				updatedAt: args.lostAt,
			});
		});
		return id!;
	}

	it("withholds nothing when the restaurant has no recovery configured", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t);
		await seedLedgerRow(t, {
			restaurantId,
			disputeId: "dp_off",
			amount: 90_000,
			lostAt: Date.now() - 1000,
		});
		const { orderId, diner } = await seedDraftOrder(t, { restaurantId, totalAmount: 10_000 });

		mockStripeClient.customers.create.mockResolvedValueOnce({ id: "cus_off" });
		mockStripeClient.paymentIntents.create.mockResolvedValueOnce({
			id: "pi_off",
			client_secret: "cs_off",
		});

		await diner.action(api.stripe.createPaymentIntent, { orderId });

		const [intentArgs] = mockStripeClient.paymentIntents.create.mock.calls[0];
		// Exactly what Stripe would have transferred with no `amount` at all.
		expect(intentArgs.transfer_data).toEqual({ destination: "acct_dispute", amount: 10_000 });
		expect(intentArgs.amount).toBe(11_200);
	});

	it("shortens the transfer by the capped percentage and leaves the diner's charge alone", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t, { disputeRecoveryPercent: 20 });
		await seedLedgerRow(t, {
			restaurantId,
			disputeId: "dp_deduct",
			amount: 90_000,
			lostAt: Date.now() - 1000,
		});
		const { orderId, diner } = await seedDraftOrder(t, { restaurantId, totalAmount: 10_000 });

		mockStripeClient.customers.create.mockResolvedValueOnce({ id: "cus_deduct" });
		mockStripeClient.paymentIntents.create.mockResolvedValueOnce({
			id: "pi_deduct",
			client_secret: "cs_deduct",
		});

		const result = await diner.action(api.stripe.createPaymentIntent, { orderId });

		const [intentArgs] = mockStripeClient.paymentIntents.create.mock.calls[0];
		expect(intentArgs.transfer_data).toEqual({ destination: "acct_dispute", amount: 8_000 });
		// The diner pays subtotal + the 12% service fee, exactly as before.
		expect(intentArgs.amount).toBe(11_200);
		expect(intentArgs.application_fee_amount).toBe(1_200);
		expect(intentArgs.metadata.disputeRecoveryAmount).toBe("2000");

		const payment = await t.run(async (ctx) => ctx.db.get(result.paymentId));
		expect(payment?.disputeRecoveryAmount).toBe(2_000);
		expect(payment?.disputeRecoveryIds).toHaveLength(1);
		// Priced, not yet applied — the charge has not settled.
		expect(payment?.disputeRecoveryAppliedAt).toBeUndefined();
	});

	it("never withholds more than is outstanding", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t, { disputeRecoveryPercent: 50 });
		await seedLedgerRow(t, {
			restaurantId,
			disputeId: "dp_small",
			amount: 300,
			lostAt: Date.now() - 1000,
		});
		const { orderId, diner } = await seedDraftOrder(t, { restaurantId, totalAmount: 10_000 });

		mockStripeClient.customers.create.mockResolvedValueOnce({ id: "cus_small" });
		mockStripeClient.paymentIntents.create.mockResolvedValueOnce({
			id: "pi_small",
			client_secret: "cs_small",
		});

		await diner.action(api.stripe.createPaymentIntent, { orderId });

		const [intentArgs] = mockStripeClient.paymentIntents.create.mock.calls[0];
		expect(intentArgs.transfer_data.amount).toBe(9_700);
	});

	it("draws the ledger down only once the payment settles, oldest loss first", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t, { disputeRecoveryPercent: 50 });
		const older = await seedLedgerRow(t, {
			restaurantId,
			disputeId: "dp_older",
			amount: 1_000,
			lostAt: 1_000,
		});
		const newer = await seedLedgerRow(t, {
			restaurantId,
			disputeId: "dp_newer",
			amount: 9_000,
			lostAt: 2_000,
		});
		const { orderId, diner } = await seedDraftOrder(t, { restaurantId, totalAmount: 10_000 });

		mockStripeClient.customers.create.mockResolvedValueOnce({ id: "cus_draw" });
		mockStripeClient.paymentIntents.create.mockResolvedValueOnce({
			id: "pi_draw",
			client_secret: "cs_draw",
		});
		const { paymentId } = await diner.action(api.stripe.createPaymentIntent, { orderId });

		// Priced at 5,000 but nothing drawn: the charge has not settled.
		expect(await t.run(async (ctx) => (await ctx.db.get(older))?.outstanding)).toBe(1_000);

		mockStripeClient.webhooks.constructEvent.mockReturnValueOnce({
			id: "evt_draw",
			type: "payment_intent.succeeded",
			created: 1_700_000_000,
			data: { object: { id: "pi_draw", latest_charge: "ch_draw", metadata: {} } },
		});
		await t.action(internal.stripe.fulfillPayment, {
			payloadString: "{}",
			signatureHeader: "sig",
		});

		const olderRow = await t.run(async (ctx) => ctx.db.get(older));
		const newerRow = await t.run(async (ctx) => ctx.db.get(newer));
		// 5,000 withheld: the older 1,000 in full, then 4,000 off the newer row.
		expect(olderRow).toMatchObject({ outstanding: 0, recovered: 1_000, status: "recovered" });
		expect(newerRow).toMatchObject({ outstanding: 5_000, recovered: 4_000, status: "outstanding" });

		const payment = await t.run(async (ctx) => ctx.db.get(paymentId));
		expect(payment?.disputeRecoveryAppliedAt).toBeDefined();
	});

	it("draws nothing when the payment fails", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t, { disputeRecoveryPercent: 50 });
		const row = await seedLedgerRow(t, {
			restaurantId,
			disputeId: "dp_failed",
			amount: 8_000,
			lostAt: 1_000,
		});
		const { orderId, diner } = await seedDraftOrder(t, { restaurantId, totalAmount: 10_000 });

		mockStripeClient.customers.create.mockResolvedValueOnce({ id: "cus_failed" });
		mockStripeClient.paymentIntents.create.mockResolvedValueOnce({
			id: "pi_failed",
			client_secret: "cs_failed",
		});
		await diner.action(api.stripe.createPaymentIntent, { orderId });

		mockStripeClient.webhooks.constructEvent.mockReturnValueOnce({
			id: "evt_failed",
			type: "payment_intent.payment_failed",
			created: 1_700_000_000,
			data: {
				object: { id: "pi_failed", last_payment_error: { code: "card_declined" }, metadata: {} },
			},
		});
		await t.action(internal.stripe.fulfillPayment, {
			payloadString: "{}",
			signatureHeader: "sig",
		});

		// No money moved, so the debt stands in full.
		expect(await t.run(async (ctx) => (await ctx.db.get(row))?.outstanding)).toBe(8_000);
	});

	it("does not draw the ledger down twice for one payment", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t, { disputeRecoveryPercent: 50 });
		const row = await seedLedgerRow(t, {
			restaurantId,
			disputeId: "dp_once",
			amount: 8_000,
			lostAt: 1_000,
		});
		const { orderId, diner } = await seedDraftOrder(t, { restaurantId, totalAmount: 10_000 });

		mockStripeClient.customers.create.mockResolvedValueOnce({ id: "cus_once" });
		mockStripeClient.paymentIntents.create.mockResolvedValueOnce({
			id: "pi_once",
			client_secret: "cs_once",
		});
		const { paymentId } = await diner.action(api.stripe.createPaymentIntent, { orderId });

		await t.mutation(internal.disputes.applyDisputeRecoveryOnSettleInternal, { paymentId });
		await t.mutation(internal.disputes.applyDisputeRecoveryOnSettleInternal, { paymentId });

		// The payment is still `processing`, so neither call may touch the ledger.
		expect(await t.run(async (ctx) => (await ctx.db.get(row))?.outstanding)).toBe(8_000);

		await t.run(async (ctx) => {
			await ctx.db.patch(paymentId, { status: "succeeded" });
		});
		await t.mutation(internal.disputes.applyDisputeRecoveryOnSettleInternal, { paymentId });
		await t.mutation(internal.disputes.applyDisputeRecoveryOnSettleInternal, { paymentId });

		expect(await t.run(async (ctx) => (await ctx.db.get(row))?.outstanding)).toBe(3_000);
	});
});

describe("what the ledger could not absorb (review round 1)", () => {
	/** A draft order plus a priced intent, reusing the deduction helpers above. */
	async function priceAnIntent(
		t: SchemaAwareConvex,
		args: { restaurantId: Id<"restaurants">; total: number; intentId: string }
	) {
		let orderId: Id<"orders">;
		await t.run(async (ctx) => {
			const tableId = await ctx.db.insert("tables", {
				restaurantId: args.restaurantId,
				tableNumber: 9,
				isActive: true,
				createdAt: Date.now(),
			});
			const sessionId = await ctx.db.insert("sessions", {
				restaurantId: args.restaurantId,
				tableId,
				userId: DINER,
				status: "active",
				startedAt: Date.now(),
			});
			orderId = await ctx.db.insert("orders", {
				sessionId,
				restaurantId: args.restaurantId,
				tableId,
				status: "draft",
				totalAmount: args.total,
				paymentState: "unpaid",
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		mockStripeClient.customers.create.mockResolvedValueOnce({ id: `cus_${args.intentId}` });
		mockStripeClient.paymentIntents.create.mockResolvedValueOnce({
			id: args.intentId,
			client_secret: `cs_${args.intentId}`,
		});
		const diner = t.withIdentity({ subject: DINER });
		const { paymentId } = await diner.action(api.stripe.createPaymentIntent, {
			orderId: orderId!,
		});
		return paymentId;
	}

	async function seedLedgerRow(
		t: SchemaAwareConvex,
		args: { restaurantId: Id<"restaurants">; disputeId: string; amount: number; lostAt: number }
	): Promise<Id<"disputeRecoveries">> {
		let id: Id<"disputeRecoveries">;
		await t.run(async (ctx) => {
			id = await ctx.db.insert("disputeRecoveries", {
				restaurantId: args.restaurantId,
				stripeDisputeId: args.disputeId,
				amount: args.amount,
				outstanding: args.amount,
				recovered: 0,
				currency: "mxn",
				status: "outstanding",
				lostAt: args.lostAt,
				createdAt: args.lostAt,
				updatedAt: args.lostAt,
			});
		});
		return id!;
	}

	it("transfers back what a reinstatement between pricing and settlement stranded", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t, { disputeRecoveryPercent: 50 });
		const row = await seedLedgerRow(t, {
			restaurantId,
			disputeId: "dp_stranded",
			amount: 5_000,
			lostAt: 1_000,
		});
		const paymentId = await priceAnIntent(t, {
			restaurantId,
			total: 10_000,
			intentId: "pi_stranded",
		});
		// Stripe has already withheld 5,000 from the transfer.
		expect(await t.run(async (ctx) => (await ctx.db.get(paymentId))?.disputeRecoveryAmount)).toBe(
			5_000
		);

		// The dispute is won before the charge settles: the ledger has nothing
		// left to draw, but the money is off the transfer regardless.
		await t.run(async (ctx) => {
			await ctx.db.patch(row, { outstanding: 0, status: "reinstated", reinstatedAt: Date.now() });
			await ctx.db.patch(paymentId, { status: "succeeded" });
		});

		mockStripeClient.transfers.create.mockResolvedValue({ id: "tr_shortfall" });
		await t.mutation(internal.disputes.applyDisputeRecoveryOnSettleInternal, { paymentId });
		await drainScheduled(t);

		const payment = await t.run(async (ctx) => ctx.db.get(paymentId));
		expect(payment?.disputeRecoveryShortfall).toBe(5_000);
		// Corrected to what was actually kept, so the exports do not report a
		// recovery that never happened.
		expect(payment?.disputeRecoveryAmount).toBe(0);
		expect(payment?.disputeRecoveryShortfallTransferId).toBe("tr_shortfall");

		expect(mockStripeClient.transfers.create).toHaveBeenCalledWith(
			expect.objectContaining({ amount: 5_000, destination: "acct_dispute" }),
			{ idempotencyKey: `dispute-recovery-shortfall:${paymentId}` }
		);
	});

	it("returns the overlap when two intents were priced against the same remainder", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t, { disputeRecoveryPercent: 50 });
		await seedLedgerRow(t, {
			restaurantId,
			disputeId: "dp_shared",
			amount: 5_000,
			lostAt: 1_000,
		});

		// Both orders are priced while the ledger still shows 5,000 outstanding,
		// so each withholds the full 5,000 cap.
		const first = await priceAnIntent(t, { restaurantId, total: 10_000, intentId: "pi_one" });
		const second = await priceAnIntent(t, { restaurantId, total: 10_000, intentId: "pi_two" });

		mockStripeClient.transfers.create.mockResolvedValue({ id: "tr_overlap" });
		await t.run(async (ctx) => {
			await ctx.db.patch(first, { status: "succeeded" });
			await ctx.db.patch(second, { status: "succeeded" });
		});
		await t.mutation(internal.disputes.applyDisputeRecoveryOnSettleInternal, { paymentId: first });
		await t.mutation(internal.disputes.applyDisputeRecoveryOnSettleInternal, { paymentId: second });
		await drainScheduled(t);

		// The first clears the debt; the second recovers nothing and hands its
		// whole withholding back rather than leaving it on the platform balance.
		expect(await t.run(async (ctx) => (await ctx.db.get(first))?.disputeRecoveryAmount)).toBe(
			5_000
		);
		const secondPayment = await t.run(async (ctx) => ctx.db.get(second));
		expect(secondPayment?.disputeRecoveryAmount).toBe(0);
		expect(secondPayment?.disputeRecoveryShortfall).toBe(5_000);
		expect(mockStripeClient.transfers.create).toHaveBeenCalledTimes(1);
	});
});

describe("refunding a payment that repaid a dispute (review round 1)", () => {
	/** A settled payment that drew 2,000 off one ledger row. */
	async function seedDrawnDownPayment(t: SchemaAwareConvex, restaurantId: Id<"restaurants">) {
		const { paymentId } = await seedPaidOrder(t, {
			restaurantId,
			subtotal: 10_000,
			paymentIntentId: "pi_refund_ledger",
		});
		let recoveryId: Id<"disputeRecoveries">;
		await t.run(async (ctx) => {
			recoveryId = await ctx.db.insert("disputeRecoveries", {
				restaurantId,
				stripeDisputeId: "dp_refund_ledger",
				amount: 5_000,
				outstanding: 3_000,
				recovered: 2_000,
				currency: "mxn",
				status: "outstanding",
				lostAt: 1_000,
				createdAt: 1_000,
				updatedAt: 1_000,
			});
			await ctx.db.patch(paymentId, {
				disputeRecoveryAmount: 2_000,
				disputeRecoveryAppliedAt: Date.now(),
				disputeRecoveryLegs: [{ recoveryId: recoveryId!, amount: 2_000 }],
			});
		});
		return { paymentId, recoveryId: recoveryId! };
	}

	it("gives the whole debt back on a full refund", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t);
		const { paymentId, recoveryId } = await seedDrawnDownPayment(t, restaurantId);

		// `payment.amount` is 11,200 (10,000 + 12%).
		await t.mutation(internal.stripeHelpers.recordChargeRefund, {
			paymentId,
			amountRefunded: 11_200,
			amountCaptured: 11_200,
			isFullyRefunded: true,
		});

		// Stripe returned the diner's whole charge from the PLATFORM balance and
		// reversed only the already-shortened transfer, so Tavli recovered
		// nothing and the debt has to stand again.
		const row = await t.run(async (ctx) => ctx.db.get(recoveryId));
		expect(row).toMatchObject({ outstanding: 5_000, recovered: 0, status: "outstanding" });
		expect(await t.run(async (ctx) => (await ctx.db.get(paymentId))?.disputeRecoveryRestored)).toBe(
			2_000
		);
	});

	it("gives back only the refunded share when one line is removed", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t);
		const { paymentId, recoveryId } = await seedDrawnDownPayment(t, restaurantId);

		// A quarter of the charge comes back: 2,800 of 11,200.
		await t.mutation(internal.stripeHelpers.recordChargeRefund, {
			paymentId,
			amountRefunded: 2_800,
			amountCaptured: 11_200,
			isFullyRefunded: false,
		});

		const row = await t.run(async (ctx) => ctx.db.get(recoveryId));
		expect(row?.recovered).toBe(1_500);
		expect(row?.outstanding).toBe(3_500);
	});

	it("does not compound when a partial refund is followed by the rest", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t);
		const { paymentId, recoveryId } = await seedDrawnDownPayment(t, restaurantId);

		await t.mutation(internal.stripeHelpers.recordChargeRefund, {
			paymentId,
			amountRefunded: 2_800,
			amountCaptured: 11_200,
			isFullyRefunded: false,
		});
		await t.mutation(internal.stripeHelpers.recordChargeRefund, {
			paymentId,
			amountRefunded: 11_200,
			amountCaptured: 11_200,
			isFullyRefunded: true,
		});
		// And a redelivery of the same full refund.
		await t.mutation(internal.stripeHelpers.recordChargeRefund, {
			paymentId,
			amountRefunded: 11_200,
			amountCaptured: 11_200,
			isFullyRefunded: true,
		});

		const row = await t.run(async (ctx) => ctx.db.get(recoveryId));
		expect(row?.recovered).toBe(0);
		expect(row?.outstanding).toBe(5_000);
	});

	it("leaves a reinstated row alone — its money was already returned", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t);
		const { paymentId, recoveryId } = await seedDrawnDownPayment(t, restaurantId);
		await t.run(async (ctx) => {
			await ctx.db.patch(recoveryId, {
				outstanding: 0,
				status: "reinstated",
				reinstatedAt: Date.now(),
			});
		});

		await t.mutation(internal.stripeHelpers.recordChargeRefund, {
			paymentId,
			amountRefunded: 11_200,
			amountCaptured: 11_200,
			isFullyRefunded: true,
		});

		const row = await t.run(async (ctx) => ctx.db.get(recoveryId));
		expect(row?.outstanding).toBe(0);
		expect(row?.status).toBe("reinstated");
	});
});

describe("a refund after the money was already transferred out (review round 2)", () => {
	/**
	 * A settled payment that drew 2,000 off one row, where that row was then
	 * reinstated and its recovery paid back to the restaurant on a transfer of
	 * its own. The refund below reverses the CHARGE's transfer and nothing else.
	 */
	async function seedReturnedThenRefundable(t: SchemaAwareConvex, restaurantId: Id<"restaurants">) {
		const { paymentId } = await seedPaidOrder(t, {
			restaurantId,
			subtotal: 10_000,
			paymentIntentId: "pi_clawback",
		});
		let recoveryId: Id<"disputeRecoveries">;
		await t.run(async (ctx) => {
			recoveryId = await ctx.db.insert("disputeRecoveries", {
				restaurantId,
				stripeDisputeId: "dp_clawback",
				amount: 5_000,
				outstanding: 0,
				recovered: 2_000,
				currency: "mxn",
				status: "reinstated",
				lostAt: 1_000,
				reinstatedAt: 2_000,
				returnedAt: 3_000,
				returnedAmount: 2_000,
				stripeTransferId: "tr_returned",
				createdAt: 1_000,
				updatedAt: 3_000,
			});
			await ctx.db.patch(paymentId, {
				disputeRecoveryAmount: 2_000,
				disputeRecoveryAppliedAt: 2_500,
				disputeRecoveryLegs: [{ recoveryId: recoveryId!, amount: 2_000 }],
			});
		});
		return { paymentId, recoveryId: recoveryId! };
	}

	it("claws the returned money back when the sale is refunded in full", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t);
		const { paymentId } = await seedReturnedThenRefundable(t, restaurantId);

		mockStripeClient.transfers.createReversal.mockResolvedValue({ id: "trr_clawback" });
		await t.mutation(internal.stripeHelpers.recordChargeRefund, {
			paymentId,
			amountRefunded: 11_200,
			amountCaptured: 11_200,
			isFullyRefunded: true,
		});
		await drainScheduled(t);

		// Without this the restaurant nets +2,000 on a sale Tavli refunded in
		// full out of its own balance, silently and every time.
		expect(mockStripeClient.transfers.createReversal).toHaveBeenCalledWith(
			"tr_returned",
			expect.objectContaining({ amount: 2_000 }),
			{ idempotencyKey: `dispute-return-reversal:${paymentId}:tr_returned:2000` }
		);
		const payment = await t.run(async (ctx) => ctx.db.get(paymentId));
		expect(payment?.disputeReturnReversals).toEqual([
			{ stripeTransferId: "tr_returned", amount: 2_000 },
		]);
	});

	it("reverses only the difference across partial, full and redelivered refunds", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t);
		const { paymentId } = await seedReturnedThenRefundable(t, restaurantId);

		mockStripeClient.transfers.createReversal.mockResolvedValue({ id: "trr_step" });

		// A quarter of the charge: 2,800 of 11,200 → 500 of the 2,000.
		await t.mutation(internal.stripeHelpers.recordChargeRefund, {
			paymentId,
			amountRefunded: 2_800,
			amountCaptured: 11_200,
			isFullyRefunded: false,
		});
		await drainScheduled(t);
		expect(mockStripeClient.transfers.createReversal).toHaveBeenLastCalledWith(
			"tr_returned",
			expect.objectContaining({ amount: 500 }),
			{ idempotencyKey: `dispute-return-reversal:${paymentId}:tr_returned:500` }
		);

		// Then the rest: only the remaining 1,500 may be reversed.
		await t.mutation(internal.stripeHelpers.recordChargeRefund, {
			paymentId,
			amountRefunded: 11_200,
			amountCaptured: 11_200,
			isFullyRefunded: true,
		});
		await drainScheduled(t);
		expect(mockStripeClient.transfers.createReversal).toHaveBeenLastCalledWith(
			"tr_returned",
			expect.objectContaining({ amount: 1_500 }),
			{ idempotencyKey: `dispute-return-reversal:${paymentId}:tr_returned:2000` }
		);

		// A redelivery of the same full refund reverses nothing further.
		const callsBefore = mockStripeClient.transfers.createReversal.mock.calls.length;
		await t.mutation(internal.stripeHelpers.recordChargeRefund, {
			paymentId,
			amountRefunded: 11_200,
			amountCaptured: 11_200,
			isFullyRefunded: true,
		});
		await drainScheduled(t);
		expect(mockStripeClient.transfers.createReversal.mock.calls.length).toBe(callsBefore);

		const payment = await t.run(async (ctx) => ctx.db.get(paymentId));
		expect(payment?.disputeReturnReversals).toEqual([
			{ stripeTransferId: "tr_returned", amount: 2_000 },
		]);
	});

	it("claws back a shortfall transfer too", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t);
		const { paymentId } = await seedPaidOrder(t, {
			restaurantId,
			subtotal: 10_000,
			paymentIntentId: "pi_shortfall_refund",
		});
		await t.run(async (ctx) => {
			const recoveryId = await ctx.db.insert("disputeRecoveries", {
				restaurantId,
				stripeDisputeId: "dp_shortfall_refund",
				amount: 5_000,
				outstanding: 4_000,
				recovered: 1_000,
				currency: "mxn",
				status: "outstanding",
				lostAt: 1_000,
				createdAt: 1_000,
				updatedAt: 1_000,
			});
			await ctx.db.patch(paymentId, {
				disputeRecoveryAmount: 1_000,
				disputeRecoveryAppliedAt: 2_000,
				disputeRecoveryLegs: [{ recoveryId, amount: 1_000 }],
				disputeRecoveryShortfall: 1_000,
				disputeRecoveryShortfallTransferId: "tr_shortfall_out",
				disputeRecoveryShortfallReturnedAt: 2_100,
			});
		});

		mockStripeClient.transfers.createReversal.mockResolvedValue({ id: "trr_shortfall" });
		await t.mutation(internal.stripeHelpers.recordChargeRefund, {
			paymentId,
			amountRefunded: 11_200,
			amountCaptured: 11_200,
			isFullyRefunded: true,
		});
		await drainScheduled(t);

		expect(mockStripeClient.transfers.createReversal).toHaveBeenCalledWith(
			"tr_shortfall_out",
			expect.objectContaining({ amount: 1_000 }),
			{ idempotencyKey: `dispute-return-reversal:${paymentId}:tr_shortfall_out:1000` }
		);
	});

	it("raises a severe alert when the claw-back fails — usually an empty balance", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t);
		const { paymentId } = await seedReturnedThenRefundable(t, restaurantId);

		mockStripeClient.transfers.createReversal.mockRejectedValue(new Error("balance_insufficient"));
		await t.mutation(internal.stripeHelpers.recordChargeRefund, {
			paymentId,
			amountRefunded: 11_200,
			amountCaptured: 11_200,
			isFullyRefunded: true,
		});
		await drainScheduled(t);

		const alerts = await t.run(async (ctx) => ctx.db.query("operatorAlerts").collect());
		expect(
			alerts.some((a) => a.dedupeKey === `dispute_return_reversal_failed:${paymentId}:tr_returned`)
		).toBe(true);
		// Nothing recorded as reversed, so a later attempt still targets 2,000.
		const payment = await t.run(async (ctx) => ctx.db.get(paymentId));
		expect(payment?.disputeReturnReversals ?? []).toEqual([]);
	});

	it("trims a pending return instead of reversing a transfer that never happened", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t);
		const { paymentId } = await seedPaidOrder(t, {
			restaurantId,
			subtotal: 10_000,
			paymentIntentId: "pi_pending_return",
		});
		let recoveryId: Id<"disputeRecoveries">;
		await t.run(async (ctx) => {
			recoveryId = await ctx.db.insert("disputeRecoveries", {
				restaurantId,
				stripeDisputeId: "dp_pending_return",
				amount: 5_000,
				outstanding: 0,
				recovered: 2_000,
				currency: "mxn",
				status: "reinstated",
				lostAt: 1_000,
				reinstatedAt: 2_000,
				createdAt: 1_000,
				updatedAt: 2_000,
			});
			await ctx.db.patch(paymentId, {
				disputeRecoveryAmount: 2_000,
				disputeRecoveryAppliedAt: 2_500,
				disputeRecoveryLegs: [{ recoveryId: recoveryId!, amount: 2_000 }],
			});
		});

		await t.mutation(internal.stripeHelpers.recordChargeRefund, {
			paymentId,
			amountRefunded: 11_200,
			amountCaptured: 11_200,
			isFullyRefunded: true,
		});
		await drainScheduled(t);

		// Nothing to reverse: the money has not left yet, so the pending return
		// shrinks instead.
		expect(mockStripeClient.transfers.createReversal).not.toHaveBeenCalled();
		expect(await t.run(async (ctx) => (await ctx.db.get(recoveryId!))?.recovered)).toBe(0);
	});
});

describe("won and reinstated", () => {
	async function seedLostAndRecovered(t: SchemaAwareConvex, restaurantId: Id<"restaurants">) {
		await seedPaidOrder(t, { restaurantId, subtotal: 30_000, paymentIntentId: "pi_win" });
		await deliver(
			t,
			disputeEvent({
				eventId: "evt_win_lost",
				type: "charge.dispute.closed",
				disputeId: "dp_win",
				paymentIntentId: "pi_win",
				status: "lost",
				amount: 30_000,
			})
		);
		// Pretend two later orders paid 7,000 of it back.
		await t.run(async (ctx) => {
			const row = await ctx.db
				.query("disputeRecoveries")
				.withIndex("by_dispute_id", (q) => q.eq("stripeDisputeId", "dp_win"))
				.first();
			await ctx.db.patch(row!._id, { outstanding: 23_000, recovered: 7_000 });
		});
	}

	it("zeroes the debt and returns what was already taken, once", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t, { disputeRecoveryPercent: 25 });
		await seedLostAndRecovered(t, restaurantId);

		mockStripeClient.transfers.create.mockResolvedValue({ id: "tr_return" });

		await deliver(
			t,
			disputeEvent({
				eventId: "evt_win_reinstated",
				type: "charge.dispute.funds_reinstated",
				disputeId: "dp_win",
				paymentIntentId: "pi_win",
				status: "won",
				amount: 30_000,
				created: 1_700_400_000,
			})
		);
		// A redelivery of the same news, and a `closed` saying won on top of it.
		await deliver(
			t,
			disputeEvent({
				eventId: "evt_win_closed",
				type: "charge.dispute.closed",
				disputeId: "dp_win",
				paymentIntentId: "pi_win",
				status: "won",
				amount: 30_000,
				created: 1_700_500_000,
			})
		);

		// The return is a scheduled action: Stripe being slow must not fail the
		// transaction that recorded the win.
		await drainScheduled(t);

		const row = await t.run(async (ctx) =>
			ctx.db
				.query("disputeRecoveries")
				.withIndex("by_dispute_id", (q) => q.eq("stripeDisputeId", "dp_win"))
				.first()
		);
		expect(row).toMatchObject({
			outstanding: 0,
			recovered: 7_000,
			status: "reinstated",
			returnedAmount: 7_000,
			stripeTransferId: "tr_return",
		});

		// The restaurant is paid back exactly once. Two deliveries arriving before
		// the scheduler runs both queue a return — which is deliberate, because
		// the alternative (gating on the row's status) is what would skip the
		// retry after a failed transfer. Every call carries the same idempotency
		// key, so Stripe returns its record of the first transfer rather than
		// making a second, and `markRecoveryReturnedInternal` stamps the row once.
		expect(row?.returnedAmount).toBe(7_000);
		for (const call of mockStripeClient.transfers.create.mock.calls) {
			expect(call[0]).toMatchObject({
				amount: 7_000,
				destination: "acct_dispute",
				currency: "mxn",
			});
			expect(call[1]).toEqual({ idempotencyKey: "dispute-recovery-return:dp_win" });
		}
	});

	it("returns nothing when no order had paid the debt down yet", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t, { disputeRecoveryPercent: 25 });
		await seedPaidOrder(t, { restaurantId, subtotal: 30_000, paymentIntentId: "pi_nowin" });
		await deliver(
			t,
			disputeEvent({
				eventId: "evt_nowin_lost",
				type: "charge.dispute.closed",
				disputeId: "dp_nowin",
				paymentIntentId: "pi_nowin",
				status: "lost",
				amount: 30_000,
			})
		);
		await deliver(
			t,
			disputeEvent({
				eventId: "evt_nowin_won",
				type: "charge.dispute.funds_reinstated",
				disputeId: "dp_nowin",
				paymentIntentId: "pi_nowin",
				status: "won",
				amount: 30_000,
				created: 1_700_400_000,
			})
		);

		expect(mockStripeClient.transfers.create).not.toHaveBeenCalled();
		const row = await t.run(async (ctx) =>
			ctx.db
				.query("disputeRecoveries")
				.withIndex("by_dispute_id", (q) => q.eq("stripeDisputeId", "dp_nowin"))
				.first()
		);
		expect(row?.outstanding).toBe(0);
		expect(row?.status).toBe("reinstated");
	});
});

describe("a return transfer that failed (review round 1)", () => {
	async function seedReinstatedOwing(t: SchemaAwareConvex, restaurantId: Id<"restaurants">) {
		await seedPaidOrder(t, { restaurantId, subtotal: 30_000, paymentIntentId: "pi_retry" });
		await deliver(
			t,
			disputeEvent({
				eventId: "evt_retry_lost",
				type: "charge.dispute.closed",
				disputeId: "dp_retry",
				paymentIntentId: "pi_retry",
				status: "lost",
				amount: 30_000,
			})
		);
		await t.run(async (ctx) => {
			const row = await ctx.db
				.query("disputeRecoveries")
				.withIndex("by_dispute_id", (q) => q.eq("stripeDisputeId", "dp_retry"))
				.first();
			await ctx.db.patch(row!._id, { outstanding: 23_000, recovered: 7_000 });
		});
	}

	it("raises a severe alert when the transfer throws, because nothing retries it", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t, { disputeRecoveryPercent: 25 });
		await seedReinstatedOwing(t, restaurantId);

		mockStripeClient.transfers.create.mockRejectedValue(new Error("stripe is down"));
		await deliver(
			t,
			disputeEvent({
				eventId: "evt_retry_won",
				type: "charge.dispute.funds_reinstated",
				disputeId: "dp_retry",
				paymentIntentId: "pi_retry",
				status: "won",
				amount: 30_000,
				created: 1_700_400_000,
			})
		);
		// convex-test records a failed scheduled run rather than rejecting here,
		// which is the point: Convex does not retry it either.
		await drainScheduled(t);

		const alerts = await t.run(async (ctx) => ctx.db.query("operatorAlerts").collect());
		expect(alerts.some((a) => a.dedupeKey === "dispute_recovery_return_failed:dp_retry")).toBe(
			true
		);

		const row = await t.run(async (ctx) =>
			ctx.db
				.query("disputeRecoveries")
				.withIndex("by_dispute_id", (q) => q.eq("stripeDisputeId", "dp_retry"))
				.first()
		);
		// Reinstated but still owing: exactly the state the sweep has to find.
		expect(row?.status).toBe("reinstated");
		expect(row?.returnedAt).toBeUndefined();
	});

	it("re-schedules from a redelivered win, although the row is already reinstated", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t, { disputeRecoveryPercent: 25 });
		await seedReinstatedOwing(t, restaurantId);

		mockStripeClient.transfers.create.mockRejectedValueOnce(new Error("stripe is down"));
		await deliver(
			t,
			disputeEvent({
				eventId: "evt_retry_won_1",
				type: "charge.dispute.funds_reinstated",
				disputeId: "dp_retry",
				paymentIntentId: "pi_retry",
				status: "won",
				amount: 30_000,
				created: 1_700_400_000,
			})
		);
		// convex-test records a failed scheduled run rather than rejecting here,
		// which is the point: Convex does not retry it either.
		await drainScheduled(t);

		mockStripeClient.transfers.create.mockResolvedValue({ id: "tr_second_try" });
		await deliver(
			t,
			disputeEvent({
				eventId: "evt_retry_won_2",
				type: "charge.dispute.closed",
				disputeId: "dp_retry",
				paymentIntentId: "pi_retry",
				status: "won",
				amount: 30_000,
				created: 1_700_500_000,
			})
		);
		await drainScheduled(t);

		const row = await t.run(async (ctx) =>
			ctx.db
				.query("disputeRecoveries")
				.withIndex("by_dispute_id", (q) => q.eq("stripeDisputeId", "dp_retry"))
				.first()
		);
		expect(row?.stripeTransferId).toBe("tr_second_try");
		expect(row?.returnedAmount).toBe(7_000);
	});

	it("the daily sweep re-schedules a return that never settled", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t, { disputeRecoveryPercent: 25 });
		await seedReinstatedOwing(t, restaurantId);

		mockStripeClient.transfers.create.mockRejectedValueOnce(new Error("stripe is down"));
		await deliver(
			t,
			disputeEvent({
				eventId: "evt_sweep_won",
				type: "charge.dispute.funds_reinstated",
				disputeId: "dp_retry",
				paymentIntentId: "pi_retry",
				status: "won",
				amount: 30_000,
				created: 1_700_400_000,
			})
		);
		// convex-test records a failed scheduled run rather than rejecting here,
		// which is the point: Convex does not retry it either.
		await drainScheduled(t);

		mockStripeClient.transfers.create.mockResolvedValue({ id: "tr_swept" });

		// Not immediately: a sweep that raced the run still working would make
		// the loser fail with `idempotency_key_in_use` and raise a severe alert
		// about a transfer that was in fact succeeding (review round 2).
		expect((await t.mutation(internal.disputes.sweepDisputeWriteOffs, {})).reScheduled).toBe(0);

		vi.advanceTimersByTime(DISPUTE_RETURN_RESCHEDULE_AFTER_MS + 1);
		const result = await t.mutation(internal.disputes.sweepDisputeWriteOffs, {});
		expect(result.reScheduled).toBe(1);
		await drainScheduled(t);

		const row = await t.run(async (ctx) =>
			ctx.db
				.query("disputeRecoveries")
				.withIndex("by_dispute_id", (q) => q.eq("stripeDisputeId", "dp_retry"))
				.first()
		);
		expect(row?.returnedAt).toBeDefined();

		// And once it has settled, the sweep leaves it alone.
		expect((await t.mutation(internal.disputes.sweepDisputeWriteOffs, {})).reScheduled).toBe(0);
	});
});

describe("retries and races (review round 2)", () => {
	it("the daily sweep retries a shortfall transfer that died", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t);
		const { paymentId } = await seedPaidOrder(t, {
			restaurantId,
			subtotal: 10_000,
			paymentIntentId: "pi_shortfall_retry",
		});
		await t.run(async (ctx) => {
			await ctx.db.patch(paymentId, {
				disputeRecoveryAmount: 0,
				disputeRecoveryAppliedAt: Date.now(),
				disputeRecoveryShortfall: 1_500,
				disputeRecoveryShortfallPending: true,
			});
		});

		mockStripeClient.transfers.create.mockResolvedValue({ id: "tr_shortfall_retry" });
		const result = await t.mutation(internal.disputes.sweepDisputeWriteOffs, {});
		expect(result.shortfallsReScheduled).toBe(1);
		await drainScheduled(t);

		const payment = await t.run(async (ctx) => ctx.db.get(paymentId));
		expect(payment?.disputeRecoveryShortfallTransferId).toBe("tr_shortfall_retry");
		// The flag clears, so the next sweep leaves it alone.
		expect(payment?.disputeRecoveryShortfallPending).toBeUndefined();
		expect(
			(await t.mutation(internal.disputes.sweepDisputeWriteOffs, {})).shortfallsReScheduled
		).toBe(0);
	});

	it("never schedules a transfer to a closed connected account, and says why", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t);
		const { paymentId } = await seedPaidOrder(t, {
			restaurantId,
			subtotal: 10_000,
			paymentIntentId: "pi_closed_account",
		});
		await t.run(async (ctx) => {
			await ctx.db.patch(restaurantId, { stripeAccountStatus: "closed" });
			await ctx.db.patch(paymentId, {
				disputeRecoveryAmount: 0,
				disputeRecoveryAppliedAt: Date.now(),
				disputeRecoveryShortfall: 1_500,
				disputeRecoveryShortfallPending: true,
			});
		});

		const result = await t.mutation(internal.disputes.sweepDisputeWriteOffs, {});
		expect(result.shortfallsReScheduled).toBe(0);
		expect(mockStripeClient.transfers.create).not.toHaveBeenCalled();

		const alerts = await t.run(async (ctx) => ctx.db.query("operatorAlerts").collect());
		expect(
			alerts.some((a) => a.dedupeKey === `dispute_recovery_shortfall_blocked:${paymentId}`)
		).toBe(true);
	});

	it("treats Stripe's idempotency_key_in_use as the race it is, not a failure", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t, { disputeRecoveryPercent: 25 });
		await seedPaidOrder(t, { restaurantId, subtotal: 30_000, paymentIntentId: "pi_race" });
		await deliver(
			t,
			disputeEvent({
				eventId: "evt_race_lost",
				type: "charge.dispute.closed",
				disputeId: "dp_race",
				paymentIntentId: "pi_race",
				status: "lost",
				amount: 30_000,
			})
		);
		await t.run(async (ctx) => {
			const row = await ctx.db
				.query("disputeRecoveries")
				.withIndex("by_dispute_id", (q) => q.eq("stripeDisputeId", "dp_race"))
				.first();
			await ctx.db.patch(row!._id, { outstanding: 23_000, recovered: 7_000 });
		});

		// What Stripe answers when a second call arrives while the first with the
		// same idempotency key is still in flight.
		const inUse = Object.assign(new Error("Keys for idempotent requests..."), {
			code: "idempotency_key_in_use",
			type: "idempotency_error",
		});
		mockStripeClient.transfers.create.mockRejectedValue(inUse);

		await deliver(
			t,
			disputeEvent({
				eventId: "evt_race_won",
				type: "charge.dispute.funds_reinstated",
				disputeId: "dp_race",
				paymentIntentId: "pi_race",
				status: "won",
				amount: 30_000,
				created: 1_700_400_000,
			})
		);
		await drainScheduled(t);

		// The winner is moving the money; paging an operator about it is how a
		// severe alert stops meaning anything.
		const alerts = await t.run(async (ctx) => ctx.db.query("operatorAlerts").collect());
		expect(alerts.some((a) => a.dedupeKey === "dispute_recovery_return_failed:dp_race")).toBe(
			false
		);
	});
});

describe("a trimmed return, and reversals in flight (review round 3)", () => {
	/**
	 * A reinstated row owing 500, with a return already scheduled, and one of
	 * the payments that drew it down about to be refunded.
	 */
	async function seedScheduledReturn(t: SchemaAwareConvex, restaurantId: Id<"restaurants">) {
		const { paymentId } = await seedPaidOrder(t, {
			restaurantId,
			subtotal: 10_000,
			paymentIntentId: "pi_trim",
		});
		let recoveryId: Id<"disputeRecoveries">;
		await t.run(async (ctx) => {
			recoveryId = await ctx.db.insert("disputeRecoveries", {
				restaurantId,
				stripeDisputeId: "dp_trim",
				amount: 5_000,
				outstanding: 0,
				recovered: 500,
				currency: "mxn",
				status: "reinstated",
				lostAt: 1_000,
				reinstatedAt: 2_000,
				returnScheduledAt: 2_000,
				createdAt: 1_000,
				updatedAt: 2_000,
			});
			await ctx.db.patch(paymentId, {
				disputeRecoveryAmount: 500,
				disputeRecoveryAppliedAt: 1_500,
				disputeRecoveryLegs: [{ recoveryId: recoveryId!, amount: 500 }],
			});
		});
		return { paymentId, recoveryId: recoveryId! };
	}

	it("transfers what the row says at execution, not what it said at scheduling", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t);
		const { paymentId, recoveryId } = await seedScheduledReturn(t, restaurantId);

		// The return is queued for 500…
		await t.run(async (ctx) => {
			await ctx.scheduler.runAfter(0, internal.disputeActions.returnRecoveredFunds, {
				recoveryId,
				stripeAccountId: "acct_dispute",
				stripeDisputeId: "dp_trim",
				amount: 500,
				currency: "mxn",
			});
		});

		// …and then 60% of the charge is refunded, trimming the row to 200.
		// (6,720 of 11,200 → 300 of the 500.)
		await t.mutation(internal.stripeHelpers.recordChargeRefund, {
			paymentId,
			amountRefunded: 6_720,
			amountCaptured: 11_200,
			isFullyRefunded: false,
		});
		expect(await t.run(async (ctx) => (await ctx.db.get(recoveryId))?.recovered)).toBe(200);

		mockStripeClient.transfers.create.mockResolvedValue({ id: "tr_trimmed", amount: 200 });
		await drainScheduled(t);

		// 200, never 500 — the 300 difference went back to the diner, so sending
		// it to the restaurant as well would leak it with nothing to alert on.
		expect(mockStripeClient.transfers.create).toHaveBeenCalledWith(
			expect.objectContaining({ amount: 200 }),
			{ idempotencyKey: "dispute-recovery-return:dp_trim" }
		);
		expect(await t.run(async (ctx) => (await ctx.db.get(recoveryId))?.returnedAmount)).toBe(200);
	});

	it("stands down entirely when the refund left nothing to return", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t);
		const { paymentId, recoveryId } = await seedScheduledReturn(t, restaurantId);

		await t.run(async (ctx) => {
			await ctx.scheduler.runAfter(0, internal.disputeActions.returnRecoveredFunds, {
				recoveryId,
				stripeAccountId: "acct_dispute",
				stripeDisputeId: "dp_trim",
				amount: 500,
				currency: "mxn",
			});
		});
		await t.mutation(internal.stripeHelpers.recordChargeRefund, {
			paymentId,
			amountRefunded: 11_200,
			amountCaptured: 11_200,
			isFullyRefunded: true,
		});
		await drainScheduled(t);

		expect(mockStripeClient.transfers.create).not.toHaveBeenCalled();
		const row = await t.run(async (ctx) => ctx.db.get(recoveryId));
		expect(row?.recovered).toBe(0);
		expect(row?.returnedAt ?? null).toBeNull();
	});

	it("reverses the excess when the transfer beat the trim to Stripe", async () => {
		// Belt and braces: the action read 500 and was mid-flight when the trim
		// landed, so the money left before anything could lower it.
		const t = newTest();
		const restaurantId = await seedRestaurant(t);
		const { paymentId, recoveryId } = await seedScheduledReturn(t, restaurantId);

		await t.mutation(internal.stripeHelpers.recordChargeRefund, {
			paymentId,
			amountRefunded: 6_720,
			amountCaptured: 11_200,
			isFullyRefunded: false,
		});

		mockStripeClient.transfers.createReversal.mockResolvedValue({ id: "trr_excess" });
		await t.mutation(internal.disputes.markRecoveryReturnedInternal, {
			recoveryId,
			stripeTransferId: "tr_raced",
			amount: 500,
		});
		await drainScheduled(t);

		expect(mockStripeClient.transfers.createReversal).toHaveBeenCalledWith(
			"tr_raced",
			expect.objectContaining({ amount: 300 }),
			{ idempotencyKey: `dispute-return-reversal:${recoveryId}:tr_raced:300` }
		);
		const row = await t.run(async (ctx) => ctx.db.get(recoveryId));
		expect(row?.returnExcessReversed).toBe(300);
		// Net paid out: 500 transferred minus 300 reversed = the 200 owed.
		expect(row?.returnedAmount).toBe(200);
	});

	it("sends only the new slice when a bigger refund lands before the first reversal confirms", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t);
		const { paymentId } = await seedPaidOrder(t, {
			restaurantId,
			subtotal: 10_000,
			paymentIntentId: "pi_pending_reversal",
		});
		await t.run(async (ctx) => {
			const recoveryId = await ctx.db.insert("disputeRecoveries", {
				restaurantId,
				stripeDisputeId: "dp_pending_reversal",
				amount: 5_000,
				outstanding: 0,
				recovered: 2_000,
				currency: "mxn",
				status: "reinstated",
				lostAt: 1_000,
				reinstatedAt: 2_000,
				returnedAt: 3_000,
				returnedAmount: 2_000,
				stripeTransferId: "tr_out",
				createdAt: 1_000,
				updatedAt: 3_000,
			});
			await ctx.db.patch(paymentId, {
				disputeRecoveryAmount: 2_000,
				disputeRecoveryAppliedAt: 2_500,
				disputeRecoveryLegs: [{ recoveryId, amount: 2_000 }],
			});
		});

		// Two refund deliveries back to back, with NOTHING drained in between —
		// so the first reversal has not confirmed and `disputeReturnReversals` is
		// still empty when the second is planned.
		await t.mutation(internal.stripeHelpers.recordChargeRefund, {
			paymentId,
			amountRefunded: 2_800,
			amountCaptured: 11_200,
			isFullyRefunded: false,
		});
		await t.mutation(internal.stripeHelpers.recordChargeRefund, {
			paymentId,
			amountRefunded: 11_200,
			amountCaptured: 11_200,
			isFullyRefunded: true,
		});

		mockStripeClient.transfers.createReversal.mockResolvedValue({ id: "trr_step" });
		await drainScheduled(t);

		// 500 then 1,500 — never 500 then 2,000, which would reverse the first
		// slice twice or be rejected depending on what Stripe saw second.
		const amounts = mockStripeClient.transfers.createReversal.mock.calls.map(
			(call) => call[1].amount
		);
		expect(amounts).toEqual([500, 1_500]);
		const payment = await t.run(async (ctx) => ctx.db.get(paymentId));
		expect(payment?.disputeReturnReversals).toEqual([
			{ stripeTransferId: "tr_out", amount: 2_000 },
		]);
	});

	it("does not forget a reversal slice that failed", async () => {
		// The pending entry is written before Stripe agrees to anything. If a
		// failed slice stayed on the record, the next, larger target would
		// compute its delta from it — reversing 300 while recording 500.
		const t = newTest();
		const restaurantId = await seedRestaurant(t);
		const { paymentId } = await seedPaidOrder(t, {
			restaurantId,
			subtotal: 10_000,
			paymentIntentId: "pi_failed_slice",
		});
		await t.run(async (ctx) => {
			const recoveryId = await ctx.db.insert("disputeRecoveries", {
				restaurantId,
				stripeDisputeId: "dp_failed_slice",
				amount: 5_000,
				outstanding: 0,
				recovered: 500,
				currency: "mxn",
				status: "reinstated",
				lostAt: 1_000,
				reinstatedAt: 2_000,
				returnedAt: 3_000,
				returnedAmount: 500,
				stripeTransferId: "tr_slice",
				createdAt: 1_000,
				updatedAt: 3_000,
			});
			await ctx.db.patch(paymentId, {
				disputeRecoveryAmount: 500,
				disputeRecoveryAppliedAt: 2_500,
				disputeRecoveryLegs: [{ recoveryId, amount: 500 }],
			});
		});

		// 40% of the charge → a 200 slice, which fails at Stripe.
		mockStripeClient.transfers.createReversal.mockRejectedValueOnce(new Error("try again"));
		await t.mutation(internal.stripeHelpers.recordChargeRefund, {
			paymentId,
			amountRefunded: 4_480,
			amountCaptured: 11_200,
			isFullyRefunded: false,
		});
		await drainScheduled(t);

		const afterFailure = await t.run(async (ctx) => ctx.db.get(paymentId));
		expect(afterFailure?.disputeReturnReversals ?? []).toEqual([]);
		// Rolled back, so nothing claims a reversal that did not happen.
		expect(afterFailure?.disputeReturnReversalsPending ?? []).toEqual([]);

		// Then the rest of the charge comes back.
		mockStripeClient.transfers.createReversal.mockResolvedValue({ id: "trr_whole" });
		await t.mutation(internal.stripeHelpers.recordChargeRefund, {
			paymentId,
			amountRefunded: 11_200,
			amountCaptured: 11_200,
			isFullyRefunded: true,
		});
		await drainScheduled(t);

		// One reversal covering BOTH slices — not 300 recorded as 500.
		expect(mockStripeClient.transfers.createReversal).toHaveBeenLastCalledWith(
			"tr_slice",
			expect.objectContaining({ amount: 500 }),
			{ idempotencyKey: `dispute-return-reversal:${paymentId}:tr_slice:500` }
		);
		const payment = await t.run(async (ctx) => ctx.db.get(paymentId));
		expect(payment?.disputeReturnReversals).toEqual([
			{ stripeTransferId: "tr_slice", amount: 500 },
		]);
		// Cleared on confirm, so `confirmed` is the single source of truth.
		expect(payment?.disputeReturnReversalsPending ?? []).toEqual([]);
	});

	it("treats a reused key with different parameters as a failure, not a race", async () => {
		// `idempotency_error` means the same key came back with different
		// parameters — a trimmed retry against an amount that already went out.
		// Swallowing it would make the daily sweep retry the same mismatch every
		// day, in silence.
		const t = newTest();
		const restaurantId = await seedRestaurant(t);
		const { recoveryId } = await seedScheduledReturn(t, restaurantId);

		const mismatch = Object.assign(new Error("Keys for idempotent requests..."), {
			type: "idempotency_error",
		});
		mockStripeClient.transfers.create.mockRejectedValue(mismatch);
		await t.run(async (ctx) => {
			await ctx.scheduler.runAfter(0, internal.disputeActions.returnRecoveredFunds, {
				recoveryId,
				stripeAccountId: "acct_dispute",
				stripeDisputeId: "dp_trim",
				amount: 500,
				currency: "mxn",
			});
		});
		await drainScheduled(t);

		const alerts = await t.run(async (ctx) => ctx.db.query("operatorAlerts").collect());
		expect(alerts.some((a) => a.dedupeKey === "dispute_recovery_return_failed:dp_trim")).toBe(true);
	});
});

describe("the write-off sweep", () => {
	it("writes off an outstanding loss older than the window and leaves younger ones alone", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t);
		const now = Date.now();

		let oldRow: Id<"disputeRecoveries">;
		let youngRow: Id<"disputeRecoveries">;
		await t.run(async (ctx) => {
			oldRow = await ctx.db.insert("disputeRecoveries", {
				restaurantId,
				stripeDisputeId: "dp_old",
				amount: 5_000,
				outstanding: 4_000,
				recovered: 1_000,
				currency: "mxn",
				status: "outstanding",
				lostAt: now - DISPUTE_RECOVERY_WRITE_OFF_MS - 1,
				createdAt: now,
				updatedAt: now,
			});
			youngRow = await ctx.db.insert("disputeRecoveries", {
				restaurantId,
				stripeDisputeId: "dp_young",
				amount: 5_000,
				outstanding: 5_000,
				recovered: 0,
				currency: "mxn",
				status: "outstanding",
				lostAt: now - 1_000,
				createdAt: now,
				updatedAt: now,
			});
		});

		const result = await t.mutation(internal.disputes.sweepDisputeWriteOffs, {});
		expect(result.writtenOff).toBe(1);

		const written = await t.run(async (ctx) => ctx.db.get(oldRow!));
		expect(written?.status).toBe("written_off");
		expect(written?.writtenOffAt).toBeDefined();
		// The unrecovered figure survives — `status` is what stops it deducting.
		expect(written?.outstanding).toBe(4_000);

		expect(await t.run(async (ctx) => (await ctx.db.get(youngRow!))?.status)).toBe("outstanding");

		const alerts = await t.run(async (ctx) => ctx.db.query("operatorAlerts").collect());
		expect(alerts).toHaveLength(1);
		expect(alerts[0].severity).toBe(OPERATOR_ALERT_SEVERITY.INFO);

		// A second sweep finds nothing left to do.
		expect((await t.mutation(internal.disputes.sweepDisputeWriteOffs, {})).writtenOff).toBe(0);
	});

	it("stops a written-off row from deducting from later orders", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t, { disputeRecoveryPercent: 50 });
		const now = Date.now();
		await t.run(async (ctx) => {
			await ctx.db.insert("disputeRecoveries", {
				restaurantId,
				stripeDisputeId: "dp_stale",
				amount: 50_000,
				outstanding: 50_000,
				recovered: 0,
				currency: "mxn",
				status: "outstanding",
				lostAt: now - DISPUTE_RECOVERY_WRITE_OFF_MS - 1,
				createdAt: now,
				updatedAt: now,
			});
		});

		await t.mutation(internal.disputes.sweepDisputeWriteOffs, {});

		const quote = await t.run(async (ctx) =>
			ctx.runQuery(internal.disputes.getRecoveryQuoteInternal, { restaurantId })
		);
		expect(quote.totalOutstanding).toBe(0);
	});
});

describe("the dispute fee aggregates", () => {
	it("records Tavli's fee once per dispute and totals it per month", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t);
		await seedPaidOrder(t, { restaurantId, subtotal: 20_000, paymentIntentId: "pi_fee" });

		const septFee = Date.UTC(2026, 8, 15) / 1000;
		await deliver(
			t,
			disputeEvent({
				eventId: "evt_fee_1",
				type: "charge.dispute.created",
				disputeId: "dp_fee",
				paymentIntentId: "pi_fee",
				status: "needs_response",
				amount: 20_000,
				fee: 40_000,
				feeCreated: septFee,
			})
		);
		// A second delivery carrying the same fee must not double it.
		await deliver(
			t,
			disputeEvent({
				eventId: "evt_fee_2",
				type: "charge.dispute.closed",
				disputeId: "dp_fee",
				paymentIntentId: "pi_fee",
				status: "lost",
				amount: 20_000,
				fee: 40_000,
				feeCreated: septFee,
			})
		);

		const admin = t.withIdentity({ subject: ADMIN });
		const [report] = await admin.query(api.disputes.getDisputeAggregates, {
			restaurantId,
			month: "2026-09",
		});
		expect(report?.platformFees).toEqual({ count: 1, amount: 40_000 });
		expect(report?.perRestaurant.opened).toEqual({ count: 1, amount: 20_000 });
		expect(report?.perRestaurant.lost).toEqual({ count: 1, amount: 20_000 });
		expect(report?.perRestaurant.won).toEqual({ count: 0, amount: 0 });

		const feeAudits = await t.run(async (ctx) =>
			(await ctx.db.query("allEvents").collect()).filter(
				(row) => row.eventType === "payments.disputeFeeAbsorbed"
			)
		);
		expect(feeAudits).toHaveLength(1);
	});

	it("takes the fee back out of the month when the funds are reinstated", async () => {
		// Stripe refunds the dispute fee as a NEGATIVE balance transaction, so the
		// summed fee nets to zero — a cost Tavli never bore must not sit in the
		// month's total forever.
		const t = newTest();
		const restaurantId = await seedRestaurant(t);
		await seedPaidOrder(t, { restaurantId, subtotal: 20_000, paymentIntentId: "pi_feeback" });
		const septFee = Date.UTC(2026, 8, 15) / 1000;

		await deliver(
			t,
			disputeEvent({
				eventId: "evt_feeback_lost",
				type: "charge.dispute.closed",
				disputeId: "dp_feeback",
				paymentIntentId: "pi_feeback",
				status: "lost",
				amount: 20_000,
				fee: 40_000,
				feeCreated: septFee,
			})
		);

		const admin = t.withIdentity({ subject: ADMIN });
		let [report] = await admin.query(api.disputes.getDisputeAggregates, {
			restaurantId,
			month: "2026-09",
		});
		expect(report?.platformFees).toEqual({ count: 1, amount: 40_000 });

		// The reinstatement carries both transactions: +40,000 and −40,000.
		mockStripeClient.webhooks.constructEvent.mockReturnValueOnce({
			id: "evt_feeback_reinstated",
			type: "charge.dispute.funds_reinstated",
			created: 1_700_400_000,
			data: {
				object: {
					id: "dp_feeback",
					charge: "ch_dispute",
					payment_intent: "pi_feeback",
					amount: 20_000,
					currency: "mxn",
					reason: "fraudulent",
					status: "won",
					created: 1_699_999_000,
					balance_transactions: [
						{ fee: 40_000, created: septFee },
						{ fee: -40_000, created: septFee + 86_400 },
					],
				},
			},
		});
		await t.action(internal.stripe.fulfillPayment, {
			payloadString: "{}",
			signatureHeader: "sig",
		});

		[report] = await admin.query(api.disputes.getDisputeAggregates, {
			restaurantId,
			month: "2026-09",
		});
		expect(report?.platformFees).toEqual({ count: 0, amount: 0 });

		const dispute = await t.run(async (ctx) =>
			ctx.db
				.query("stripeDisputes")
				.withIndex("by_dispute_id", (q) => q.eq("stripeDisputeId", "dp_feeback"))
				.first()
		);
		expect(dispute?.disputeFeeAmount).toBeUndefined();
	});

	it("refuses the aggregates to anyone who is not a platform admin", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t);
		const manager = t.withIdentity({ subject: MANAGER });
		const [data, error] = await manager.query(api.disputes.getDisputeAggregates, { restaurantId });
		expect(data).toBeNull();
		expect(error).not.toBeNull();
	});
});

describe("telling the restaurant", () => {
	it("notifies and mails every manager once per phase, and alerts Tavli on a loss", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t, { disputeRecoveryPercent: 30 });
		await seedPaidOrder(t, {
			restaurantId,
			subtotal: 30_000,
			paymentIntentId: "pi_tell",
			dailyOrderNumber: 7,
		});

		await deliver(
			t,
			disputeEvent({
				eventId: "evt_tell_created",
				type: "charge.dispute.created",
				disputeId: "dp_tell",
				paymentIntentId: "pi_tell",
				status: "needs_response",
				amount: 30_000,
			})
		);
		await deliver(
			t,
			disputeEvent({
				eventId: "evt_tell_lost",
				type: "charge.dispute.closed",
				disputeId: "dp_tell",
				paymentIntentId: "pi_tell",
				status: "lost",
				amount: 30_000,
				created: 1_700_100_000,
			})
		);
		// Stripe redelivers the loss under `updated`; nobody may hear twice.
		await deliver(
			t,
			disputeEvent({
				eventId: "evt_tell_lost_again",
				type: "charge.dispute.updated",
				disputeId: "dp_tell",
				paymentIntentId: "pi_tell",
				status: "lost",
				amount: 30_000,
				created: 1_700_200_000,
			})
		);

		const notifications = await t.run(async (ctx) => ctx.db.query("notifications").collect());
		const byKind = notifications.reduce<Record<string, number>>((acc, row) => {
			acc[row.kind] = (acc[row.kind] ?? 0) + 1;
			return acc;
		}, {});
		// Two recipients (the owner and the manager), one row each, per phase.
		expect(byKind.dispute_opened).toBe(2);
		expect(byKind.dispute_lost).toBe(2);
		expect(notifications.every((row) => row.href === "/admin/payments")).toBe(true);
		expect(notifications.some((row) => row.dedupeKey === "dispute_lost:dp_tell")).toBe(true);
		// A platform admin hears through the operator alert, never the bell.
		expect(notifications.some((row) => row.userId === ADMIN)).toBe(false);

		const alerts = await t.run(async (ctx) => ctx.db.query("operatorAlerts").collect());
		expect(alerts).toHaveLength(1);
		expect(alerts[0]).toMatchObject({
			kind: OPERATOR_ALERT_KIND.DISPUTE_LOST,
			severity: OPERATOR_ALERT_SEVERITY.SEVERE,
			dedupeKey: "dispute_lost:dp_tell",
		});

		// The "lost" body has to be the recovery variant, because this
		// restaurant really will have money withheld.
		const lost = notifications.find((row) => row.kind === "dispute_lost");
		expect(lost?.messageKey).toBe("disputes.notification.lostWithRecovery");
		expect(lost?.messageParams).toMatchObject({ percent: 30, currency: "MXN" });
	});

	it("tells a restaurant with recovery off that nothing will be withheld", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t);
		await seedPaidOrder(t, { restaurantId, subtotal: 30_000, paymentIntentId: "pi_nodeduct" });

		await deliver(
			t,
			disputeEvent({
				eventId: "evt_nodeduct",
				type: "charge.dispute.closed",
				disputeId: "dp_nodeduct",
				paymentIntentId: "pi_nodeduct",
				status: "lost",
				amount: 30_000,
			})
		);

		const notifications = await t.run(async (ctx) => ctx.db.query("notifications").collect());
		const lost = notifications.find((row) => row.kind === "dispute_lost");
		expect(lost?.messageKey).toBe("disputes.notification.lost");
		expect(lost?.messageParams).toMatchObject({ percent: 0 });
	});
});

describe("the disputes surface", () => {
	it("shows a manager the dispute, its order and its recovery position", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t, { disputeRecoveryPercent: 15 });
		await seedPaidOrder(t, {
			restaurantId,
			subtotal: 30_000,
			paymentIntentId: "pi_list",
			dailyOrderNumber: 12,
		});
		await deliver(
			t,
			disputeEvent({
				eventId: "evt_list",
				type: "charge.dispute.closed",
				disputeId: "dp_list",
				paymentIntentId: "pi_list",
				status: "lost",
				amount: 30_000,
			})
		);

		const manager = t.withIdentity({ subject: MANAGER });
		const [data] = await manager.query(api.disputes.listByRestaurant, { restaurantId });
		expect(data?.rows).toHaveLength(1);
		expect(data?.rows[0]).toMatchObject({
			status: "lost",
			amount: 30_000,
			currency: "MXN",
			dailyOrderNumber: 12,
			outstanding: 30_000,
			recoveryStatus: "outstanding",
		});
		expect(data?.recovery).toMatchObject({ percent: 15, totalOutstanding: 30_000 });
		expect(data?.isAdmin).toBe(false);
	});

	it("normalizes a status Stripe invents rather than leaking it to a manager", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t);
		await seedPaidOrder(t, { restaurantId, subtotal: 10_000, paymentIntentId: "pi_weird" });
		await deliver(
			t,
			disputeEvent({
				eventId: "evt_weird",
				type: "charge.dispute.updated",
				disputeId: "dp_weird",
				paymentIntentId: "pi_weird",
				status: "some_future_status",
				amount: 10_000,
			})
		);

		const manager = t.withIdentity({ subject: MANAGER });
		const [data] = await manager.query(api.disputes.listByRestaurant, { restaurantId });
		expect(data?.rows[0].status).toBe("unknown");
		// The raw string is still stored, for whoever is looking at the Dashboard.
		const stored = await t.run(async (ctx) =>
			ctx.db
				.query("stripeDisputes")
				.withIndex("by_dispute_id", (q) => q.eq("stripeDisputeId", "dp_weird"))
				.first()
		);
		expect(stored?.status).toBe("some_future_status");
	});
});

describe("the admin recovery percentage", () => {
	it("stores a valid percentage and records who changed it", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t);
		const admin = t.withIdentity({ subject: ADMIN });

		const [result] = await admin.mutation(api.disputes.setDisputeRecoveryPercent, {
			restaurantId,
			percent: 25,
		});
		expect(result?.percent).toBe(25);

		const restaurant = await t.run(async (ctx) => ctx.db.get(restaurantId));
		expect(restaurant?.disputeRecoveryPercent).toBe(25);

		const audits = await t.run(async (ctx) =>
			(await ctx.db.query("allEvents").collect()).filter(
				(row) => row.eventType === "restaurants.disputeRecoveryPercentChanged"
			)
		);
		expect(audits).toHaveLength(1);
		expect(audits[0].payload).toMatchObject({ from: 0, to: 25 });
	});

	it("refuses 51 — the cap is the rule, not a hint", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t);
		const admin = t.withIdentity({ subject: ADMIN });

		await expect(
			admin.mutation(api.disputes.setDisputeRecoveryPercent, { restaurantId, percent: 51 })
		).rejects.toThrow(/ERROR_DISPUTE_RECOVERY_PERCENT_INVALID/);

		const restaurant = await t.run(async (ctx) => ctx.db.get(restaurantId));
		expect(restaurant?.disputeRecoveryPercent).toBeUndefined();
	});

	it("refuses a fraction", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t);
		const admin = t.withIdentity({ subject: ADMIN });
		await expect(
			admin.mutation(api.disputes.setDisputeRecoveryPercent, { restaurantId, percent: 12.5 })
		).rejects.toThrow(/ERROR_DISPUTE_RECOVERY_PERCENT_INVALID/);
	});

	it("refuses a restaurant manager: this is a commercial term, not a setting", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t);
		const manager = t.withIdentity({ subject: MANAGER });
		const [data, error] = await manager.mutation(api.disputes.setDisputeRecoveryPercent, {
			restaurantId,
			percent: 0,
		});
		expect(data).toBeNull();
		expect(error).not.toBeNull();
	});
});

describe("refunding a disputed charge", () => {
	it("refuses with a stable code instead of letting Stripe answer charge_disputed", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t);
		const { orderId, paymentId } = await seedPaidOrder(t, {
			restaurantId,
			subtotal: 20_000,
			paymentIntentId: "pi_refundguard",
		});
		await deliver(
			t,
			disputeEvent({
				eventId: "evt_refundguard",
				type: "charge.dispute.created",
				disputeId: "dp_refundguard",
				paymentIntentId: "pi_refundguard",
				status: "needs_response",
				amount: 20_000,
			})
		);

		await expect(t.action(internal.stripe.createRefund, { paymentId, orderId })).rejects.toThrow(
			/ERROR_PAYMENT_UNDER_DISPUTE/
		);

		expect(mockStripeClient.refunds.create).not.toHaveBeenCalled();
		// And nothing was flipped on the way out: staff must not be left looking
		// at an order that says a refund is in progress when none ever will be.
		const payment = await t.run(async (ctx) => ctx.db.get(paymentId));
		expect(payment?.refundStatus).toBe("none");
		const order = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(order?.paymentState).toBe("paid");
	});

	it("still refuses after we lost: the diner already has the money back", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t);
		const { orderId, paymentId } = await seedPaidOrder(t, {
			restaurantId,
			subtotal: 20_000,
			paymentIntentId: "pi_refundlost",
		});
		await deliver(
			t,
			disputeEvent({
				eventId: "evt_refundlost",
				type: "charge.dispute.closed",
				disputeId: "dp_refundlost",
				paymentIntentId: "pi_refundlost",
				status: "lost",
				amount: 20_000,
			})
		);

		await expect(t.action(internal.stripe.createRefund, { paymentId, orderId })).rejects.toThrow(
			/ERROR_PAYMENT_UNDER_DISPUTE/
		);
	});

	it("allows a refund once the dispute is won and the charge is released", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t);
		const { orderId, paymentId } = await seedPaidOrder(t, {
			restaurantId,
			subtotal: 20_000,
			paymentIntentId: "pi_refundwon",
		});
		await deliver(
			t,
			disputeEvent({
				eventId: "evt_refundwon",
				type: "charge.dispute.closed",
				disputeId: "dp_refundwon",
				paymentIntentId: "pi_refundwon",
				status: "won",
				amount: 20_000,
			})
		);

		mockStripeClient.refunds.create.mockResolvedValueOnce({
			id: "re_after_win",
			status: "succeeded",
			amount: 22_400,
		});

		const result = await t.action(internal.stripe.createRefund, { paymentId, orderId });
		expect(result.refundId).toBe("re_after_win");
	});
});

describe("a refund issued from the Stripe Dashboard", () => {
	function refundedEvent(eventId: string, paymentIntentId: string) {
		return {
			id: eventId,
			type: "charge.refunded",
			created: 1_700_000_000,
			data: {
				object: {
					id: "ch_dispute",
					payment_intent: paymentIntentId,
					amount: 22_400,
					amount_captured: 22_400,
					amount_refunded: 22_400,
					refunded: true,
					currency: "mxn",
				},
			},
		};
	}

	it("raises a severe alert when the refund reversed no transfer", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t);
		const { paymentId } = await seedPaidOrder(t, {
			restaurantId,
			subtotal: 20_000,
			paymentIntentId: "pi_dashrefund",
		});

		mockStripeClient.refunds.list.mockResolvedValueOnce({
			data: [{ id: "re_dashboard", created: 1_700_000_500 }],
		});
		mockStripeClient.webhooks.constructEvent.mockReturnValueOnce(
			refundedEvent("evt_dashrefund", "pi_dashrefund")
		);
		await t.action(internal.stripe.fulfillPayment, {
			payloadString: "{}",
			signatureHeader: "sig",
		});

		const alerts = await t.run(async (ctx) => ctx.db.query("operatorAlerts").collect());
		expect(alerts).toHaveLength(1);
		expect(alerts[0]).toMatchObject({
			kind: OPERATOR_ALERT_KIND.DASHBOARD_REFUND,
			severity: OPERATOR_ALERT_SEVERITY.SEVERE,
			paymentId,
			restaurantId,
			dedupeKey: "dashboard_refund:re_dashboard",
		});

		// Detection only. A dashboard refund is a Tavli operator's own action, so
		// the answer is a human looking at it, not the next diner paying for it.
		const ledger = await t.run(async (ctx) => ctx.db.query("disputeRecoveries").collect());
		expect(ledger).toHaveLength(0);
	});

	it("stays quiet for a refund Tavli issued, which always reverses the transfer", async () => {
		const t = newTest();
		const restaurantId = await seedRestaurant(t);
		await seedPaidOrder(t, {
			restaurantId,
			subtotal: 20_000,
			paymentIntentId: "pi_apprefund",
		});

		mockStripeClient.refunds.list.mockResolvedValueOnce({
			data: [{ id: "re_app", created: 1_700_000_500, transfer_reversal: "trr_app" }],
		});
		mockStripeClient.webhooks.constructEvent.mockReturnValueOnce(
			refundedEvent("evt_apprefund", "pi_apprefund")
		);
		await t.action(internal.stripe.fulfillPayment, {
			payloadString: "{}",
			signatureHeader: "sig",
		});

		const alerts = await t.run(async (ctx) => ctx.db.query("operatorAlerts").collect());
		expect(alerts).toHaveLength(0);
	});
});
