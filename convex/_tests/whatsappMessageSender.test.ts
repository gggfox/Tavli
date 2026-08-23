/**
 * Who sent an outbound WhatsApp message (TAVLI-93).
 *
 * The staff conversation view is read-only, but handover — a human taking the
 * thread over from the assistant — is the obvious next build, and it needs to
 * know which outbound rows a person wrote. Recording that only when handover
 * ships would leave every message written before it permanently ambiguous, so
 * the field goes in now.
 *
 * These tests pin the two cases that rule out deriving the sender from
 * `modelBody` instead of storing it:
 *
 *   1. The tail parts of a long assistant reply carry `modelBody: ""` on
 *      purpose (only the first part replays as context), yet the assistant is
 *      still who said them.
 *   2. Server-composed copy — the apology, the cap notice, a confirmation —
 *      also carries `modelBody: ""`, and is *not* the assistant.
 *
 * Derivation cannot tell those apart, and it has no third value for "staff" at
 * all, which is the one the next build needs.
 *
 * The last test pins the case the two above straddle: a reply with a body but
 * no model prose. When a turn ends on a tool step, the notice that tool pushed
 * IS the whole reply, and it is server copy — so attribution follows
 * `result.text`, not whether anything was sent.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
	WHATSAPP_MAX_OUTBOUND_BODY_CHARS,
	WHATSAPP_MESSAGE_SENDER,
	WHATSAPP_OUTBOUND_DAILY_LIMIT,
} from "../constants";
import schema from "../schema";
import { getBotCopy } from "../whatsapp/copy";
import { outboundBudgetKey } from "../whatsapp/spendControls";

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

const SENDER = "+14155238886";
const CUSTOMER = "+15551230000";
/** ADR 012 routes on this, not on the "To" number. */
const SHORT_CODE = "SND4X2";

const INBOUND_HEADERS = {
	"x-twilio-signature": "test-signature",
	"content-type": "application/x-www-form-urlencoded",
};

function inboundBody(overrides: Record<string, string> = {}): string {
	return new URLSearchParams({
		MessageSid: "SM1",
		From: `whatsapp:${CUSTOMER}`,
		To: `whatsapp:${SENDER}`,
		Body: `hola, ¿qué tienen? · ${SHORT_CODE}`,
		...overrides,
	}).toString();
}

type ToolMap = Record<string, { execute: (i: unknown, o: unknown) => Promise<unknown> }>;

