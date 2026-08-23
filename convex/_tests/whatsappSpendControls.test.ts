/**
 * WhatsApp spend controls (TAVLI-91).
 *
 * A valid Twilio signature proves Twilio sent the message, not that a real
 * customer did — so every inbound message is an LLM turn on Tavli's OpenRouter
 * key that nobody has paid for. These tests pin the three controls that turn
 * that open-ended bill into a bounded one: per-phone daily caps, a platform-wide
 * daily ceiling, and an admin allowlist that exempts a phone from the caps
 * (and from nothing else).
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
	WHATSAPP_GLOBAL_DAILY_LIMIT,
	WHATSAPP_INBOUND_DAILY_LIMIT,
	WHATSAPP_MAX_REPLY_PARTS,
	WHATSAPP_OUTBOUND_DAILY_LIMIT,
	WHATSAPP_WRITE_RATE_LIMIT,
} from "../constants";
import schema from "../schema";
import { getBotCopy } from "../whatsapp/copy";
import {
	GLOBAL_ALERT_KEY,
	GLOBAL_BUDGET_KEY,
	globalAlertThreshold,
	inboundBudgetKey,
	limitNoticeKey,
	outboundBudgetKey,
} from "../whatsapp/spendControls";

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
const OTHER_SENDER = "+14155238887";
const CUSTOMER = "+15551230000";
/** The same human as `MX_CANONICAL`, spelled the way WhatsApp delivers it. */
const MX_WHATSAPP = "+5218114906208";
const MX_CANONICAL = "+528114906208";

const INBOUND_HEADERS = {
	"x-twilio-signature": "test-signature",
	"content-type": "application/x-www-form-urlencoded",
};

function inboundBody(overrides: Record<string, string> = {}): string {
	return new URLSearchParams({
		MessageSid: "SM1",
		From: `whatsapp:${CUSTOMER}`,
		To: `whatsapp:${SENDER}`,
		Body: "hola, ¿qué tienen?",
		...overrides,
	}).toString();
}

