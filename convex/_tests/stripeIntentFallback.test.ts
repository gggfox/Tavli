/**
 * An off-session charge cannot lose its own webhook (TAVLI-105).
 *
 * `createTipCharge` charges a saved card with `off_session: true, confirm:
 * true`, so the money moves *inside* the create call. The payment row is
 * written before that call (it has to be — the intent's metadata carries its
 * id) and can only learn the intent id after it returns. If
 * `payment_intent.succeeded` beats that patch, the webhook's lookup by
 * `stripePaymentIntentId` found nothing, returned, and `fulfillPayment`
 * recorded the event as processed anyway — so every Stripe redelivery was
 * dropped by the dedup. The diner was charged, the tip was never recorded, and
 * the member was never credited.
 *
 * The fix is a second way to find the row: `paymentIntent.metadata.paymentId`,
 * which every intent Tavli creates carries (order, tab and tip alike). When the
 * fallback matches, the intent id is patched onto the row and the handler
 * continues exactly as it would have — amount assertion included.
 *
 * After the fallback, an unmatched `payment_intent.*` is genuinely not ours, and
 * the suite below pins which shapes of that get a severe operator alert (money
 * THIS deployment took and cannot account for) and which get a log: no
 * `paymentId` at all, and — the common case, because several deployments charge
 * one shared Stripe test account and all of them stamp `paymentId` — a
 * `metadata.deployment` marker naming somebody else.
 *
 * The other half of the same race is the create path resuming AFTER the webhook
 * settled the row. `stripeHelpers.attachIntentToPayment` is what keeps it from
 * overwriting `succeeded` with `processing`, and the ordering tests at the end
 * pin both directions.
 */
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { mockStripeClient } from "./_fixtures/stripeMock.fixture";

const modules = import.meta.glob("../**/*.ts");

vi.mock("stripe", async () => (await import("./_fixtures/stripeMock.fixture")).stripeModuleMock());

const DINER = "diner-fallback";

/**
 * Stands in for `CONVEX_CLOUD_URL`'s slug. `getDeploymentMarker()` reads
 * `process.env` at call time, so setting the URL in `beforeEach` is enough for
 * both the create sites and the webhook to agree on who "we" are.
 */
const OUR_DEPLOYMENT = "tavli-test-105";

async function seedRestaurant(t: ReturnType<typeof convexTest>): Promise<Id<"restaurants">> {
	let restaurantId: Id<"restaurants">;
	await t.run(async (ctx) => {
		const organizationId = await ctx.db.insert("organizations", {
			name: "Fallback Org",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner-fallback",
			organizationId,
			name: "Fallback Test Restaurant",
			slug: `fallback-${Math.random().toString(36).slice(2, 10)}`,
			currency: "USD",
			stripeAccountId: "acct_fallback",
			stripeOnboardingComplete: true,
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});
	return restaurantId!;
}

/**
 * A tip payment row in exactly the state the race leaves behind: `pending`,
 * `stripePaymentIntentId` unset, because Stripe has been called but has not
 * returned yet.
 */
async function seedTipPaymentAwaitingIntentId(
	t: ReturnType<typeof convexTest>,
	args: {
		restaurantId: Id<"restaurants">;
		tipAmount: number;
		/** Set only by the conflict test; absent is the racing state. */
		stripePaymentIntentId?: string;
	}
): Promise<{ sessionId: Id<"sessions">; paymentId: Id<"payments"> }> {
	let sessionId: Id<"sessions">;
	let paymentId: Id<"payments">;
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
			userId: DINER,
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
			paidByUserId: DINER,
			currency: "usd",
			status: "pending",
			refundStatus: "none",
			attemptNumber: 1,
			...(args.stripePaymentIntentId !== undefined && {
				stripePaymentIntentId: args.stripePaymentIntentId,
			}),
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});
	return { sessionId: sessionId!, paymentId: paymentId! };
}

/**
 * The order-path equivalent: a submitted, fully payable order whose `kind:
 * "order"` payment row is PENDING with no intent id. Less racy than the tip
 * (this intent is created unconfirmed, so the diner cannot have paid before the
 * id lands) but the fallback is one code path for all three kinds and the order
 * half should be pinned too.
 */