async function seedChannel(t: ReturnType<typeof convexTest>): Promise<Id<"restaurants">> {
	let restaurantId: Id<"restaurants">;
	await t.run(async (ctx) => {
		const organizationId = await ctx.db.insert("organizations", {
			name: "Sender Org",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner-sender",
			organizationId,
			name: "Sender Restaurant",
			slug: `sender-${Math.random().toString(36).slice(2, 10)}`,
			currency: "MXN",
			timezone: "America/Mexico_City",
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

function outboundRows(t: ReturnType<typeof convexTest>) {
	return t.run(async (ctx) =>
		(await ctx.db.query("whatsappMessages").collect()).filter((m) => m.direction === "outbound")
	);
}

describe("outbound sender", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		process.env.TWILIO_AUTH_TOKEN = "test-token";
		process.env.TWILIO_ACCOUNT_SID = "ACtest";
		process.env.TWILIO_WHATSAPP_NUMBER = SENDER;
		process.env.OPENROUTER_API_KEY = "test-openrouter";
		mockValidateRequest.mockReset().mockReturnValue(true);
		mockGenerateText.mockReset().mockResolvedValue({ text: "¡claro!", toolCalls: [] });
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sid: "SMout" }) })
		);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	async function post(t: ReturnType<typeof convexTest>, overrides: Record<string, string> = {}) {
		await t.fetch("/whatsapp/inbound", {
			method: "POST",
			headers: INBOUND_HEADERS,
			body: inboundBody(overrides),
		});
		await t.finishAllScheduledFunctions(() => vi.runAllTimers());
	}

	it("records a model-authored reply as the assistant", async () => {
		const t = convexTest(schema, modules);
		await seedChannel(t);

		await post(t);

		expect(await outboundRows(t)).toMatchObject([
			{ body: "¡claro!", sentBy: WHATSAPP_MESSAGE_SENDER.ASSISTANT },
		]);
	});

	it("keeps the tail of a split reply attributed to the assistant", async () => {
		const t = convexTest(schema, modules);
		await seedChannel(t);
		// Long enough to need two WhatsApp messages. Every part is one utterance
		// by the assistant; only the first carries `modelBody`, because only the
		// first is replayed as its context.
		const long = `${"palabra ".repeat(WHATSAPP_MAX_OUTBOUND_BODY_CHARS / 4)}fin`;
		mockGenerateText.mockResolvedValue({ text: long, toolCalls: [] });

		await post(t);

		const rows = await outboundRows(t);
		expect(rows.length).toBeGreaterThan(1);
		expect(rows.map((r) => r.sentBy)).toEqual(
			rows.map(() => WHATSAPP_MESSAGE_SENDER.ASSISTANT as string)
		);
		// The very thing that makes derivation wrong: a tail part is the
		// assistant speaking and still has no `modelBody`.
		expect(rows[1].modelBody).toBe("");
	});

	it("records server-composed copy as the system, not the assistant", async () => {
		const t = convexTest(schema, modules);
		await seedChannel(t);
		// The model throwing is one of the paths that sends fixed copy; the daily
		// cap notice and the confirmation replies are the others.
		mockGenerateText.mockRejectedValue(new Error("model down"));

		await post(t);

		expect(await outboundRows(t)).toMatchObject([
			{ body: getBotCopy("es").genericError, sentBy: WHATSAPP_MESSAGE_SENDER.SYSTEM },
		]);
	});

	it("records the daily-cap notice as the system", async () => {
		const t = convexTest(schema, modules);
		await seedChannel(t);
		await t.run((ctx) =>
			ctx.db.insert("rateLimits", {
				key: outboundBudgetKey(CUSTOMER),
				windowStart: Date.now(),
				count: 0,
				updatedAt: Date.now(),
			})
		);
		// Spend the inbound budget so the next message gets the notice.
		await t.run(async (ctx) => {
			const existing = await ctx.db
				.query("rateLimits")
				.filter((q) => q.eq(q.field("key"), `whatsapp_inbound:${CUSTOMER}`))
				.first();
			if (existing) return;
			await ctx.db.insert("rateLimits", {
				key: `whatsapp_inbound:${CUSTOMER}`,
				windowStart: Date.now(),
				count: WHATSAPP_OUTBOUND_DAILY_LIMIT.max,
				updatedAt: Date.now(),
			});
		});

		await post(t, { MessageSid: "SM-capped" });

		expect(await outboundRows(t)).toMatchObject([
			{ body: getBotCopy("es").dailyLimitReached, sentBy: WHATSAPP_MESSAGE_SENDER.SYSTEM },
		]);
	});

	it("records a notices-only reply as the system, not the assistant", async () => {
		const t = convexTest(schema, modules);
		await seedChannel(t);
		// The turn ends on a tool step — the model spent its steps calling tools
		// and never wrote a closing sentence — so the whole reply is the notice
		// line the tool pushed. `WHATSAPP_MAX_LLM_STEPS` makes this ordinary, and
		// redaction can empty a short reply the same way. Nobody but the server
		// wrote a word of what the diner receives.
		mockGenerateText.mockImplementation(async ({ tools }: { tools: ToolMap }) => {
			await tools.request_cancel.execute({}, {});
			return { text: "", toolCalls: [{ toolName: "request_cancel" }] };
		});

		await post(t);

		expect(await outboundRows(t)).toMatchObject([
			{ body: getBotCopy("es").nothingToCancel, sentBy: WHATSAPP_MESSAGE_SENDER.SYSTEM },
		]);
	});
});