async function seedChannel(
	t: ReturnType<typeof convexTest>,
	phoneNumber: string = SENDER
): Promise<Id<"restaurants">> {
	let restaurantId: Id<"restaurants">;
	await t.run(async (ctx) => {
		const organizationId = await ctx.db.insert("organizations", {
			name: "Spend Org",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner-spend",
			organizationId,
			name: "Spend Restaurant",
			slug: `spend-${Math.random().toString(36).slice(2, 10)}`,
			currency: "MXN",
			timezone: "America/Mexico_City",
			defaultLanguage: "es",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		await ctx.db.insert("whatsappChannels", {
			restaurantId,
			phoneNumber,
			isActive: true,
			defaultLocale: "es",
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});
	return restaurantId!;
}

/** Put a counter straight at `count` so a cap can be reached without N calls. */
async function seedCounter(t: ReturnType<typeof convexTest>, key: string, count: number) {
	await t.run((ctx) =>
		ctx.db.insert("rateLimits", {
			key,
			windowStart: Date.now(),
			count,
			updatedAt: Date.now(),
		})
	);
}

async function allowlist(t: ReturnType<typeof convexTest>, phone: string, label = "Operator") {
	await t.run((ctx) =>
		ctx.db.insert("whatsappSpendAllowlist", {
			phone,
			label,
			createdAt: Date.now(),
			createdBy: "admin-seed",
		})
	);
}

function counters(t: ReturnType<typeof convexTest>) {
	return t.run((ctx) => ctx.db.query("rateLimits").collect());
}

function outboundBodies(t: ReturnType<typeof convexTest>) {
	return t.run(async (ctx) =>
		(await ctx.db.query("whatsappMessages").collect())
			.filter((m) => m.direction === "outbound")
			.map((m) => m.body)
	);
}

// ============================================================================
// Key shape
// ============================================================================

describe("spend-control rate-limit keys", () => {
	it("are stable per phone and carry no date, so the table cannot grow without bound", () => {
		// `rateLimits` rows are never deleted and the table is exempt from the
		// restaurant purge. A date in the key would mint a fresh row per phone per
		// day forever.
		expect(inboundBudgetKey(MX_CANONICAL)).toBe("whatsapp_inbound:+528114906208");
		expect(outboundBudgetKey(MX_CANONICAL)).toBe("whatsapp_outbound:+528114906208");
		expect(limitNoticeKey(MX_CANONICAL)).toBe("whatsapp_limit_notice:+528114906208");
		expect(GLOBAL_BUDGET_KEY).toBe("whatsapp_global");
		expect(GLOBAL_ALERT_KEY).toBe("whatsapp_global_alert");

		for (const key of [
			inboundBudgetKey(MX_CANONICAL),
			outboundBudgetKey(MX_CANONICAL),
			limitNoticeKey(MX_CANONICAL),
			GLOBAL_BUDGET_KEY,
			GLOBAL_ALERT_KEY,
		]) {
			expect(key).not.toMatch(/\d{4}-\d{2}-\d{2}/);
		}
	});

	it("scopes the per-phone keys to the phone alone — not to a restaurant", () => {
		// The phone is what costs money. A per-(phone, restaurant) key would let
		// one number spend the cap again on every restaurant it can reach.
		expect(inboundBudgetKey(CUSTOMER)).not.toMatch(/restaurant/);
		expect(inboundBudgetKey(CUSTOMER).split(":")).toHaveLength(2);
	});

	it("alerts at 80% of the platform ceiling", () => {
		expect(globalAlertThreshold()).toBe(4000);
		expect(WHATSAPP_GLOBAL_DAILY_LIMIT.max).toBe(5000);
	});

	it("sizes the caps so a full day of replies fits the outbound budget", () => {
		// 25 inbound × 3 parts = 75 outbound. The reply-part cap and the daily
		// caps are one design, not three numbers.
		expect(WHATSAPP_MAX_REPLY_PARTS).toBe(3);
		expect(WHATSAPP_INBOUND_DAILY_LIMIT.max * WHATSAPP_MAX_REPLY_PARTS).toBe(
			WHATSAPP_OUTBOUND_DAILY_LIMIT.max
		);
	});
});

// ============================================================================
// Per-phone budgets, exercised directly
// ============================================================================

describe("per-phone daily budgets", () => {
	it("allows 25 inbound messages in a window and refuses the 26th", async () => {
		const t = convexTest(schema, modules);

		for (let i = 0; i < WHATSAPP_INBOUND_DAILY_LIMIT.max; i++) {
			const decision = await t.mutation(internal.whatsapp.spendControls.internalCheckInbound, {
				phone: CUSTOMER,
			});
			expect(decision.allowed, `message ${i + 1} should be allowed`).toBe(true);
		}

		const refused = await t.mutation(internal.whatsapp.spendControls.internalCheckInbound, {
			phone: CUSTOMER,
		});
		expect(refused.allowed).toBe(false);
	});

	it("allows 75 outbound messages in a window and refuses the 76th", async () => {
		const t = convexTest(schema, modules);

		for (let i = 0; i < WHATSAPP_OUTBOUND_DAILY_LIMIT.max; i++) {
			const decision = await t.mutation(internal.whatsapp.spendControls.internalConsumeOutbound, {
				phone: CUSTOMER,
			});
			expect(decision.allowed, `reply ${i + 1} should be allowed`).toBe(true);
		}

		const refused = await t.mutation(internal.whatsapp.spendControls.internalConsumeOutbound, {
			phone: CUSTOMER,
		});
		expect(refused.allowed).toBe(false);
	});

	it("does not let a refused phone spend the platform's budget", async () => {
		const t = convexTest(schema, modules);
		await seedCounter(t, inboundBudgetKey(CUSTOMER), WHATSAPP_INBOUND_DAILY_LIMIT.max);

		for (let i = 0; i < 50; i++) {
			await t.mutation(internal.whatsapp.spendControls.internalCheckInbound, { phone: CUSTOMER });
		}

		// Otherwise one number that keeps sending after its own cap could burn the
		// 5,000-message platform ceiling and take every restaurant's assistant
		// down with it — the per-phone cap would bound the LLM spend and cause a
		// platform-wide outage in the same breath.
		const global = (await counters(t)).find((r) => r.key === GLOBAL_BUDGET_KEY);
		expect(global).toBeUndefined();
	});

	it("normalizes the phone so one human is one counter, not two", async () => {
		const t = convexTest(schema, modules);

		// WhatsApp delivers Mexican mobiles with a legacy 1 after the country
		// code. Un-normalized, the same person gets two budgets.
		await t.mutation(internal.whatsapp.spendControls.internalCheckInbound, {
			phone: MX_WHATSAPP,
		});
		await t.mutation(internal.whatsapp.spendControls.internalCheckInbound, {
			phone: MX_CANONICAL,
		});

		const rows = (await counters(t)).filter((r) => r.key.startsWith("whatsapp_inbound:"));
		expect(rows).toHaveLength(1);
		expect(rows[0].key).toBe(inboundBudgetKey(MX_CANONICAL));
		expect(rows[0].count).toBe(2);
	});
});

// ============================================================================
// Refusal behaviour on the inbound pipeline
// ============================================================================

describe("inbound pipeline under the per-phone cap", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.useFakeTimers();
		process.env.TWILIO_AUTH_TOKEN = "test-token";
		process.env.TWILIO_ACCOUNT_SID = "ACtest";
		process.env.TWILIO_WHATSAPP_NUMBER = SENDER;
		process.env.OPENROUTER_API_KEY = "test-openrouter";
		process.env.RESEND_API_KEY = "test-resend";
		process.env.RESEND_FROM_ADDRESS = "Tavli <no-reply@tavliai.com>";
		mockValidateRequest.mockReset().mockReturnValue(true);
		mockGenerateText.mockReset().mockResolvedValue({ text: "¡claro!", toolCalls: [] });
		fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sid: "SMout" }) });
		vi.stubGlobal("fetch", fetchMock);
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

	it("sends exactly one notice on refusal, then goes silent for the window", async () => {
		const t = convexTest(schema, modules);
		await seedChannel(t);
		await seedCounter(t, inboundBudgetKey(CUSTOMER), WHATSAPP_INBOUND_DAILY_LIMIT.max);

		await post(t, { MessageSid: "SM-over-1" });
		await post(t, { MessageSid: "SM-over-2" });
		await post(t, { MessageSid: "SM-over-3" });

		// Replying to a flood funds the flood.
		expect(mockGenerateText).not.toHaveBeenCalled();
		expect(await outboundBodies(t)).toEqual([getBotCopy("es").dailyLimitReached]);
	});

	it("counts the phone in total, not per restaurant", async () => {
		const t = convexTest(schema, modules);
		await seedChannel(t, SENDER);
		await seedChannel(t, OTHER_SENDER);
		await seedCounter(t, inboundBudgetKey(CUSTOMER), WHATSAPP_INBOUND_DAILY_LIMIT.max - 1);

		await post(t, { MessageSid: "SM-a", To: `whatsapp:${SENDER}` });
		await post(t, { MessageSid: "SM-b", To: `whatsapp:${OTHER_SENDER}` });

		// The first message spends the last unit; the second restaurant does not
		// hand the same number a fresh budget.
		expect(mockGenerateText).toHaveBeenCalledTimes(1);
		expect(await outboundBodies(t)).toEqual(["¡claro!", getBotCopy("es").dailyLimitReached]);
	});

	it("stops replying when the phone's outbound budget is spent", async () => {
		const t = convexTest(schema, modules);
		await seedChannel(t);
		await seedCounter(t, outboundBudgetKey(CUSTOMER), WHATSAPP_OUTBOUND_DAILY_LIMIT.max);

		await post(t, { MessageSid: "SM-no-room" });

		// The turn may run, but nothing is put on the wire.
		expect(fetchMock).not.toHaveBeenCalled();
		expect(await outboundBodies(t)).toEqual([]);
	});
});