async function seedOrderPaymentAwaitingIntentId(
	t: ReturnType<typeof convexTest>,
	args: { restaurantId: Id<"restaurants">; subtotalAmount: number; feeAmount: number }
): Promise<{ orderId: Id<"orders">; paymentId: Id<"payments"> }> {
	let orderId: Id<"orders">;
	let paymentId: Id<"payments">;
	await t.run(async (ctx) => {
		const now = Date.now();
		const tableId = await ctx.db.insert("tables", {
			restaurantId: args.restaurantId,
			tableNumber: 12,
			isActive: true,
			createdAt: now,
		});
		const sessionId = await ctx.db.insert("sessions", {
			restaurantId: args.restaurantId,
			tableId,
			userId: DINER,
			status: "active",
			startedAt: now,
		});
		orderId = await ctx.db.insert("orders", {
			sessionId,
			restaurantId: args.restaurantId,
			tableId,
			status: "submitted",
			totalAmount: args.subtotalAmount,
			paymentState: "unpaid",
			submittedAt: now,
			createdAt: now,
			updatedAt: now,
		});

		const menuId = await ctx.db.insert("menus", {
			restaurantId: args.restaurantId,
			name: "Menu",
			isActive: true,
			displayOrder: 0,
			createdAt: now,
			updatedAt: now,
		});
		const categoryId = await ctx.db.insert("menuCategories", {
			menuId,
			restaurantId: args.restaurantId,
			name: "Cat",
			displayOrder: 0,
			createdAt: now,
			updatedAt: now,
		});
		const menuItemId = await ctx.db.insert("menuItems", {
			categoryId,
			restaurantId: args.restaurantId,
			name: "Birria",
			basePrice: args.subtotalAmount,
			isAvailable: true,
			displayOrder: 0,
			createdAt: now,
			updatedAt: now,
		});
		await ctx.db.insert("orderItems", {
			orderId,
			menuItemId,
			menuItemName: "Birria",
			quantity: 1,
			unitPrice: args.subtotalAmount,
			selectedOptions: [],
			lineTotal: args.subtotalAmount,
			createdAt: now,
		});

		const order = await ctx.db.get(orderId);
		paymentId = await ctx.db.insert("payments", {
			restaurantId: args.restaurantId,
			orderId,
			amount: args.subtotalAmount + args.feeAmount,
			subtotalAmount: args.subtotalAmount,
			feeAmount: args.feeAmount,
			kind: "order",
			paidByUserId: DINER,
			currency: "usd",
			status: "pending",
			refundStatus: "none",
			attemptNumber: 1,
			orderUpdatedAtSnapshot: order!.updatedAt,
			createdAt: now,
			updatedAt: now,
		});
		await ctx.db.patch(orderId, { activePaymentId: paymentId, paymentState: "pending" });
	});
	return { orderId: orderId!, paymentId: paymentId! };
}

function tipIntentEvent(args: {
	eventId: string;
	type: "payment_intent.succeeded" | "payment_intent.payment_failed";
	paymentIntentId: string;
	amount: number;
	/** Omitted entirely for the "somebody else's intent" case. */
	metadataPaymentId?: string;
	restaurantId?: Id<"restaurants">;
	/** `undefined` = an intent created before the marker existed. */
	deployment?: string;
}) {
	const succeeded = args.type === "payment_intent.succeeded";
	return {
		id: args.eventId,
		type: args.type,
		created: 1_700_000_000,
		data: {
			object: {
				id: args.paymentIntentId,
				amount: args.amount,
				...(succeeded ? { amount_received: args.amount } : {}),
				currency: "usd",
				...(succeeded ? { latest_charge: "ch_fallback", payment_method: "pm_fallback" } : {}),
				...(succeeded
					? {}
					: { last_payment_error: { code: "card_declined", message: "Your card was declined." } }),
				metadata: {
					kind: "tip",
					...(args.metadataPaymentId !== undefined && { paymentId: args.metadataPaymentId }),
					...(args.restaurantId !== undefined && { restaurantId: args.restaurantId }),
					...(args.deployment !== undefined && { deployment: args.deployment }),
				},
			},
		},
	};
}

async function alertsOf(t: ReturnType<typeof convexTest>) {
	return await t.run(async (ctx) => ctx.db.query("operatorAlerts").collect());
}

async function webhookEventsOf(t: ReturnType<typeof convexTest>) {
	return await t.run(async (ctx) => ctx.db.query("stripeWebhookEvents").collect());
}

