import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { WHATSAPP_COLD_START_WINDOW_MS } from "../constants";

/**
 * Deep-link routing on Tavli's one shared WhatsApp number (ADR 012).
 *
 * The "To" number identifies nobody now, so these tests pin what identifies a
 * restaurant instead: the short code in the deep-link text, and — only when it
 * is unambiguous — the phone's own recent history. The negative cases matter
 * more than the positive one: what must NOT route is a restaurant name the
 * diner typed, and what must NOT happen on an unroutable message is a model
 * call.
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

/** Tavli's single sender number — no longer a routing input. */
const TAVLI_NUMBER = "+14155238886";
const CUSTOMER = "+15551230000";

const INBOUND_HEADERS = {
	"x-twilio-signature": "test-signature",
	"content-type": "application/x-www-form-urlencoded",
};

function inboundBody(args: { body: string; messageSid?: string; from?: string }): string {
	return new URLSearchParams({
		MessageSid: args.messageSid ?? "SM1",
		From: `whatsapp:${args.from ?? CUSTOMER}`,
		To: `whatsapp:${TAVLI_NUMBER}`,
		Body: args.body,
	}).toString();
}

async function send(
	t: ReturnType<typeof convexTest>,
	args: { body: string; messageSid?: string; from?: string }
) {
	const res = await t.fetch("/whatsapp/inbound", {
		method: "POST",
		headers: INBOUND_HEADERS,
		body: inboundBody(args),
	});
	await t.finishAllScheduledFunctions(() => vi.runAllTimers());
	return res;
}

async function seedRestaurant(
	t: ReturnType<typeof convexTest>,
	args: { name: string; shortCode?: string; isActive?: boolean; enabled?: boolean }
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
			name: args.name,
			slug: `wa-${Math.random().toString(36).slice(2, 10)}`,
			currency: "MXN",
			defaultLanguage: "es",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		if (args.enabled !== false) {
			await ctx.db.insert("whatsappChannels", {
				restaurantId,
				shortCode: args.shortCode,
				isActive: args.isActive ?? true,
				defaultLocale: "es",
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		}
	});
	return restaurantId!;
}

