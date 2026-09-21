/**
 * V2 connected-account lifecycle thin events (TAVLI-65).
 *
 * The Connect destination is subscribed to all 15 `v2.core.account*` types but
 * only ever acted on two of them, so an account Stripe closed stayed
 * `stripeOnboardingComplete: true` in Convex and the payment gates kept
 * creating intents against a dead account. These tests pin the three
 * behaviours that fixes: a closure lands on the restaurant, a replayed
 * delivery is a no-op, and a type we deliberately ignore is logged rather than
 * warned about.
 *
 * Everything here runs against the shared Stripe mock — thin events are parsed
 * by `parseEventNotification` and the versioned event is re-fetched through
 * `v2.core.events.retrieve`, both of which the fixture stubs.
 */
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { mockStripeClient } from "./_fixtures/stripeMock.fixture";

const modules = import.meta.glob("../**/*.ts");

vi.mock("stripe", async () => (await import("./_fixtures/stripeMock.fixture")).stripeModuleMock());

/**
 * The shape `parseEventNotification` hands back for a thin event: an id, a
 * type, and a reference to the object the event is about. No `data.object` —
 * that is the whole point of a thin payload.
 */
function thinNotification(type: string, args: { eventId: string; accountId: string }) {
	return {
		id: args.eventId,
		object: "v2.core.event",
		type,
		created: new Date().toISOString(),
		related_object: {
			id: args.accountId,
			type: "v2.core.account",
			url: `/v2/core/accounts/${args.accountId}`,
		},
	};
}

