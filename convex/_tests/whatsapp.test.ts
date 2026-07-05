import { convexTest } from "convex-test";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

// The `twilio` SDK is Node-only and used for signature verification. Mock it so
// tests control accept/reject without real crypto or network.
const { mockValidateRequest } = vi.hoisted(() => ({ mockValidateRequest: vi.fn() }));
vi.mock("twilio", () => ({
	default: { validateRequest: mockValidateRequest },
}));

const SENDER = "+14155238886"; // restaurant's WhatsApp channel number
const CUSTOMER = "+15551230000";

function inboundBody(overrides: Record<string, string> = {}): string {
	return new URLSearchParams({
		MessageSid: "SM1",
		From: `whatsapp:${CUSTOMER}`,
		To: `whatsapp:${SENDER}`,
		Body: "Hello",
		...overrides,
	}).toString();
}

const INBOUND_HEADERS = {
	"x-twilio-signature": "test-signature",
	"content-type": "application/x-www-form-urlencoded",
};

async function seedChannel(
	t: ReturnType<typeof convexTest>,
	args: { phoneNumber: string; isActive?: boolean }
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
			name: "WA Restaurant",
			slug: `wa-${Math.random().toString(36).slice(2, 10)}`,
			currency: "MXN",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		await ctx.db.insert("whatsappChannels", {
			restaurantId,
			phoneNumber: args.phoneNumber,
			isActive: args.isActive ?? true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});
	return restaurantId!;
}

describe("whatsapp inbound webhook (M1 echo)", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		process.env.TWILIO_AUTH_TOKEN = "test-token";
		process.env.TWILIO_ACCOUNT_SID = "ACtest";
		process.env.TWILIO_WHATSAPP_NUMBER = SENDER;
		// Outbound send goes through global fetch (Twilio REST).
		fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sid: "SMout" }) });
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("rejects a request with no signature header (400) and stores nothing", async () => {
		const t = convexTest(schema, modules);
		await seedChannel(t, { phoneNumber: SENDER });

		const res = await t.fetch("/whatsapp/inbound", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: inboundBody(),
		});

		expect(res.status).toBe(400);
		const conversations = await t.run((ctx) => ctx.db.query("whatsappConversations").collect());
		expect(conversations).toHaveLength(0);
	});

	it("rejects an invalid signature (403) and does not process", async () => {
		const t = convexTest(schema, modules);
		await seedChannel(t, { phoneNumber: SENDER });
		mockValidateRequest.mockReturnValue(false);

		const res = await t.fetch("/whatsapp/inbound", {
			method: "POST",
			headers: INBOUND_HEADERS,
			body: inboundBody(),
		});
		await t.finishAllScheduledFunctions(() => vi.runAllTimers());

		expect(res.status).toBe(403);
		const messages = await t.run((ctx) => ctx.db.query("whatsappMessages").collect());
		expect(messages).toHaveLength(0);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("accepts a valid signed message, records it, and echoes a reply", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedChannel(t, { phoneNumber: SENDER });
		mockValidateRequest.mockReturnValue(true);

		const res = await t.fetch("/whatsapp/inbound", {
			method: "POST",
			headers: INBOUND_HEADERS,
			body: inboundBody(),
		});
		expect(res.status).toBe(200);

		await t.finishAllScheduledFunctions(() => vi.runAllTimers());

		const conversations = await t.run((ctx) => ctx.db.query("whatsappConversations").collect());
		expect(conversations).toHaveLength(1);
		expect(conversations[0]).toMatchObject({ restaurantId, customerPhone: CUSTOMER });

		const messages = await t.run((ctx) =>
			ctx.db.query("whatsappMessages").withIndex("by_conversation").collect()
		);
		const inbound = messages.filter((m) => m.direction === "inbound");
		const outbound = messages.filter((m) => m.direction === "outbound");
		expect(inbound).toHaveLength(1);
		expect(inbound[0]).toMatchObject({ messageSid: "SM1", body: "Hello" });
		expect(outbound).toHaveLength(1);
		expect(outbound[0].messageSid).toBe("SMout");

		// Outbound send hit the Twilio REST API with the customer's address.
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [, init] = fetchMock.mock.calls[0];
		expect(String(init?.body)).toContain(encodeURIComponent(`whatsapp:${CUSTOMER}`));
	});

	it("is idempotent: a repeated MessageSid stores one inbound and sends once", async () => {
		const t = convexTest(schema, modules);
		await seedChannel(t, { phoneNumber: SENDER });
		mockValidateRequest.mockReturnValue(true);

		for (let i = 0; i < 2; i++) {
			await t.fetch("/whatsapp/inbound", {
				method: "POST",
				headers: INBOUND_HEADERS,
				body: inboundBody({ MessageSid: "SM-dup" }),
			});
			await t.finishAllScheduledFunctions(() => vi.runAllTimers());
		}

		const inbound = await t.run((ctx) =>
			ctx.db
				.query("whatsappMessages")
				.withIndex("by_message_sid", (q) => q.eq("messageSid", "SM-dup"))
				.collect()
		);
		expect(inbound).toHaveLength(1);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("drops a message to an unknown/unmapped number without processing", async () => {
		const t = convexTest(schema, modules);
		await seedChannel(t, { phoneNumber: SENDER });
		mockValidateRequest.mockReturnValue(true);

		const res = await t.fetch("/whatsapp/inbound", {
			method: "POST",
			headers: INBOUND_HEADERS,
			body: inboundBody({ To: "whatsapp:+19999999999" }),
		});
		await t.finishAllScheduledFunctions(() => vi.runAllTimers());

		expect(res.status).toBe(200); // we still ack Twilio
		const conversations = await t.run((ctx) => ctx.db.query("whatsappConversations").collect());
		expect(conversations).toHaveLength(0);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("drops a message to an inactive channel", async () => {
		const t = convexTest(schema, modules);
		await seedChannel(t, { phoneNumber: SENDER, isActive: false });
		mockValidateRequest.mockReturnValue(true);

		await t.fetch("/whatsapp/inbound", {
			method: "POST",
			headers: INBOUND_HEADERS,
			body: inboundBody(),
		});
		await t.finishAllScheduledFunctions(() => vi.runAllTimers());

		const conversations = await t.run((ctx) => ctx.db.query("whatsappConversations").collect());
		expect(conversations).toHaveLength(0);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
