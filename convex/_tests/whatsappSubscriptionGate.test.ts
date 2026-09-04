import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { BILLING_STATUS, WHATSAPP_INBOUND_DAILY_LIMIT } from "../constants";
import { inboundBudgetKey } from "../whatsapp/spendControls";

/**
 * Subscription gating for the WhatsApp assistant (TAVLI-95).
 *
 * Every model turn is Tavli's money, so a restaurant whose platform
 * subscription has lapsed must not keep spending it. The predicate follows the
 * billing semantics the rest of the app already uses: the gate applies only
 * to restaurants ENROLLED in the platform subscription
 * (`platformSubscriptionEnabled`), and among those, only when a bound
 * subscription's `billingStatus` is no longer in good standing. Not enrolled
 * means not gated — enrollment is a commercial decision the operator makes,
 * not something the assistant infers. The lapsed reply is fixed copy through
 * the normal metered path: never silence, never a model call.
 */
const modules = import.meta.glob("../**/*.ts");

const { mockValidateRequest, mockGenerateText } = vi.hoisted(() => ({
	mockValidateRequest: vi.fn(),
	mockGenerateText: vi.fn(),
}));
vi.mock("twilio", () => ({ default: { validateRequest: mockValidateRequest } }));
vi.mock("ai", async (importOriginal) => {
	const actual = await importOriginal<typeof import("ai")>();
	return { ...actual, generateText: mockGenerateText };
});

const TAVLI_NUMBER = "+14155238886";
const CUSTOMER = "+15551230000";
const SHORT_CODE = "VRN8F3";

const INBOUND_HEADERS = {
	"x-twilio-signature": "test-signature",
	"content-type": "application/x-www-form-urlencoded",
};

async function send(t: ReturnType<typeof convexTest>, args: { body: string; messageSid?: string }) {
	const res = await t.fetch("/whatsapp/inbound", {
		method: "POST",
		headers: INBOUND_HEADERS,
		body: new URLSearchParams({
			MessageSid: args.messageSid ?? "SM1",
			From: `whatsapp:${CUSTOMER}`,
			To: `whatsapp:${TAVLI_NUMBER}`,
			Body: args.body,
		}).toString(),
	});
	await t.finishAllScheduledFunctions(() => vi.runAllTimers());
	return res;
}