// ============================================================================
// Confirmation codes are exempt (ADR-011)
// ============================================================================

describe("confirmation codes under the cap", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.useFakeTimers();
		process.env.TWILIO_AUTH_TOKEN = "test-token";
		process.env.TWILIO_ACCOUNT_SID = "ACtest";
		process.env.TWILIO_WHATSAPP_NUMBER = SENDER;
		process.env.OPENROUTER_API_KEY = "test-openrouter";
		mockValidateRequest.mockReset().mockReturnValue(true);
		mockGenerateText.mockReset().mockResolvedValue({ text: "ok", toolCalls: [] });
		fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sid: "SMout" }) });
		vi.stubGlobal("fetch", fetchMock);
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

	async function seedPendingCancel(
		t: ReturnType<typeof convexTest>,
		restaurantId: Id<"restaurants">,
		code: string
	) {
		await t.run(async (ctx) => {
			const reservationId = await ctx.db.insert("reservations", {
				restaurantId,
				contact: { name: "Guest", phone: CUSTOMER },
				partySize: 2,
				startsAt: Date.now() + 24 * 60 * 60 * 1000,
				endsAt: Date.now() + 26 * 60 * 60 * 1000,
				tableIds: [],
				status: "pending",
				source: "whatsapp",
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
			const conversation = await ctx.db.query("whatsappConversations").first();
			await ctx.db.insert("whatsappPendingActions", {
				conversationId: conversation!._id,
				restaurantId,
				customerPhone: CUSTOMER,
				kind: "cancel_reservation",
				reservationId,
				code,
				expiresAt: Date.now() + 10 * 60 * 1000,
				createdAt: Date.now(),
			});
		});
	}

	it("redeems a code even when the phone is over its inbound cap", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedChannel(t);
		// One allowed message so a Conversation exists to hang the code off.
		await post(t, { MessageSid: "SM-first" });
		await seedPendingCancel(t, restaurantId, "481920");
		await seedCounter(t, inboundBudgetKey(CUSTOMER), WHATSAPP_INBOUND_DAILY_LIMIT.max);

		await post(t, { MessageSid: "SM-code", Body: "481920" });

		// A diner mid-cancellation whose code dies silently is the exact failure
		// ADR-011 exists to prevent: their booking is simply not cancelled.
		const reservation = (await t.run((ctx) => ctx.db.query("reservations").collect()))[0];
		expect(reservation.status).toBe("cancelled");
	});

	it("still counts a code against the budget", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedChannel(t);
		await post(t, { MessageSid: "SM-first" });
		await seedPendingCancel(t, restaurantId, "481920");

		await post(t, { MessageSid: "SM-code", Body: "481920" });

		const row = (await counters(t)).find((r) => r.key === inboundBudgetKey(CUSTOMER));
		expect(row?.count).toBe(2);
	});

	it("refuses a code-shaped message that is not a live code, like any other message", async () => {
		const t = convexTest(schema, modules);
		await seedChannel(t);
		await seedCounter(t, inboundBudgetKey(CUSTOMER), WHATSAPP_INBOUND_DAILY_LIMIT.max);

		// Otherwise "481920" is a free pass to the model: send six digits forever.
		await post(t, { MessageSid: "SM-fake-code", Body: "481920" });

		expect(mockGenerateText).not.toHaveBeenCalled();
	});
});

