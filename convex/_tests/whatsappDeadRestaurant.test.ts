import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { WHATSAPP_INBOUND_DAILY_LIMIT } from "../constants";
import { inboundBudgetKey } from "../whatsapp/spendControls";

/**
 * A deleted or deactivated restaurant must stop answering (TAVLI-95).
 *
 * Soft-deleting a restaurant hides it from every dashboard, but its
 * `whatsappChannels` row survives — so before this fix the assistant kept
 * routing to it, greeting diners and answering menu questions for a business
 * that no longer exists. Three rules under test: short-code routing and
 * cold-start binding must skip a dead restaurant entirely (a diner must not
 * be auto-bound to one), and any message that still reaches the pipeline
 * bound to a dead restaurant gets honest fixed copy — never a model call.
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
	args: { deletedAt?: number; isActive?: boolean; shortCode?: string } = {}
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
			isActive: args.isActive ?? true,
			deletedAt: args.deletedAt,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		await ctx.db.insert("whatsappChannels", {
			restaurantId,
			shortCode: args.shortCode ?? SHORT_CODE,
			// The channel row is still enabled: exactly the state a soft delete
			// leaves behind, and the reason this class of bug existed.
			isActive: true,
			defaultLocale: "es",
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});
	return restaurantId!;
}

async function seedConversation(
	t: ReturnType<typeof convexTest>,
	restaurantId: Id<"restaurants">,
	args: { customerPhone?: string } = {}
): Promise<Id<"whatsappConversations">> {
	return await t.run(async (ctx) => {
		const channel = await ctx.db
			.query("whatsappChannels")
			.filter((q) => q.eq(q.field("restaurantId"), restaurantId))
			.first();
		const at = Date.now();
		return await ctx.db.insert("whatsappConversations", {
			channelId: channel!._id,
			restaurantId,
			customerPhone: args.customerPhone ?? CUSTOMER,
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

function sentBodies(fetchMock: ReturnType<typeof vi.fn>): string[] {
	return fetchMock.mock.calls.map(
		([, init]) =>
			new URLSearchParams(String((init as { body?: unknown } | undefined)?.body)).get("Body") ?? ""
	);
}

describe("whatsapp and dead restaurants", () => {
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

	it("short-code routing skips a soft-deleted restaurant — same reply as an unknown code", async () => {
		const t = convexTest(schema, modules);
		await seedRestaurant(t, { deletedAt: Date.now() });

		await send(t, { body: "Hola, quiero información · VRN-8F3" });

		// Not bound, not modeled — and the diner learns nothing about whether
		// this restaurant ever existed, exactly like an unrecognized code.
		expect(await conversations(t)).toHaveLength(0);
		expect(mockGenerateText).not.toHaveBeenCalled();
		expect(sentBodies(fetchMock)[0]).toContain("Soy el asistente de Tavli");
	});

	it("short-code routing skips a deactivated restaurant", async () => {
		const t = convexTest(schema, modules);
		await seedRestaurant(t, { isActive: false });

		await send(t, { body: "Hola · VRN-8F3" });

		expect(await conversations(t)).toHaveLength(0);
		expect(mockGenerateText).not.toHaveBeenCalled();
	});

	it("cold-start binding never binds a diner to a deleted restaurant", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, { deletedAt: Date.now() });
		await seedConversation(t, restaurantId);

		await send(t, { body: "¿a qué hora abren?" });

		// One recent restaurant in this phone's history, but it is dead: guidance,
		// not a resurrected thread.
		expect(mockGenerateText).not.toHaveBeenCalled();
		expect(sentBodies(fetchMock)[0]).toContain("Soy el asistente de Tavli");
	});

	it("cold-start binding never binds a diner to a deactivated restaurant", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, { isActive: false });
		await seedConversation(t, restaurantId);

		await send(t, { body: "¿a qué hora abren?" });

		expect(mockGenerateText).not.toHaveBeenCalled();
	});

	it("getRestaurantContext reports a deleted or deactivated restaurant as unavailable", async () => {
		const t = convexTest(schema, modules);
		const deleted = await seedRestaurant(t, { deletedAt: Date.now(), shortCode: "AAA111" });
		const inactive = await seedRestaurant(t, { isActive: false, shortCode: "BBB222" });
		const alive = await seedRestaurant(t, { shortCode: "CCC333" });

		const [deletedCtx, inactiveCtx, aliveCtx] = await Promise.all([
			t.query(internal.whatsapp.data.getRestaurantContext, { restaurantId: deleted }),
			t.query(internal.whatsapp.data.getRestaurantContext, { restaurantId: inactive }),
			t.query(internal.whatsapp.data.getRestaurantContext, { restaurantId: alive }),
		]);

		expect(deletedCtx?.unavailable).toBe(true);
		expect(inactiveCtx?.unavailable).toBe(true);
		expect(aliveCtx?.unavailable).toBe(false);
	});

	it("a message that still reaches the pipeline bound to a dead restaurant gets honest fixed copy, metered, no model", async () => {
		const t = convexTest(schema, modules);
		// The backstop scenario: the diner holds a live confirmation code, the
		// restaurant was deleted while it was outstanding, and the code row's
		// conversation pointer no longer matches the thread the message lands in
		// — so the code cannot be redeemed and the pipeline continues past it.
		const dead = await seedRestaurant(t, { deletedAt: Date.now() });
		const other = await seedRestaurant(t, { shortCode: "ZZZ999" });
		const otherConversation = await seedConversation(t, other, {
			customerPhone: "+15559990000",
		});
		const deadConversation = await seedConversation(t, dead);
		await t.run(async (ctx) => {
			await ctx.db.insert("whatsappPendingActions", {
				conversationId: otherConversation,
				restaurantId: dead,
				customerPhone: CUSTOMER,
				kind: "cancel_reservation",
				reservationId: (await ctx.db.insert("reservations", {
					restaurantId: dead,
					contact: { name: "Ana", phone: CUSTOMER },
					partySize: 2,
					startsAt: Date.now() + 60 * 60 * 1000,
					endsAt: Date.now() + 150 * 60 * 1000,
					tableIds: [],
					status: "pending",
					source: "whatsapp",
					createdAt: Date.now(),
					updatedAt: Date.now(),
				})) as Id<"reservations">,
				code: "481920",
				expiresAt: Date.now() + 10 * 60 * 1000,
				createdAt: Date.now(),
			});
		});

		await send(t, { body: "481920" });

		expect(mockGenerateText).not.toHaveBeenCalled();
		const sent = sentBodies(fetchMock);
		expect(sent).toHaveLength(1);
		// Honest, localized (the conversation is Spanish), and recorded in the
		// dead restaurant's conversation like any other metered reply.
		expect(sent[0]).toContain("ya no recibe mensajes");
		const messages = await t.run(async (ctx) => {
			const all = await ctx.db.query("whatsappMessages").collect();
			return all.filter((m) => m.conversationId === deadConversation);
		});
		expect(messages.some((m) => m.direction === "outbound")).toBe(true);
	});

	it("stays silent once the sender has spent their daily cap", async () => {
		const t = convexTest(schema, modules);
		await seedRestaurant(t, { deletedAt: Date.now() });
		// The unavailable reply is fixed copy, so it costs no model call — but it
		// is still a Twilio message. Placed above the per-phone refusal it escaped
		// the flood brake, so a dead restaurant became a cheaper thing to flood
		// than a live one.
		await t.run(async (ctx) => {
			await ctx.db.insert("rateLimits", {
				key: inboundBudgetKey(CUSTOMER),
				windowStart: Date.now(),
				count: WHATSAPP_INBOUND_DAILY_LIMIT.max,
				updatedAt: Date.now(),
			});
		});

		await send(t, { body: "Hola · VRN-8F3" });

		expect(sentBodies(fetchMock)).toHaveLength(0);
	});
});
