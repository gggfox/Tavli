import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { AUDIT_EVENT, WHATSAPP_OPT_IN_SOURCE } from "../constants";
import { OPT_KEYWORD, matchOptKeyword } from "../whatsapp/optOut";

/**
 * Consent and opt-out for the WhatsApp assistant (WhatsApp Business Messaging
 * Policy, TAVLI-95).
 *
 * The rule under test: STOP/BAJA/ALTO from a phone is a revocation of consent
 * for the NUMBER — Tavli-wide, not per restaurant — and after the single
 * policy-required confirmation, an opted-out phone must cost nothing and
 * receive nothing: no budget charge, no routing, no model call, no reply.
 * START/ALTA reverses it with one confirmation and processes nothing else.
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

async function send(
	t: ReturnType<typeof convexTest>,
	args: { body: string; messageSid?: string; from?: string }
) {
	const res = await t.fetch("/whatsapp/inbound", {
		method: "POST",
		headers: INBOUND_HEADERS,
		body: new URLSearchParams({
			MessageSid: args.messageSid ?? "SM1",
			From: `whatsapp:${args.from ?? CUSTOMER}`,
			To: `whatsapp:${TAVLI_NUMBER}`,
			Body: args.body,
		}).toString(),
	});
	await t.finishAllScheduledFunctions(() => vi.runAllTimers());
	return res;
}

async function seedRestaurant(t: ReturnType<typeof convexTest>): Promise<Id<"restaurants">> {
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

/** A recent thread with the restaurant, so a codeless message cold-starts to it. */
async function seedPriorConversation(
	t: ReturnType<typeof convexTest>,
	restaurantId: Id<"restaurants">
) {
	await t.run(async (ctx) => {
		const channel = await ctx.db
			.query("whatsappChannels")
			.filter((q) => q.eq(q.field("restaurantId"), restaurantId))
			.first();
		const at = Date.now();
		await ctx.db.insert("whatsappConversations", {
			channelId: channel!._id,
			restaurantId,
			customerPhone: CUSTOMER,
			status: "active",
			locale: "es",
			lastMessageAt: at,
			lastInboundAt: at,
			createdAt: at,
			updatedAt: at,
		});
	});
}

function optOutRows(t: ReturnType<typeof convexTest>) {
	return t.run((ctx) => ctx.db.query("whatsappOptOuts").collect());
}

function auditEvents(t: ReturnType<typeof convexTest>, eventType: string) {
	return t.run(async (ctx) => {
		const all = await ctx.db.query("allEvents").collect();
		return all.filter((e) => e.eventType === eventType);
	});
}

/** What Twilio was actually asked to send. */
function sentBodies(fetchMock: ReturnType<typeof vi.fn>): string[] {
	return fetchMock.mock.calls.map(
		([, init]) =>
			new URLSearchParams(String((init as { body?: unknown } | undefined)?.body)).get("Body") ?? ""
	);
}

describe("opt-out keyword matching", () => {
	it("matches only when the trimmed message IS the keyword", () => {
		expect(matchOptKeyword("STOP")).toBe(OPT_KEYWORD.OPT_OUT);
		expect(matchOptKeyword("stop")).toBe(OPT_KEYWORD.OPT_OUT);
		expect(matchOptKeyword("Baja")).toBe(OPT_KEYWORD.OPT_OUT);
		expect(matchOptKeyword("ALTO")).toBe(OPT_KEYWORD.OPT_OUT);
		expect(matchOptKeyword("  alto.  ")).toBe(OPT_KEYWORD.OPT_OUT);
		expect(matchOptKeyword("Alto!")).toBe(OPT_KEYWORD.OPT_OUT);
		// Accent-insensitive: a Mexican keyboard autocorrects freely.
		expect(matchOptKeyword("bája")).toBe(OPT_KEYWORD.OPT_OUT);
	});

	it("matches the opt-in keywords the same way", () => {
		expect(matchOptKeyword("START")).toBe(OPT_KEYWORD.OPT_IN);
		expect(matchOptKeyword("alta")).toBe(OPT_KEYWORD.OPT_IN);
		expect(matchOptKeyword("Alta.")).toBe(OPT_KEYWORD.OPT_IN);
	});

	it("never treats a keyword buried in prose as an opt-out", () => {
		// "alto" is an everyday Spanish word; prose is conversation, not consent.
		expect(matchOptKeyword("el volumen está muy alto")).toBeNull();
		expect(matchOptKeyword("quiero dar de baja mi reserva")).toBeNull();
		expect(matchOptKeyword("stop it")).toBeNull();
		expect(matchOptKeyword("por favor alto")).toBeNull();
		expect(matchOptKeyword("ALTO123")).toBeNull();
		expect(matchOptKeyword("dame de alta en la lista")).toBeNull();
		expect(matchOptKeyword("")).toBeNull();
	});
});