/** A thread this phone already had with a restaurant, `agoMs` in the past. */
async function seedPriorConversation(
	t: ReturnType<typeof convexTest>,
	restaurantId: Id<"restaurants">,
	agoMs = 0
) {
	await t.run(async (ctx) => {
		// `.filter` rather than `.withIndex`: `t` here is the un-parameterized
		// `ReturnType<typeof convexTest>`, so `ctx.db` has no schema and no named
		// indexes. One row per restaurant either way.
		const channel = await ctx.db
			.query("whatsappChannels")
			.filter((q) => q.eq(q.field("restaurantId"), restaurantId))
			.first();
		const at = Date.now() - agoMs;
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

function conversations(t: ReturnType<typeof convexTest>) {
	return t.run((ctx) => ctx.db.query("whatsappConversations").collect());
}

function outboundBodies(t: ReturnType<typeof convexTest>) {
	return t.run(async (ctx) => {
		const rows = await ctx.db.query("whatsappMessages").collect();
		return rows.filter((m) => m.direction === "outbound").map((m) => m.body);
	});
}

/** What Twilio was actually asked to send, whether or not it was recorded. */
function sentBodies(fetchMock: ReturnType<typeof vi.fn>): string[] {
	return fetchMock.mock.calls.map(
		([, init]) =>
			new URLSearchParams(String((init as { body?: unknown } | undefined)?.body)).get("Body") ?? ""
	);
}

describe("whatsapp deep-link routing", () => {
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

	it("routes by the short code in the prefilled text and strips it everywhere", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, { name: "Vernáculo", shortCode: "VRN8F3" });

		await send(t, { body: "Hola, quiero información sobre Vernáculo · VRN-8F3" });

		const rows = await conversations(t);
		expect(rows).toHaveLength(1);
		expect(rows[0].restaurantId).toBe(restaurantId);

		// Stored body: the routing token is plumbing, not part of what the diner said.
		const inbound = await t.run(async (ctx) => {
			const all = await ctx.db.query("whatsappMessages").collect();
			return all.filter((m) => m.direction === "inbound");
		});
		expect(inbound[0].body).toBe("Hola, quiero información sobre Vernáculo");

		// And the model is shown the same stripped text.
		const { messages } = mockGenerateText.mock.calls[0][0];
		const replayed = messages[messages.length - 1].content as string;
		expect(replayed).not.toContain("VRN");
		expect(replayed).toContain("Hola, quiero información sobre Vernáculo");
	});

	it("routes a code the diner retyped without the hyphen, in lower case", async () => {
		const t = convexTest(schema, modules);
		await seedRestaurant(t, { name: "Vernáculo", shortCode: "VRN8F3" });

		await send(t, { body: "hola vrn8f3" });

		expect(await conversations(t)).toHaveLength(1);
	});

	it("keeps one phone's two restaurants in separate conversations and separate context", async () => {
		const t = convexTest(schema, modules);
		const vernaculo = await seedRestaurant(t, { name: "Vernáculo", shortCode: "VRN8F3" });
		const sol = await seedRestaurant(t, { name: "El Sol", shortCode: "SLX2K7" });

		await send(t, { body: "¿tienen tacos? · VRN-8F3", messageSid: "SM-a" });
		await send(t, { body: "¿y ustedes? · SLX-2K7", messageSid: "SM-b" });

		const rows = await conversations(t);
		expect(rows).toHaveLength(2);
		expect(new Set(rows.map((r) => r.restaurantId))).toEqual(new Set([vernaculo, sol]));

		// The second restaurant's turn must not replay the first restaurant's
		// thread — that is the whole reason a single interleaved conversation was
		// rejected.
		const { messages } = mockGenerateText.mock.calls[1][0];
		const replayed = messages.map((m: { content: string }) => m.content).join("\n");
		expect(replayed).toContain("¿y ustedes?");
		expect(replayed).not.toContain("¿tienen tacos?");
	});

	it("binds a codeless message when this phone talked to exactly one restaurant", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, { name: "Vernáculo", shortCode: "VRN8F3" });
		await seedPriorConversation(t, restaurantId);

		await send(t, { body: "¿a qué hora abren?" });

		const rows = await conversations(t);
		expect(rows).toHaveLength(1);
		expect(rows[0].restaurantId).toBe(restaurantId);
		expect(mockGenerateText).toHaveBeenCalledTimes(1);
	});

	it("refuses to guess when this phone talked to two restaurants", async () => {
		const t = convexTest(schema, modules);
		const vernaculo = await seedRestaurant(t, { name: "Vernáculo", shortCode: "VRN8F3" });
		const sol = await seedRestaurant(t, { name: "El Sol", shortCode: "SLX2K7" });
		await seedPriorConversation(t, vernaculo, 60_000);
		await seedPriorConversation(t, sol, 30_000);

		await send(t, { body: "¿a qué hora abren?" });

		// Picking the most recent would silently send the question to the wrong kitchen.
		expect(mockGenerateText).not.toHaveBeenCalled();
		const sent = sentBodies(fetchMock);
		expect(sent).toHaveLength(1);
		expect(sent[0]).toContain("Soy el asistente de Tavli");
		expect(sent[0]).toContain("I'm the Tavli assistant");
	});

	it("treats a thread older than the cold-start window as cold", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, { name: "Vernáculo", shortCode: "VRN8F3" });
		await seedPriorConversation(t, restaurantId, WHATSAPP_COLD_START_WINDOW_MS + 60_000);

		await send(t, { body: "¿a qué hora abren?" });

		expect(mockGenerateText).not.toHaveBeenCalled();
		expect(sentBodies(fetchMock)[0]).toContain("Soy el asistente de Tavli");
	});

	it("answers an unroutable first contact with fixed copy and no model call", async () => {
		const t = convexTest(schema, modules);
		await seedRestaurant(t, { name: "Vernáculo", shortCode: "VRN8F3" });

		await send(t, { body: "hola" });

		expect(mockGenerateText).not.toHaveBeenCalled();
		expect(await conversations(t)).toHaveLength(0);
		expect(sentBodies(fetchMock)[0]).toContain("escanea su código QR");
	});

	it("never matches a restaurant by the name the diner typed", async () => {
		const t = convexTest(schema, modules);
		await seedRestaurant(t, { name: "Vernáculo", shortCode: "VRN8F3" });

		// Naming a restaurant must not be a way to reach it: that is an
		// enumeration and spoofing surface, and it is a hard requirement that it
		// stays closed.
		await send(t, { body: "Hola, quiero información sobre Vernáculo" });

		expect(mockGenerateText).not.toHaveBeenCalled();
		expect(await conversations(t)).toHaveLength(0);
		expect(sentBodies(fetchMock)[0]).toContain("Soy el asistente de Tavli");
	});

	it("does not route an unknown code, and says nothing about whether it exists", async () => {
		const t = convexTest(schema, modules);
		await seedRestaurant(t, { name: "Vernáculo", shortCode: "VRN8F3" });

		await send(t, { body: "hola ZZZ-9Q4" });

		expect(mockGenerateText).not.toHaveBeenCalled();
		// The same fixed copy an unroutable message gets: "no such code" and
		// "that restaurant is off" must be indistinguishable from outside.
		expect(sentBodies(fetchMock)[0]).toContain("Soy el asistente de Tavli");
		expect(sentBodies(fetchMock)[0]).not.toContain("ZZZ");
	});

	it("does not route a disabled restaurant's code", async () => {
		const t = convexTest(schema, modules);
		await seedRestaurant(t, { name: "Vernáculo", shortCode: "VRN8F3", isActive: false });

		await send(t, { body: "Hola · VRN-8F3" });

		expect(mockGenerateText).not.toHaveBeenCalled();
		expect(await conversations(t)).toHaveLength(0);
	});

	it("greets from fixed copy when the message was only the code", async () => {
		const t = convexTest(schema, modules);
		await seedRestaurant(t, { name: "Vernáculo", shortCode: "VRN8F3" });

		await send(t, { body: "VRN-8F3" });

		// A model call here would have no user message to answer at all.
		expect(mockGenerateText).not.toHaveBeenCalled();
		const bodies = await outboundBodies(t);
		expect(bodies).toHaveLength(1);
		expect(bodies[0]).toContain("Vernáculo");
		// Recorded against the conversation, unlike the unroutable reply.
		expect(await conversations(t)).toHaveLength(1);
	});

	it("keeps replying after the first deep-link message without the code", async () => {
		const t = convexTest(schema, modules);
		await seedRestaurant(t, { name: "Vernáculo", shortCode: "VRN8F3" });

		await send(t, { body: "Hola · VRN-8F3", messageSid: "SM-1" });
		// No code this time — the diner is just talking, which is the normal case
		// from message two onwards. The thread they just opened is what binds it.
		await send(t, { body: "¿y el menú?", messageSid: "SM-2" });

		expect(await conversations(t)).toHaveLength(1);
		expect(mockGenerateText).toHaveBeenCalledTimes(2);
	});
});

