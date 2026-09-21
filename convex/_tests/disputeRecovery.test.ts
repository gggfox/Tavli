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

type TestConvex = ReturnType<typeof convexTest>;

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

function newTest(): TestConvex {
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

describe("won and reinstated", () => {
	async function seedLostAndRecovered(t: TestConvex, restaurantId: Id<"restaurants">) {
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

		// One transfer, whatever Stripe redelivers — and with the documented
		// idempotency key, so Stripe refuses a second one too.
		expect(mockStripeClient.transfers.create).toHaveBeenCalledTimes(1);
		expect(mockStripeClient.transfers.create).toHaveBeenCalledWith(
			expect.objectContaining({ amount: 7_000, destination: "acct_dispute", currency: "mxn" }),
			{ idempotencyKey: "dispute-recovery-return:dp_win" }
		);
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