// ============================================================================
// Platform ceiling + 80% alert
// ============================================================================

describe("platform daily ceiling", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.useFakeTimers();
		process.env.TWILIO_AUTH_TOKEN = "test-token";
		process.env.TWILIO_ACCOUNT_SID = "ACtest";
		process.env.TWILIO_WHATSAPP_NUMBER = SENDER;
		process.env.OPENROUTER_API_KEY = "test-openrouter";
		process.env.RESEND_API_KEY = "test-resend";
		process.env.RESEND_FROM_ADDRESS = "Tavli <no-reply@tavliai.com>";
		mockValidateRequest.mockReset().mockReturnValue(true);
		mockGenerateText.mockReset().mockResolvedValue({ text: "¡claro!", toolCalls: [] });
		fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sid: "SMout" }) });
		vi.stubGlobal("fetch", fetchMock);
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

	const resendCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
		fetchMock.mock.calls.filter(([url]) => String(url).includes("api.resend.com"));

	it("serves the fixed apology without calling the model once the ceiling is hit", async () => {
		const t = convexTest(schema, modules);
		await seedChannel(t);
		await seedCounter(t, GLOBAL_BUDGET_KEY, WHATSAPP_GLOBAL_DAILY_LIMIT.max);

		await post(t, { MessageSid: "SM-ceiling" });

		expect(mockGenerateText).not.toHaveBeenCalled();
		expect(await outboundBodies(t)).toEqual([getBotCopy("es").platformBusy]);
	});

	it("counts every restaurant against one platform counter", async () => {
		const t = convexTest(schema, modules);
		await seedChannel(t, SENDER);
		await seedChannel(t, OTHER_SENDER);

		await post(t, { MessageSid: "SM-a", To: `whatsapp:${SENDER}` });
		await post(t, { MessageSid: "SM-b", To: `whatsapp:${OTHER_SENDER}` });

		const rows = (await counters(t)).filter((r) => r.key === GLOBAL_BUDGET_KEY);
		expect(rows).toHaveLength(1);
		expect(rows[0].count).toBe(2);
	});

	it("emails ops when the counter crosses 80% of the ceiling", async () => {
		const t = convexTest(schema, modules);
		await seedChannel(t);
		await seedCounter(t, GLOBAL_BUDGET_KEY, globalAlertThreshold() - 1);

		await post(t, { MessageSid: "SM-80" });

		expect(resendCalls(fetchMock)).toHaveLength(1);
	});

	it("does not turn a runaway into a mail flood", async () => {
		const t = convexTest(schema, modules);
		await seedChannel(t);
		await seedCounter(t, GLOBAL_BUDGET_KEY, globalAlertThreshold() - 1);

		await post(t, { MessageSid: "SM-80-a" });
		await post(t, { MessageSid: "SM-80-b" });
		await post(t, { MessageSid: "SM-80-c" });

		expect(resendCalls(fetchMock)).toHaveLength(1);
	});

	it("stays quiet below the alert threshold", async () => {
		const t = convexTest(schema, modules);
		await seedChannel(t);
		await seedCounter(t, GLOBAL_BUDGET_KEY, globalAlertThreshold() - 3);

		await post(t, { MessageSid: "SM-quiet" });

		expect(resendCalls(fetchMock)).toHaveLength(0);
	});
});