describe("whatsappChannels enablement", () => {
	async function seedAdmin(t: ReturnType<typeof convexTest>, userId: string) {
		await t.run(async (ctx) => {
			await ctx.db.insert("userRoles", {
				userId,
				roles: ["admin"],
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});
	}

	beforeEach(() => {
		process.env.TWILIO_WHATSAPP_NUMBER = TAVLI_NUMBER;
	});

	it("refuses to enable a restaurant for anyone but a platform admin", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, { name: "Vernáculo", enabled: false });

		await expect(
			t.mutation(api.whatsappChannels.setEnabled, { restaurantId, isActive: true })
		).rejects.toThrow();

		// Signed in, but not an admin: enabling spends Tavli's own money.
		const owner = t.withIdentity({ subject: "owner-wa" });
		await expect(
			owner.mutation(api.whatsappChannels.setEnabled, { restaurantId, isActive: true })
		).rejects.toThrow();
	});

	it("mints a readable code derived from the name and a working deep link", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, { name: "Vernáculo", enabled: false });
		await seedAdmin(t, "admin1");
		const admin = t.withIdentity({ subject: "admin1" });

		const result = await admin.mutation(api.whatsappChannels.setEnabled, {
			restaurantId,
			isActive: true,
		});

		expect(result?.shortCode.startsWith("VRN")).toBe(true);
		expect(result?.formattedShortCode).toBe(
			`${result?.shortCode.slice(0, 3)}-${result?.shortCode.slice(3)}`
		);
		expect(result?.deepLinkUrl).toContain("https://wa.me/14155238886?text=");
		expect(result?.deepLinkText).toContain("Vernáculo");
		expect(result?.deepLinkText).toContain(result!.formattedShortCode);
	});

	it("keeps the code when re-saving, because it is printed on tables", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, { name: "Vernáculo", enabled: false });
		await seedAdmin(t, "admin1");
		const admin = t.withIdentity({ subject: "admin1" });

		const first = await admin.mutation(api.whatsappChannels.setEnabled, {
			restaurantId,
			isActive: true,
		});
		const second = await admin.mutation(api.whatsappChannels.setEnabled, {
			restaurantId,
			isActive: false,
		});

		expect(second?.shortCode).toBe(first?.shortCode);
		expect(second?.isActive).toBe(false);
	});

	it("regenerating retires the old code immediately", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, { name: "Vernáculo", enabled: false });
		await seedAdmin(t, "admin1");
		const admin = t.withIdentity({ subject: "admin1" });

		const before = await admin.mutation(api.whatsappChannels.setEnabled, {
			restaurantId,
			isActive: true,
		});
		const after = await admin.mutation(api.whatsappChannels.regenerateShortCode, {
			restaurantId,
		});

		expect(after?.shortCode).not.toBe(before?.shortCode);
		const stored = await t.run(async (ctx) => {
			return await ctx.db
				.query("whatsappChannels")
				.withIndex("by_short_code", (q) => q.eq("shortCode", before!.shortCode))
				.first();
		});
		expect(stored).toBeNull();
	});

	it("publishes the link by slug for the public page, but only while active", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, { name: "Vernáculo", shortCode: "VRN8F3" });
		const slug = await t.run(async (ctx) => (await ctx.db.get(restaurantId))!.slug);

		const published = await t.query(api.whatsappChannels.getPublicBySlug, { slug });
		expect(published?.formattedShortCode).toBe("VRN-8F3");
		expect(published?.deepLinkUrl).toContain("wa.me");

		await t.run(async (ctx) => {
			const channel = await ctx.db
				.query("whatsappChannels")
				.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
				.first();
			await ctx.db.patch(channel!._id, { isActive: false });
		});
		expect(await t.query(api.whatsappChannels.getPublicBySlug, { slug })).toBeNull();
	});
});