async function tipAuditEventsOf(t: ReturnType<typeof convexTest>) {
	return await t.run(async (ctx) => {
		const events = await ctx.db.query("allEvents").collect();
		return events.filter((e) => e.eventType === "sessions.tipPaid");
	});
}

async function fulfill(t: ReturnType<typeof convexTest>) {
	await t.action(internal.stripe.fulfillPayment, {
		payloadString: "{}",
		signatureHeader: "sig",
	});
}

describe("payment_intent.* — metadata.paymentId fallback (TAVLI-105)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.env.STRIPE_SECRET_KEY = "sk_test_123";
		process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
		process.env.CONVEX_CLOUD_URL = `https://${OUR_DEPLOYMENT}.convex.cloud`;
	});

	it("records the tip and credits the member when the row has no intent id yet", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const { paymentId } = await seedTipPaymentAwaitingIntentId(t, {
			restaurantId,
			tipAmount: 2500,
		});

		mockStripeClient.webhooks.constructEvent.mockReturnValue(
			tipIntentEvent({
				eventId: "evt_tip_race",
				type: "payment_intent.succeeded",
				paymentIntentId: "pi_tip_race",
				amount: 2500,
				metadataPaymentId: paymentId,
				restaurantId,
				deployment: OUR_DEPLOYMENT,
			})
		);

		await fulfill(t);

		const payment = await t.run(async (ctx) => ctx.db.get(paymentId));
		expect(payment?.status).toBe("succeeded");
		// The patch the race lost: the row now names the intent it was charged on.
		expect(payment?.stripePaymentIntentId).toBe("pi_tip_race");
		expect(payment?.stripeChargeId).toBe("ch_fallback");
		expect(payment?.succeededAt).toBeGreaterThan(0);

		// Attribution is the point: this tip belongs to the member who paid it.
		const tipEvents = await tipAuditEventsOf(t);
		expect(tipEvents).toHaveLength(1);
		expect(tipEvents[0].payload).toMatchObject({
			paymentId,
			amount: 2500,
			paidByUserId: DINER,
		});

		// A matched event is not an incident.
		expect(await alertsOf(t)).toHaveLength(0);
	});

	it("keeps the TAVLI-69 amount assertion on the fallback path", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const { paymentId } = await seedTipPaymentAwaitingIntentId(t, {
			restaurantId,
			tipAmount: 2500,
		});

		mockStripeClient.webhooks.constructEvent.mockReturnValue(
			tipIntentEvent({
				eventId: "evt_tip_race_wrong_amount",
				type: "payment_intent.succeeded",
				paymentIntentId: "pi_tip_race_wrong",
				// The row expects 2500.
				amount: 9900,
				metadataPaymentId: paymentId,
				restaurantId,
				deployment: OUR_DEPLOYMENT,
			})
		);

		await fulfill(t);

		const payment = await t.run(async (ctx) => ctx.db.get(paymentId));
		expect(payment?.status).toBe("failed");
		expect(payment?.failureCode).toBe("amount_mismatch");
		expect(await tipAuditEventsOf(t)).toHaveLength(0);

		const alerts = await alertsOf(t);
		expect(alerts).toHaveLength(1);
		expect(alerts[0]).toMatchObject({
			kind: "payment_amount_mismatch",
			dedupeKey: `amount_mismatch:${paymentId}`,
		});
	});

	it("fails the tip row when the failure event arrives before the intent id was stored", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const { paymentId } = await seedTipPaymentAwaitingIntentId(t, {
			restaurantId,
			tipAmount: 1800,
		});

		mockStripeClient.webhooks.constructEvent.mockReturnValue(
			tipIntentEvent({
				eventId: "evt_tip_race_failed",
				type: "payment_intent.payment_failed",
				paymentIntentId: "pi_tip_race_failed",
				amount: 1800,
				metadataPaymentId: paymentId,
				restaurantId,
				deployment: OUR_DEPLOYMENT,
			})
		);

		await fulfill(t);

		const payment = await t.run(async (ctx) => ctx.db.get(paymentId));
		expect(payment?.status).toBe("failed");
		expect(payment?.stripePaymentIntentId).toBe("pi_tip_race_failed");
		expect(payment?.failureCode).toBe("card_declined");
		expect(await alertsOf(t)).toHaveLength(0);
	});

	it("refuses to steal a row that already names a different intent", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const { paymentId } = await seedTipPaymentAwaitingIntentId(t, {
			restaurantId,
			tipAmount: 2500,
			stripePaymentIntentId: "pi_the_real_one",
		});

		mockStripeClient.webhooks.constructEvent.mockReturnValue(
			tipIntentEvent({
				eventId: "evt_tip_conflict",
				type: "payment_intent.succeeded",
				paymentIntentId: "pi_an_imposter",
				amount: 2500,
				metadataPaymentId: paymentId,
				restaurantId,
				deployment: OUR_DEPLOYMENT,
			})
		);

		await fulfill(t);

		// Untouched: the row belongs to another intent and settling it here
		// would credit this tip against a charge it did not pay for.
		const payment = await t.run(async (ctx) => ctx.db.get(paymentId));
		expect(payment?.status).toBe("pending");
		expect(payment?.stripePaymentIntentId).toBe("pi_the_real_one");
		expect(await tipAuditEventsOf(t)).toHaveLength(0);

		const alerts = await alertsOf(t);
		expect(alerts).toHaveLength(1);
		expect(alerts[0]).toMatchObject({
			kind: "charge_unmatched",
			severity: "severe",
			status: "open",
			restaurantId,
			stripeObjectId: "pi_an_imposter",
			dedupeKey: "charge_unmatched:pi_an_imposter",
		});
	});

	it("alerts when the intent names a payment row that does not exist", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		// A row we stamped and then lost — a purged restaurant, or a paymentId
		// that never resolved. The money is ours and nothing records it.
		const { paymentId } = await seedTipPaymentAwaitingIntentId(t, {
			restaurantId,
			tipAmount: 2500,
		});
		await t.run(async (ctx) => ctx.db.delete(paymentId));

		mockStripeClient.webhooks.constructEvent.mockReturnValue(
			tipIntentEvent({
				eventId: "evt_tip_ghost",
				type: "payment_intent.succeeded",
				paymentIntentId: "pi_tip_ghost",
				amount: 2500,
				metadataPaymentId: paymentId,
				restaurantId,
				deployment: OUR_DEPLOYMENT,
			})
		);

		await fulfill(t);

		const alerts = await alertsOf(t);
		expect(alerts).toHaveLength(1);
		expect(alerts[0]).toMatchObject({
			kind: "charge_unmatched",
			severity: "severe",
			restaurantId,
			stripeObjectId: "pi_tip_ghost",
			dedupeKey: "charge_unmatched:pi_tip_ghost",
		});
		// Still recorded as processed: Stripe redelivering for days would not
		// change the answer, and the alert is what carries the problem to a human.
		const events = await webhookEventsOf(t);
		expect(events).toHaveLength(1);
		expect(events[0].eventId).toBe("evt_tip_ghost");
	});

	it("stays quiet for an intent that was never ours", async () => {
		const t = convexTest(schema, modules);
		await seedRestaurant(t);

		mockStripeClient.webhooks.constructEvent.mockReturnValue(
			tipIntentEvent({
				eventId: "evt_foreign",
				type: "payment_intent.succeeded",
				paymentIntentId: "pi_someone_elses",
				amount: 4200,
				// No `paymentId` at all: Tavli stamps one on every intent it
				// creates, so this came from another developer's test keys.
			})
		);

		await fulfill(t);

		expect(await alertsOf(t)).toHaveLength(0);
		const events = await webhookEventsOf(t);
		expect(events).toHaveLength(1);
		expect(events[0].eventId).toBe("evt_foreign");
	});

	it("is a no-op when the fallback-matched event is redelivered", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const { paymentId } = await seedTipPaymentAwaitingIntentId(t, {
			restaurantId,
			tipAmount: 2500,
		});

		mockStripeClient.webhooks.constructEvent.mockReturnValue(
			tipIntentEvent({
				eventId: "evt_tip_replay",
				type: "payment_intent.succeeded",
				paymentIntentId: "pi_tip_replay",
				amount: 2500,
				metadataPaymentId: paymentId,
				restaurantId,
				deployment: OUR_DEPLOYMENT,
			})
		);

		await fulfill(t);
		await fulfill(t);

		const payment = await t.run(async (ctx) => ctx.db.get(paymentId));
		expect(payment?.status).toBe("succeeded");
		// One tip, credited once — not two.
		expect(await tipAuditEventsOf(t)).toHaveLength(1);
		expect(await webhookEventsOf(t)).toHaveLength(1);
		expect(await alertsOf(t)).toHaveLength(0);
	});

	it("ignores an intent stamped by another deployment, even when the id resolves here", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const { paymentId } = await seedTipPaymentAwaitingIntentId(t, {
			restaurantId,
			tipAmount: 2500,
		});

		mockStripeClient.webhooks.constructEvent.mockReturnValue(
			tipIntentEvent({
				eventId: "evt_other_deployment",
				type: "payment_intent.succeeded",
				paymentIntentId: "pi_other_deployment",
				amount: 2500,
				// A real row id here, to prove the marker is checked BEFORE the
				// lookup: the other dev deployment and staging charge the same
				// Stripe test account and stamp `paymentId` too.
				metadataPaymentId: paymentId,
				restaurantId,
				deployment: "some-other-deployment",
			})
		);

		await fulfill(t);

		const payment = await t.run(async (ctx) => ctx.db.get(paymentId));
		expect(payment?.status).toBe("pending");
		expect(payment?.stripePaymentIntentId).toBeUndefined();
		// The whole point: no severe alert, so no email to every platform admin
		// every time somebody tests a tip on another deployment.
		expect(await alertsOf(t)).toHaveLength(0);
		expect(await webhookEventsOf(t)).toHaveLength(1);
	});

	it("still falls back for an unmarked intent, but will not alert on a miss", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const { paymentId } = await seedTipPaymentAwaitingIntentId(t, {
			restaurantId,
			tipAmount: 2500,
		});

		// No marker: an intent created by the code this replaced, in flight across
		// the deploy. The fallback must still place it — that is the charge this
		// ticket is about.
		mockStripeClient.webhooks.constructEvent.mockReturnValue(
			tipIntentEvent({
				eventId: "evt_unmarked_hit",
				type: "payment_intent.succeeded",
				paymentIntentId: "pi_unmarked_hit",
				amount: 2500,
				metadataPaymentId: paymentId,
				restaurantId,
			})
		);
		await fulfill(t);

		const payment = await t.run(async (ctx) => ctx.db.get(paymentId));
		expect(payment?.status).toBe("succeeded");
		expect(payment?.stripePaymentIntentId).toBe("pi_unmarked_hit");
		expect(await alertsOf(t)).toHaveLength(0);

		// Same shape, but naming a row that does not exist. Unattributable rather
		// than unaccounted-for, so it is logged, not alerted.
		await t.run(async (ctx) => ctx.db.delete(paymentId));
		mockStripeClient.webhooks.constructEvent.mockReturnValue(
			tipIntentEvent({
				eventId: "evt_unmarked_miss",
				type: "payment_intent.succeeded",
				paymentIntentId: "pi_unmarked_miss",
				amount: 2500,
				metadataPaymentId: paymentId,
				restaurantId,
			})
		);
		await fulfill(t);

		expect(await alertsOf(t)).toHaveLength(0);
		expect(await webhookEventsOf(t)).toHaveLength(2);
	});

	it("settles an order whose payment row has no intent id yet", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const { orderId, paymentId } = await seedOrderPaymentAwaitingIntentId(t, {
			restaurantId,
			subtotalAmount: 5000,
			feeAmount: 600,
		});

		mockStripeClient.webhooks.constructEvent.mockReturnValue({
			id: "evt_order_race",
			type: "payment_intent.succeeded",
			created: 1_700_000_000,
			data: {
				object: {
					id: "pi_order_race",
					amount: 5600,
					amount_received: 5600,
					currency: "usd",
					latest_charge: "ch_order_race",
					payment_method: "pm_order_race",
					metadata: {
						kind: "order",
						paymentId,
						restaurantId,
						deployment: OUR_DEPLOYMENT,
						gratuityAmount: "0",
					},
				},
			},
		});

		await fulfill(t);

		const { order, payment } = await t.run(async (ctx) => ({
			order: await ctx.db.get(orderId),
			payment: await ctx.db.get(paymentId),
		}));
		expect(payment?.status).toBe("succeeded");
		expect(payment?.stripePaymentIntentId).toBe("pi_order_race");
		expect(order?.paymentState).toBe("paid");
		expect(await alertsOf(t)).toHaveLength(0);
	});
});