describe("whatsapp consent and opt-out", () => {
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
		mockGenerateText.mockResolvedValue({ text: "¡Hola! ¿En qué te ayudo?", toolCalls: [] });

		fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sid: "SMout" }) });
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("STOP writes the opt-out, confirms once with the way back, and never reaches the model", async () => {
		const t = convexTest(schema, modules);
		await seedRestaurant(t);

		await send(t, { body: "STOP" });

		const rows = await optOutRows(t);
		expect(rows).toHaveLength(1);
		expect(rows[0].phone).toBe(CUSTOMER);

		const sent = sentBodies(fetchMock);
		expect(sent).toHaveLength(1);
		// Policy: the confirmation tells them how to return, in both languages —
		// there is no routed restaurant, so there is no locale to resolve.
		expect(sent[0]).toContain("ALTA");
		expect(sent[0]).toContain("START");

		expect(mockGenerateText).not.toHaveBeenCalled();
		expect(await auditEvents(t, AUDIT_EVENT.WHATSAPP_PHONE_OPTED_OUT)).toHaveLength(1);
	});

	it("repeating STOP while already opted out is silence, not another confirmation", async () => {
		const t = convexTest(schema, modules);
		await seedRestaurant(t);

		await send(t, { body: "STOP", messageSid: "SM-stop-1" });
		await send(t, { body: "ALTO", messageSid: "SM-stop-2" });

		expect(await optOutRows(t)).toHaveLength(1);
		expect(sentBodies(fetchMock)).toHaveLength(1);
	});

	it("drops every later message from an opted-out phone before budget, routing, or model work", async () => {
		const t = convexTest(schema, modules);
		await seedRestaurant(t);
		await send(t, { body: "STOP", messageSid: "SM-stop" });
		fetchMock.mockClear();

		// Even a perfectly routable message: valid short code, real restaurant.
		await send(t, { body: "Hola, quiero una mesa · VRN-8F3", messageSid: "SM-after" });

		expect(fetchMock).not.toHaveBeenCalled();
		expect(mockGenerateText).not.toHaveBeenCalled();
		expect(await t.run((ctx) => ctx.db.query("whatsappConversations").collect())).toHaveLength(0);
		// Cost nothing: no budget counter was charged for the dropped message.
		expect(await t.run((ctx) => ctx.db.query("rateLimits").collect())).toHaveLength(0);
	});

	it("ALTA from an opted-out phone clears the state, confirms once, and processes nothing else", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		await seedPriorConversation(t, restaurantId);
		await send(t, { body: "STOP", messageSid: "SM-stop" });
		fetchMock.mockClear();

		await send(t, { body: "ALTA", messageSid: "SM-alta" });

		expect(await optOutRows(t)).toHaveLength(0);
		const sent = sentBodies(fetchMock);
		expect(sent).toHaveLength(1);
		// One confirmation, and no model turn for the same message — even though
		// "ALTA" alone would have cold-started to the seeded restaurant.
		expect(mockGenerateText).not.toHaveBeenCalled();
		expect(await auditEvents(t, AUDIT_EVENT.WHATSAPP_PHONE_OPTED_IN)).toHaveLength(1);
	});

	it("treats START from a phone that never opted out as an ordinary message", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		await seedPriorConversation(t, restaurantId);

		await send(t, { body: "START" });

		// No transition to confirm — the message just goes to the assistant.
		expect(await optOutRows(t)).toHaveLength(0);
		expect(mockGenerateText).toHaveBeenCalledTimes(1);
	});

	it("records the deep-link opt-in on the conversation it creates", async () => {
		const t = convexTest(schema, modules);
		await seedRestaurant(t);

		await send(t, { body: "Hola, quiero información sobre Vernáculo · VRN-8F3" });

		const rows = await t.run((ctx) => ctx.db.query("whatsappConversations").collect());
		expect(rows).toHaveLength(1);
		expect(rows[0].optedInAt).toBeTypeOf("number");
		expect(rows[0].optedInSource).toBe(WHATSAPP_OPT_IN_SOURCE.DEEP_LINK);
	});

	it("records a cold-start opt-in when a conversation is created without a code", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const channelId = await t.run(async (ctx) => {
			const channel = await ctx.db
				.query("whatsappChannels")
				.filter((q) => q.eq(q.field("restaurantId"), restaurantId))
				.first();
			return channel!._id;
		});

		await t.mutation(internal.whatsapp.data.ingestInbound, {
			channelId,
			restaurantId,
			customerPhone: CUSTOMER,
			body: "hola",
			messageSid: "SM-cold",
			optInSource: WHATSAPP_OPT_IN_SOURCE.COLD_START,
		});

		const rows = await t.run((ctx) => ctx.db.query("whatsappConversations").collect());
		expect(rows).toHaveLength(1);
		expect(rows[0].optedInSource).toBe(WHATSAPP_OPT_IN_SOURCE.COLD_START);
	});

	it("keeps the message history on opt-out", async () => {
		const t = convexTest(schema, modules);
		await seedRestaurant(t);
		await send(t, { body: "Hola · VRN-8F3", messageSid: "SM-chat" });
		const before = await t.run((ctx) => ctx.db.query("whatsappMessages").collect());
		expect(before.length).toBeGreaterThan(0);

		await send(t, { body: "STOP", messageSid: "SM-stop" });

		const after = await t.run((ctx) => ctx.db.query("whatsappMessages").collect());
		expect(after.length).toBe(before.length);
	});
});