async function seedConnectedRestaurant(
	t: ReturnType<typeof convexTest>,
	args: { stripeAccountId: string; stripeOnboardingComplete?: boolean }
) {
	let restaurantId: Id<"restaurants">;
	await t.run(async (ctx) => {
		const organizationId = await ctx.db.insert("organizations", {
			name: "Lifecycle Org",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner-lifecycle",
			organizationId,
			name: "Lifecycle Restaurant",
			slug: `lifecycle-${Math.random().toString(36).slice(2, 10)}`,
			currency: "MXN",
			stripeAccountId: args.stripeAccountId,
			stripeOnboardingComplete: args.stripeOnboardingComplete ?? true,
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});
	return restaurantId!;
}

describe("v2.core.account thin events (TAVLI-65)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.env.STRIPE_SECRET_KEY = "sk_test_123";
		process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
		process.env.STRIPE_CONNECT_WEBHOOK_SECRET = "whsec_connect_test";
	});

	it("marks a closed account closed, keeps its account id, and raises one severe alert", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedConnectedRestaurant(t, { stripeAccountId: "acct_closed_1" });

		const notification = thinNotification("v2.core.account.closed", {
			eventId: "evt_closed_1",
			accountId: "acct_closed_1",
		});
		mockStripeClient.parseEventNotification.mockReturnValueOnce(notification);
		mockStripeClient.v2.core.events.retrieve.mockResolvedValueOnce({
			...notification,
			context: null,
		});

		await t.action(internal.stripe.handleThinEvent, {
			payloadString: JSON.stringify(notification),
			signatureHeader: "sig_closed_1",
		});

		const restaurant = await t.run(async (ctx) => ctx.db.get(restaurantId));
		expect(restaurant?.stripeOnboardingComplete).toBe(false);
		expect(restaurant?.stripeAccountStatus).toBe("closed");
		// The id is the operator's handle on the dead account in the Stripe
		// Dashboard — a closure is not an unlink.
		expect(restaurant?.stripeAccountId).toBe("acct_closed_1");

		const alerts = await t.run(async (ctx) => ctx.db.query("operatorAlerts").collect());
		expect(alerts).toHaveLength(1);
		expect(alerts[0]).toMatchObject({
			kind: "account_closed",
			severity: "severe",
			status: "open",
			restaurantId,
			stripeObjectId: "acct_closed_1",
			dedupeKey: "account_closed:acct_closed_1",
		});

		// The versioned event is fetched, not trusted from the unsigned payload.
		expect(mockStripeClient.v2.core.events.retrieve).toHaveBeenCalledWith("evt_closed_1");
	});

	it("is a no-op when the same closure event is delivered twice", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedConnectedRestaurant(t, { stripeAccountId: "acct_closed_2" });

		const notification = thinNotification("v2.core.account.closed", {
			eventId: "evt_closed_2",
			accountId: "acct_closed_2",
		});
		mockStripeClient.parseEventNotification.mockReturnValue(notification);
		mockStripeClient.v2.core.events.retrieve.mockResolvedValue({ ...notification, context: null });

		await t.action(internal.stripe.handleThinEvent, {
			payloadString: JSON.stringify(notification),
			signatureHeader: "sig_closed_2",
		});
		await t.action(internal.stripe.handleThinEvent, {
			payloadString: JSON.stringify(notification),
			signatureHeader: "sig_closed_2",
		});

		// One dedup row, one alert, and the second delivery never re-fetched the
		// event — it returned before touching Stripe.
		const { events, alerts } = await t.run(async (ctx) => ({
			events: await ctx.db.query("stripeWebhookEvents").collect(),
			alerts: await ctx.db.query("operatorAlerts").collect(),
		}));
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			eventId: "evt_closed_2",
			eventType: "v2.core.account.closed",
		});
		expect(alerts).toHaveLength(1);
		expect(mockStripeClient.v2.core.events.retrieve).toHaveBeenCalledTimes(1);

		const restaurant = await t.run(async (ctx) => ctx.db.get(restaurantId));
		expect(restaurant?.stripeAccountStatus).toBe("closed");
	});

	it("logs and returns for a deliberately ignored type without touching the restaurant", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedConnectedRestaurant(t, { stripeAccountId: "acct_ignored" });
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const notification = thinNotification("v2.core.account_person.created", {
			eventId: "evt_person_1",
			accountId: "acct_ignored",
		});
		mockStripeClient.parseEventNotification.mockReturnValueOnce(notification);

		await t.action(internal.stripe.handleThinEvent, {
			payloadString: JSON.stringify(notification),
			signatureHeader: "sig_person_1",
		});

		expect(mockStripeClient.v2.core.events.retrieve).not.toHaveBeenCalled();
		expect(mockStripeClient.v2.core.accounts.retrieve).not.toHaveBeenCalled();
		expect(warnSpy).not.toHaveBeenCalled();
		expect(logSpy.mock.calls.flat().join(" ")).toContain("v2.core.account_person.created");

		const restaurant = await t.run(async (ctx) => ctx.db.get(restaurantId));
		expect(restaurant?.stripeOnboardingComplete).toBe(true);
		expect(restaurant?.stripeAccountStatus).toBeUndefined();

		// Ignored types are still recorded, so a redelivery does not re-log.
		const events = await t.run(async (ctx) => ctx.db.query("stripeWebhookEvents").collect());
		expect(events).toHaveLength(1);

		logSpy.mockRestore();
		warnSpy.mockRestore();
	});

	it("warns on a type the handler has never heard of", async () => {
		const t = convexTest(schema, modules);
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const notification = thinNotification("v2.core.account.teleported", {
			eventId: "evt_unknown_1",
			accountId: "acct_unknown",
		});
		mockStripeClient.parseEventNotification.mockReturnValueOnce(notification);

		await t.action(internal.stripe.handleThinEvent, {
			payloadString: JSON.stringify(notification),
			signatureHeader: "sig_unknown_1",
		});

		expect(warnSpy.mock.calls.flat().join(" ")).toContain("v2.core.account.teleported");
		warnSpy.mockRestore();
	});

	it("still refreshes onboarding state for the two handled status types", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedConnectedRestaurant(t, {
			stripeAccountId: "acct_requirements",
			stripeOnboardingComplete: false,
		});

		for (const [index, type] of [
			"v2.core.account[requirements].updated",
			"v2.core.account[configuration.recipient].capability_status_updated",
		].entries()) {
			const notification = thinNotification(type, {
				eventId: `evt_status_${index}`,
				accountId: "acct_requirements",
			});
			mockStripeClient.parseEventNotification.mockReturnValueOnce(notification);
			mockStripeClient.v2.core.accounts.retrieve.mockResolvedValueOnce({
				id: "acct_requirements",
				configuration: {
					recipient: {
						capabilities: { stripe_balance: { stripe_transfers: { status: "active" } } },
					},
				},
				requirements: { summary: { minimum_deadline: { status: "currently_due" } } },
			});

			await t.action(internal.stripe.handleThinEvent, {
				payloadString: JSON.stringify(notification),
				signatureHeader: `sig_status_${index}`,
			});
		}

		// Transfers active but requirements outstanding → not complete, and the
		// account reads as restricted rather than closed or absent.
		const restaurant = await t.run(async (ctx) => ctx.db.get(restaurantId));
		expect(restaurant?.stripeOnboardingComplete).toBe(false);
		expect(restaurant?.stripeAccountStatus).toBe("restricted");
		expect(mockStripeClient.v2.core.accounts.retrieve).toHaveBeenCalledTimes(2);
	});

	it("falls back to the signed notification when the versioned event cannot be fetched", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedConnectedRestaurant(t, { stripeAccountId: "acct_no_event" });
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const notification = thinNotification("v2.core.account.closed", {
			eventId: "evt_gone",
			accountId: "acct_no_event",
		});
		mockStripeClient.parseEventNotification.mockReturnValueOnce(notification);
		// Events are only readable for a limited window; a redelivered old
		// closure 404s here. The closure is still real — the signed notification
		// said which account it was — so it must not become a silent no-op.
		mockStripeClient.v2.core.events.retrieve.mockRejectedValueOnce(
			Object.assign(new Error("No such event: evt_gone"), { statusCode: 404 })
		);

		await t.action(internal.stripe.handleThinEvent, {
			payloadString: JSON.stringify(notification),
			signatureHeader: "sig_gone",
		});

		const restaurant = await t.run(async (ctx) => ctx.db.get(restaurantId));
		expect(restaurant?.stripeAccountStatus).toBe("closed");
		expect(restaurant?.stripeOnboardingComplete).toBe(false);

		const alerts = await t.run(async (ctx) => ctx.db.query("operatorAlerts").collect());
		expect(alerts).toHaveLength(1);
		expect(alerts[0]?.stripeObjectId).toBe("acct_no_event");
		// The fallback is logged, not swallowed.
		expect(warnSpy.mock.calls.flat().join(" ")).toContain("falling back");
		warnSpy.mockRestore();
	});

	describe("POST /stripe/connect-webhook status codes", () => {
		it("answers 500 when the signing secret is not configured, not 400", async () => {
			const t = convexTest(schema, modules);
			// The state every deployment is in until somebody sets it.
			delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
			const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

			const response = await t.fetch("/stripe/connect-webhook", {
				method: "POST",
				headers: { "stripe-signature": "sig_whatever" },
				body: "{}",
			});

			// 400 would read as "Stripe sent something we rejected" and send the
			// operator hunting a wrong secret when there is no secret at all.
			expect(response.status).toBe(500);
			errorSpy.mockRestore();
		});

		it("answers 400 when the delivery itself fails signature verification", async () => {
			const t = convexTest(schema, modules);
			const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
			mockStripeClient.parseEventNotification.mockImplementationOnce(() => {
				throw new Error("Invalid signature");
			});

			const response = await t.fetch("/stripe/connect-webhook", {
				method: "POST",
				headers: { "stripe-signature": "sig_bad" },
				body: "{}",
			});

			expect(response.status).toBe(400);
			const events = await t.run(async (ctx) => ctx.db.query("stripeWebhookEvents").collect());
			expect(events).toHaveLength(0);
			errorSpy.mockRestore();
		});
	});

	/**
	 * The v1 snapshot route shares the marker and therefore the same contract.
	 * Its secret IS set everywhere, so this is the regression that would
	 * otherwise go unnoticed: the two routes' triage must not drift apart.
	 */
	describe("POST /stripe/webhook status codes", () => {
		it("answers 500 when STRIPE_WEBHOOK_SECRET is not configured", async () => {
			const t = convexTest(schema, modules);
			delete process.env.STRIPE_WEBHOOK_SECRET;
			const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

			const response = await t.fetch("/stripe/webhook", {
				method: "POST",
				headers: { "stripe-signature": "sig_whatever" },
				body: "{}",
			});

			expect(response.status).toBe(500);
			errorSpy.mockRestore();
		});

		it("answers 400 when the delivery itself fails signature verification", async () => {
			const t = convexTest(schema, modules);
			process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
			const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
			mockStripeClient.webhooks.constructEvent.mockImplementationOnce(() => {
				throw new Error("Invalid signature");
			});

			const response = await t.fetch("/stripe/webhook", {
				method: "POST",
				headers: { "stripe-signature": "sig_bad" },
				body: "{}",
			});

			expect(response.status).toBe(400);
			const events = await t.run(async (ctx) => ctx.db.query("stripeWebhookEvents").collect());
			expect(events).toHaveLength(0);
			errorSpy.mockRestore();
		});
	});

	it("never promotes a closed account back to active on a later status event", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedConnectedRestaurant(t, { stripeAccountId: "acct_reopened" });
		await t.mutation(internal.stripeHelpers.markStripeAccountClosedByAccountId, {
			stripeAccountId: "acct_reopened",
		});

		const notification = thinNotification("v2.core.account[requirements].updated", {
			eventId: "evt_after_close",
			accountId: "acct_reopened",
		});
		mockStripeClient.parseEventNotification.mockReturnValueOnce(notification);
		mockStripeClient.v2.core.accounts.retrieve.mockResolvedValueOnce({
			id: "acct_reopened",
			configuration: {
				recipient: { capabilities: { stripe_balance: { stripe_transfers: { status: "active" } } } },
			},
			requirements: { summary: { minimum_deadline: { status: "verified" } } },
		});

		await t.action(internal.stripe.handleThinEvent, {
			payloadString: JSON.stringify(notification),
			signatureHeader: "sig_after_close",
		});

		const restaurant = await t.run(async (ctx) => ctx.db.get(restaurantId));
		expect(restaurant?.stripeAccountStatus).toBe("closed");
		expect(restaurant?.stripeOnboardingComplete).toBe(false);
	});
});