// ============================================================================
// Admin allowlist exemptions
// ============================================================================

describe("admin allowlist", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.useFakeTimers();
		process.env.TWILIO_AUTH_TOKEN = "test-token";
		process.env.TWILIO_ACCOUNT_SID = "ACtest";
		process.env.TWILIO_WHATSAPP_NUMBER = SENDER;
		process.env.OPENROUTER_API_KEY = "test-openrouter";
		mockValidateRequest.mockReset().mockReturnValue(true);
		mockGenerateText.mockReset().mockResolvedValue({ text: "¡claro!", toolCalls: [] });
		fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sid: "SMout" }) });
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("exempts an allowlisted phone from the inbound cap", async () => {
		const t = convexTest(schema, modules);
		await seedChannel(t);
		await allowlist(t, CUSTOMER);
		await seedCounter(t, inboundBudgetKey(CUSTOMER), WHATSAPP_INBOUND_DAILY_LIMIT.max);

		const decision = await t.mutation(internal.whatsapp.spendControls.internalCheckInbound, {
			phone: CUSTOMER,
		});

		expect(decision.allowed).toBe(true);
	});

	it("exempts an allowlisted phone from the outbound cap", async () => {
		const t = convexTest(schema, modules);
		await allowlist(t, CUSTOMER);
		await seedCounter(t, outboundBudgetKey(CUSTOMER), WHATSAPP_OUTBOUND_DAILY_LIMIT.max);

		const decision = await t.mutation(internal.whatsapp.spendControls.internalConsumeOutbound, {
			phone: CUSTOMER,
		});

		expect(decision.allowed).toBe(true);
	});

	it("matches the allowlist on the normalized phone", async () => {
		const t = convexTest(schema, modules);
		await allowlist(t, MX_CANONICAL);
		await seedCounter(t, inboundBudgetKey(MX_CANONICAL), WHATSAPP_INBOUND_DAILY_LIMIT.max);

		const decision = await t.mutation(internal.whatsapp.spendControls.internalCheckInbound, {
			phone: MX_WHATSAPP,
		});

		expect(decision.allowed).toBe(true);
	});

	it("does NOT exempt the hourly write budget", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedChannel(t);
		await allowlist(t, CUSTOMER);

		for (let i = 0; i < WHATSAPP_WRITE_RATE_LIMIT.max; i++) {
			const decision = await t.mutation(internal.whatsapp.reservations.internalConsumeWriteBudget, {
				restaurantId,
				phone: CUSTOMER,
			});
			expect(decision.allowed).toBe(true);
		}

		// The write budget protects data integrity, not spend. A bug that only
		// appears under it must stay visible while testing from an allowlisted
		// number.
		const refused = await t.mutation(internal.whatsapp.reservations.internalConsumeWriteBudget, {
			restaurantId,
			phone: CUSTOMER,
		});
		expect(refused.allowed).toBe(false);
	});

	it("does NOT exempt the platform ceiling", async () => {
		const t = convexTest(schema, modules);
		await allowlist(t, CUSTOMER);
		await seedCounter(t, GLOBAL_BUDGET_KEY, WHATSAPP_GLOBAL_DAILY_LIMIT.max);

		const decision = await t.mutation(internal.whatsapp.spendControls.internalCheckInbound, {
			phone: CUSTOMER,
		});

		// The ceiling exists to bound Tavli's own bill; no phone spends past it.
		expect(decision.globalCeilingReached).toBe(true);
	});
});
