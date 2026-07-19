import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { computeDisputeFacts, computeRefundFacts } from "../stripeWebhookHelpers";

const modules = import.meta.glob("../**/*.ts");

// Mirror the Stripe mock used in stripe.test.ts so `getStripeClient()` returns a
// controllable client and `webhooks.constructEvent` yields whatever event we set.
const mockStripeClient = {
	v2: {
		core: {
			accounts: { create: vi.fn(), retrieve: vi.fn() },
			accountLinks: { create: vi.fn() },
			events: { retrieve: vi.fn() },
		},
	},
	paymentIntents: { create: vi.fn(), retrieve: vi.fn() },
	refunds: { create: vi.fn() },
	webhooks: { constructEvent: vi.fn() },
	parseEventNotification: vi.fn(),
};

const StripeConstructor = vi.fn(() => mockStripeClient);

vi.mock("stripe", () => ({
	default: StripeConstructor,
}));

async function seedRestaurant(t: ReturnType<typeof convexTest>): Promise<Id<"restaurants">> {
	let restaurantId: Id<"restaurants">;
	await t.run(async (ctx) => {
		const organizationId = await ctx.db.insert("organizations", {
			name: "Refund Org",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner-1",
			organizationId,
			name: "Refund Test Restaurant",
			slug: `refund-${Math.random().toString(36).slice(2, 10)}`,
			currency: "USD",
			stripeAccountId: "acct_ref",
			stripeOnboardingComplete: true,
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});
	return restaurantId!;
}

async function seedPaidOrderPayment(
	t: ReturnType<typeof convexTest>,
	args: { restaurantId: Id<"restaurants">; amount: number; paymentIntentId: string }
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
			userId: "diner-1",
			status: "active",
			startedAt: Date.now(),
		});
		orderId = await ctx.db.insert("orders", {
			sessionId,
			restaurantId: args.restaurantId,
			tableId,
			status: "submitted",
			totalAmount: args.amount,
			paymentState: "paid",
			paidAt: Date.now(),
			submittedAt: Date.now(),
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		paymentId = await ctx.db.insert("payments", {
			restaurantId: args.restaurantId,
			orderId,
			amount: args.amount,
			currency: "usd",
			status: "succeeded",
			refundStatus: "none",
			attemptNumber: 1,
			stripePaymentIntentId: args.paymentIntentId,
			stripeChargeId: "ch_seed",
			succeededAt: Date.now(),
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

function refundChargeEvent(args: {
	eventId: string;
	paymentIntentId: string;
	amountCaptured: number;
	amountRefunded: number;
	refunded: boolean;
	refundId?: string;
	refundCreated?: number;
}) {
	return {
		id: args.eventId,
		type: "charge.refunded",
		created: 1_700_000_000,
		data: {
			object: {
				id: "ch_seed",
				payment_intent: args.paymentIntentId,
				amount: args.amountCaptured,
				amount_captured: args.amountCaptured,
				amount_refunded: args.amountRefunded,
				refunded: args.refunded,
				currency: "usd",
				refunds: {
					data: args.refundId
						? [{ id: args.refundId, created: args.refundCreated ?? 1_700_000_500 }]
						: [],
				},
			},
		},
	};
}

function disputeEvent(args: {
	eventId: string;
	type: "charge.dispute.created" | "charge.dispute.closed";
	disputeId: string;
	paymentIntentId: string;
	status: string;
	reason: string;
	amount: number;
	created?: number;
}) {
	return {
		id: args.eventId,
		type: args.type,
		created: args.created ?? 1_700_000_000,
		data: {
			object: {
				id: args.disputeId,
				charge: "ch_seed",
				payment_intent: args.paymentIntentId,
				amount: args.amount,
				currency: "usd",
				reason: args.reason,
				status: args.status,
				created: 1_699_999_000,
			},
		},
	};
}

describe("stripeWebhookHelpers (pure)", () => {
	it("computeRefundFacts marks a full refund as succeeded", () => {
		const facts = computeRefundFacts({
			payment_intent: "pi_1",
			amount: 2400,
			amount_captured: 2400,
			amount_refunded: 2400,
			refunded: true,
			currency: "usd",
			refunds: { data: [{ id: "re_1", created: 1_700_000_500 }] },
		});
		expect(facts.isFullyRefunded).toBe(true);
		expect(facts.refundStatus).toBe("succeeded");
		expect(facts.amountRefunded).toBe(2400);
		expect(facts.amountCaptured).toBe(2400);
		expect(facts.paymentIntentId).toBe("pi_1");
		expect(facts.latestRefundId).toBe("re_1");
		expect(facts.refundedAtMs).toBe(1_700_000_500_000);
	});

	it("computeRefundFacts marks a partial refund as partial", () => {
		const facts = computeRefundFacts({
			payment_intent: { id: "pi_2" },
			amount: 2400,
			amount_captured: 2400,
			amount_refunded: 1000,
			refunded: false,
			currency: "usd",
			refunds: { data: [{ id: "re_2", created: 1_700_000_600 }] },
		});
		expect(facts.isFullyRefunded).toBe(false);
		expect(facts.refundStatus).toBe("partial");
		expect(facts.amountRefunded).toBe(1000);
		expect(facts.paymentIntentId).toBe("pi_2");
	});

	it("computeDisputeFacts extracts reason/status/amount and lost flag", () => {
		const created = computeDisputeFacts({
			id: "dp_1",
			amount: 2400,
			currency: "usd",
			reason: "fraudulent",
			status: "needs_response",
			charge: "ch_1",
			payment_intent: "pi_3",
			created: 1_699_999_000,
		});
		expect(created).toMatchObject({
			disputeId: "dp_1",
			amount: 2400,
			reason: "fraudulent",
			status: "needs_response",
			chargeId: "ch_1",
			paymentIntentId: "pi_3",
			isLost: false,
		});

		const closedLost = computeDisputeFacts({
			id: "dp_1",
			amount: 2400,
			status: "lost",
			payment_intent: { id: "pi_3" },
		});
		expect(closedLost.isLost).toBe(true);
		expect(closedLost.reason).toBe("unknown");
	});
});

describe("charge.refunded / charge.dispute.* webhook handling", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.env.STRIPE_SECRET_KEY = "sk_test_123";
		process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
	});

	it("records a full refund on the payment and flips the order to refunded", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const { orderId, paymentId } = await seedPaidOrderPayment(t, {
			restaurantId,
			amount: 2400,
			paymentIntentId: "pi_full",
		});

		mockStripeClient.webhooks.constructEvent.mockReturnValue(
			refundChargeEvent({
				eventId: "evt_refund_full",
				paymentIntentId: "pi_full",
				amountCaptured: 2400,
				amountRefunded: 2400,
				refunded: true,
				refundId: "re_full",
			})
		);

		await t.action(internal.stripe.fulfillPayment, {
			payloadString: "{}",
			signatureHeader: "sig",
		});

		const payment = await t.run(async (ctx) => ctx.db.get(paymentId));
		expect(payment?.refundStatus).toBe("succeeded");
		expect(payment?.amountRefunded).toBe(2400);
		expect(payment?.stripeRefundId).toBe("re_full");
		expect(payment?.refundedAt).toBe(1_700_000_500_000);

		const order = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(order?.paymentState).toBe("refunded");

		const audits = await t.run(async (ctx) =>
			ctx.db
				.query("allEvents")
				.filter((q) => q.eq(q.field("eventType"), "payments.refundRecorded"))
				.collect()
		);
		expect(audits).toHaveLength(1);
	});

	it("records a partial refund without changing the order payment state", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const { orderId, paymentId } = await seedPaidOrderPayment(t, {
			restaurantId,
			amount: 2400,
			paymentIntentId: "pi_partial",
		});

		mockStripeClient.webhooks.constructEvent.mockReturnValue(
			refundChargeEvent({
				eventId: "evt_refund_partial",
				paymentIntentId: "pi_partial",
				amountCaptured: 2400,
				amountRefunded: 1000,
				refunded: false,
				refundId: "re_partial",
			})
		);

		await t.action(internal.stripe.fulfillPayment, {
			payloadString: "{}",
			signatureHeader: "sig",
		});

		const payment = await t.run(async (ctx) => ctx.db.get(paymentId));
		expect(payment?.refundStatus).toBe("partial");
		expect(payment?.amountRefunded).toBe(1000);
		expect(payment?.refundedAt).toBeUndefined();

		const order = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(order?.paymentState).toBe("paid");
	});

	it("persists a created dispute, then updates it on close", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const { paymentId } = await seedPaidOrderPayment(t, {
			restaurantId,
			amount: 5000,
			paymentIntentId: "pi_dispute",
		});

		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		mockStripeClient.webhooks.constructEvent.mockReturnValueOnce(
			disputeEvent({
				eventId: "evt_dispute_created",
				type: "charge.dispute.created",
				disputeId: "dp_flow",
				paymentIntentId: "pi_dispute",
				status: "needs_response",
				reason: "fraudulent",
				amount: 5000,
			})
		);
		await t.action(internal.stripe.fulfillPayment, {
			payloadString: "{}",
			signatureHeader: "sig",
		});

		let dispute = await t.run(async (ctx) =>
			ctx.db
				.query("stripeDisputes")
				.withIndex("by_dispute_id", (q) => q.eq("stripeDisputeId", "dp_flow"))
				.first()
		);
		expect(dispute).toMatchObject({
			status: "needs_response",
			reason: "fraudulent",
			amount: 5000,
			paymentId,
			restaurantId,
			stripePaymentIntentId: "pi_dispute",
		});
		expect(dispute?.openedAt).toBeDefined();
		expect(dispute?.closedAt).toBeUndefined();

		// The dispute must be logged loudly for dashboard visibility.
		expect(errorSpy.mock.calls.some((call) => String(call[0]).includes("CHARGE DISPUTE"))).toBe(
			true
		);

		mockStripeClient.webhooks.constructEvent.mockReturnValueOnce(
			disputeEvent({
				eventId: "evt_dispute_closed",
				type: "charge.dispute.closed",
				disputeId: "dp_flow",
				paymentIntentId: "pi_dispute",
				status: "lost",
				reason: "fraudulent",
				amount: 5000,
				created: 1_700_100_000,
			})
		);
		await t.action(internal.stripe.fulfillPayment, {
			payloadString: "{}",
			signatureHeader: "sig",
		});

		dispute = await t.run(async (ctx) =>
			ctx.db
				.query("stripeDisputes")
				.withIndex("by_dispute_id", (q) => q.eq("stripeDisputeId", "dp_flow"))
				.first()
		);
		expect(dispute?.status).toBe("lost");
		expect(dispute?.closedAt).toBe(1_700_100_000_000);

		const disputeRows = await t.run(async (ctx) => ctx.db.query("stripeDisputes").collect());
		expect(disputeRows).toHaveLength(1);

		errorSpy.mockRestore();
	});

	it("treats a duplicate refund delivery as a no-op", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const { paymentId } = await seedPaidOrderPayment(t, {
			restaurantId,
			amount: 2400,
			paymentIntentId: "pi_dup",
		});

		mockStripeClient.webhooks.constructEvent.mockReturnValue(
			refundChargeEvent({
				eventId: "evt_refund_dup",
				paymentIntentId: "pi_dup",
				amountCaptured: 2400,
				amountRefunded: 2400,
				refunded: true,
				refundId: "re_dup",
			})
		);

		await t.action(internal.stripe.fulfillPayment, {
			payloadString: "{}",
			signatureHeader: "sig",
		});
		await t.action(internal.stripe.fulfillPayment, {
			payloadString: "{}",
			signatureHeader: "sig",
		});

		const payment = await t.run(async (ctx) => ctx.db.get(paymentId));
		expect(payment?.refundStatus).toBe("succeeded");

		const audits = await t.run(async (ctx) =>
			ctx.db
				.query("allEvents")
				.filter((q) => q.eq(q.field("eventType"), "payments.refundRecorded"))
				.collect()
		);
		expect(audits).toHaveLength(1);

		const events = await t.run(async (ctx) => ctx.db.query("stripeWebhookEvents").collect());
		expect(events).toHaveLength(1);
	});

	it("treats a duplicate dispute delivery as a no-op", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		await seedPaidOrderPayment(t, {
			restaurantId,
			amount: 5000,
			paymentIntentId: "pi_dispute_dup",
		});

		vi.spyOn(console, "error").mockImplementation(() => {});

		mockStripeClient.webhooks.constructEvent.mockReturnValue(
			disputeEvent({
				eventId: "evt_dispute_dup",
				type: "charge.dispute.created",
				disputeId: "dp_dup",
				paymentIntentId: "pi_dispute_dup",
				status: "needs_response",
				reason: "product_not_received",
				amount: 5000,
			})
		);

		await t.action(internal.stripe.fulfillPayment, {
			payloadString: "{}",
			signatureHeader: "sig",
		});
		await t.action(internal.stripe.fulfillPayment, {
			payloadString: "{}",
			signatureHeader: "sig",
		});

		const disputeRows = await t.run(async (ctx) => ctx.db.query("stripeDisputes").collect());
		expect(disputeRows).toHaveLength(1);

		const audits = await t.run(async (ctx) =>
			ctx.db
				.query("allEvents")
				.filter((q) => q.eq(q.field("eventType"), "payments.disputeOpened"))
				.collect()
		);
		expect(audits).toHaveLength(1);
	});
});