async function seedRestaurant(
	t: ReturnType<typeof convexTest>,
	args: { platformSubscriptionEnabled?: boolean; billingStatus?: string } = {}
): Promise<Id<"restaurants">> {
	let restaurantId: Id<"restaurants">;
	await t.run(async (ctx) => {
		const organizationId = await ctx.db.insert("organizations", {
			name: "WA Org",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner-wa",
			organizationId,
			name: "Vernáculo",
			slug: `wa-${Math.random().toString(36).slice(2, 10)}`,
			currency: "MXN",
			defaultLanguage: "es",
			isActive: true,
			platformSubscriptionEnabled: args.platformSubscriptionEnabled,
			billingStatus: args.billingStatus,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		await ctx.db.insert("whatsappChannels", {
			restaurantId,
			shortCode: SHORT_CODE,
			isActive: true,
			defaultLocale: "es",
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});
	return restaurantId!;
}

function sentBodies(fetchMock: ReturnType<typeof vi.fn>): string[] {
	return fetchMock.mock.calls.map(
		([, init]) =>
			new URLSearchParams(String((init as { body?: unknown } | undefined)?.body)).get("Body") ?? ""
	);
}

describe("whatsapp subscription gating", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.useFakeTimers();
		process.env.TWILIO_AUTH_TOKEN = "test-token";
		process.env.TWILIO_ACCOUNT_SID = "ACtest";
		process.env.TWILIO_WHATSAPP_NUMBER = TAVLI_NUMBER;
		process.env.OPENROUTER_API_KEY = "test-openrouter";

		mockValidateRequest.mockReset();
		mockValidateRequest.mockReturnValue(true);
		mockGenerateText.mockReset();
		mockGenerateText.mockResolvedValue({ text: "¡Hola!", toolCalls: [] });

		fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sid: "SMout" }) });
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("a lapsed subscription gets fixed copy, recorded and metered, and no model call", async () => {
		const t = convexTest(schema, modules);
		await seedRestaurant(t, {
			platformSubscriptionEnabled: true,
			billingStatus: BILLING_STATUS.PAST_DUE,
		});

		await send(t, { body: "Hola, ¿tienen mesa? · VRN-8F3" });

		expect(mockGenerateText).not.toHaveBeenCalled();
		const sent = sentBodies(fetchMock);
		expect(sent).toHaveLength(1);
		expect(sent[0]).toContain("contacta directamente al restaurante");

		// Through the normal metered path: recorded in the conversation and
		// charged against the outbound budget — never a silent drop.
		const outbound = await t.run(async (ctx) => {
			const all = await ctx.db.query("whatsappMessages").collect();
			return all.filter((m) => m.direction === "outbound");
		});
		expect(outbound).toHaveLength(1);
		expect(await t.run((ctx) => ctx.db.query("rateLimits").collect())).not.toHaveLength(0);
	});

	it("gates a canceled subscription the same way", async () => {
		const t = convexTest(schema, modules);
		await seedRestaurant(t, {
			platformSubscriptionEnabled: true,
			billingStatus: BILLING_STATUS.CANCELED,
		});

		await send(t, { body: "Hola · VRN-8F3" });

		expect(mockGenerateText).not.toHaveBeenCalled();
		expect(sentBodies(fetchMock)).toHaveLength(1);
	});

	it("a restaurant not enrolled in the subscription is never gated", async () => {
		const t = convexTest(schema, modules);
		// Flag off/absent — even with a delinquent-looking status left behind.
		await seedRestaurant(t, { billingStatus: BILLING_STATUS.PAST_DUE });

		await send(t, { body: "Hola, ¿tienen mesa? · VRN-8F3" });

		expect(mockGenerateText).toHaveBeenCalledTimes(1);
	});

	it("enrolled and in good standing gets normal service", async () => {
		const t = convexTest(schema, modules);
		await seedRestaurant(t, {
			platformSubscriptionEnabled: true,
			billingStatus: BILLING_STATUS.ACTIVE,
		});

		await send(t, { body: "Hola, ¿tienen mesa? · VRN-8F3" });

		expect(mockGenerateText).toHaveBeenCalledTimes(1);
	});

	it("a trial counts as good standing", async () => {
		const t = convexTest(schema, modules);
		await seedRestaurant(t, {
			platformSubscriptionEnabled: true,
			billingStatus: BILLING_STATUS.TRIALING,
		});

		await send(t, { body: "Hola · VRN-8F3" });

		expect(mockGenerateText).toHaveBeenCalledTimes(1);
	});

	it("enrolled but not yet subscribed is not gated — the gate is about lapse, not onboarding", async () => {
		const t = convexTest(schema, modules);
		// An admin armed billing, the restaurant hasn't completed checkout yet:
		// no billingStatus exists to be lapsed.
		await seedRestaurant(t, { platformSubscriptionEnabled: true });

		await send(t, { body: "Hola · VRN-8F3" });

		expect(mockGenerateText).toHaveBeenCalledTimes(1);
	});

	it("does not answer a phone that has already spent its daily cap", async () => {
		const t = convexTest(schema, modules);
		await seedRestaurant(t, {
			platformSubscriptionEnabled: true,
			billingStatus: BILLING_STATUS.CANCELED,
		});
		// The lapsed reply is fixed copy, so it costs no model call — but it is
		// still a Twilio message Tavli pays for. Placed above the per-phone
		// refusal it escaped the flood brake entirely, which made a NON-PAYING
		// restaurant cost ~3x more per flooding phone than a paying one. That
		// inverts the gate's whole purpose.
		await t.run(async (ctx) => {
			await ctx.db.insert("rateLimits", {
				key: inboundBudgetKey(CUSTOMER),
				windowStart: Date.now(),
				count: WHATSAPP_INBOUND_DAILY_LIMIT.max,
				updatedAt: Date.now(),
			});
		});

		await send(t, { body: "Hola · VRN-8F3" });

		expect(mockGenerateText).not.toHaveBeenCalled();
		expect(sentBodies(fetchMock)).toHaveLength(0);
	});
});