/**
 * The create path's half of the race (TAVLI-105 review round 1).
 *
 * Fixing only the webhook would have moved the bug rather than closed it: with
 * the fallback in place the webhook can now settle a tip row while
 * `createTipCharge` is still waiting on `paymentIntents.create`, and the blind
 * `status: "processing"` patch that used to follow that call would have
 * overwritten `succeeded` — permanently, since the redeliveries are deduped and
 * no sweep covers tips.
 */
describe("attachIntentToPayment — the create path cannot undo a settlement", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.env.STRIPE_SECRET_KEY = "sk_test_123";
		process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
		process.env.CONVEX_CLOUD_URL = `https://${OUR_DEPLOYMENT}.convex.cloud`;
	});

	it("leaves a row the webhook already settled at succeeded", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const { paymentId } = await seedTipPaymentAwaitingIntentId(t, {
			restaurantId,
			tipAmount: 2500,
		});

		// Webhook first: the off-session charge has happened and Stripe delivered
		// before `paymentIntents.create` returned.
		mockStripeClient.webhooks.constructEvent.mockReturnValue(
			tipIntentEvent({
				eventId: "evt_webhook_first",
				type: "payment_intent.succeeded",
				paymentIntentId: "pi_webhook_first",
				amount: 2500,
				metadataPaymentId: paymentId,
				restaurantId,
				deployment: OUR_DEPLOYMENT,
			})
		);
		await fulfill(t);
		expect(await t.run(async (ctx) => (await ctx.db.get(paymentId))?.status)).toBe("succeeded");

		// createTipCharge now resumes and records the intent it charged.
		await t.mutation(internal.stripeHelpers.attachIntentToPayment, {
			paymentId,
			stripePaymentIntentId: "pi_webhook_first",
			stripePaymentMethodId: "pm_saved",
		});

		const payment = await t.run(async (ctx) => ctx.db.get(paymentId));
		// Not downgraded to processing: the tip stays credited.
		expect(payment?.status).toBe("succeeded");
		expect(payment?.stripePaymentIntentId).toBe("pi_webhook_first");
		expect(payment?.stripePaymentMethodId).toBe("pm_saved");
		expect(await tipAuditEventsOf(t)).toHaveLength(1);
	});

	it("moves a pending row to processing in the normal order, then settles", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const { paymentId } = await seedTipPaymentAwaitingIntentId(t, {
			restaurantId,
			tipAmount: 2500,
		});

		await t.mutation(internal.stripeHelpers.attachIntentToPayment, {
			paymentId,
			stripePaymentIntentId: "pi_normal_order",
			stripePaymentMethodId: "pm_saved",
		});
		const midFlight = await t.run(async (ctx) => ctx.db.get(paymentId));
		expect(midFlight?.status).toBe("processing");
		expect(midFlight?.stripePaymentIntentId).toBe("pi_normal_order");

		// The webhook then arrives and takes the index route, not the fallback.
		mockStripeClient.webhooks.constructEvent.mockReturnValue(
			tipIntentEvent({
				eventId: "evt_normal_order",
				type: "payment_intent.succeeded",
				paymentIntentId: "pi_normal_order",
				amount: 2500,
				metadataPaymentId: paymentId,
				restaurantId,
				deployment: OUR_DEPLOYMENT,
			})
		);
		await fulfill(t);

		expect(await t.run(async (ctx) => (await ctx.db.get(paymentId))?.status)).toBe("succeeded");
		expect(await alertsOf(t)).toHaveLength(0);
	});

	it("does not overwrite an intent id with a different one", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const { paymentId } = await seedTipPaymentAwaitingIntentId(t, {
			restaurantId,
			tipAmount: 2500,
			stripePaymentIntentId: "pi_the_real_one",
		});

		await t.mutation(internal.stripeHelpers.attachIntentToPayment, {
			paymentId,
			stripePaymentIntentId: "pi_an_imposter",
		});

		const payment = await t.run(async (ctx) => ctx.db.get(paymentId));
		expect(payment?.stripePaymentIntentId).toBe("pi_the_real_one");
		expect(payment?.status).toBe("pending");
	});
});
