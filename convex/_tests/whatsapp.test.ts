import { Blob as NodeBlob } from "node:buffer";
import { convexTest } from "convex-test";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { toWhatsappText } from "../whatsapp/format";
import { matchDishByName, type BotMenuItem } from "../whatsapp/menu";

const modules = import.meta.glob("../**/*.ts");

// `twilio` (signature verify) and `ai` (the LLM turn) are the two external
// dependencies — mock both so tests are hermetic and offline.
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

function inboundBody(overrides: Record<string, string> = {}): string {
	return new URLSearchParams({
		MessageSid: "SM1",
		From: `whatsapp:${CUSTOMER}`,
		To: `whatsapp:${SENDER}`,
		Body: "hola, ¿qué tienen?",
		...overrides,
	}).toString();
}

const INBOUND_HEADERS = {
	"x-twilio-signature": "test-signature",
	"content-type": "application/x-www-form-urlencoded",
};

async function seedChannel(
	t: ReturnType<typeof convexTest>,
	args: { phoneNumber: string; isActive?: boolean } = { phoneNumber: SENDER }
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
			name: "Taquería Vernáculo",
			slug: `wa-${Math.random().toString(36).slice(2, 10)}`,
			currency: "MXN",
			defaultLanguage: "es",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		await ctx.db.insert("whatsappChannels", {
			restaurantId,
			phoneNumber: args.phoneNumber,
			isActive: args.isActive ?? true,
			defaultLocale: "es",
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});
	return restaurantId!;
}

async function seedMenuItem(
	t: ReturnType<typeof convexTest>,
	restaurantId: Id<"restaurants">,
	args: {
		name: string;
		basePrice: number;
		description?: string;
		translations?: Record<string, { name?: string; description?: string }>;
		withImage?: boolean;
		isAvailable?: boolean;
		menuActive?: boolean;
	}
) {
	await t.run(async (ctx) => {
		const menuId = await ctx.db.insert("menus", {
			restaurantId,
			name: "Menu",
			isActive: args.menuActive ?? true,
			displayOrder: 0,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		const categoryId = await ctx.db.insert("menuCategories", {
			menuId,
			restaurantId,
			name: "Tacos",
			displayOrder: 0,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		const imageStorageId = args.withImage
			? await ctx.storage.store(
					// Node's Blob (has arrayBuffer()); jsdom's global Blob does not.
					new NodeBlob(["img"], { type: "image/jpeg" }) as unknown as Blob
				)
			: undefined;
		await ctx.db.insert("menuItems", {
			categoryId,
			restaurantId,
			name: args.name,
			description: args.description,
			translations: args.translations,
			basePrice: args.basePrice,
			isAvailable: args.isAvailable ?? true,
			imageStorageId,
			displayOrder: 0,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});
}

describe("whatsapp matchDishByName", () => {
	const items = [{ name: "Tacos al pastor" }, { name: "Agua de Jamaica" }] as BotMenuItem[];

	it("matches accent- and case-insensitively, both containment directions", () => {
		expect(matchDishByName(items, "TACOS AL PASTOR")?.name).toBe("Tacos al pastor");
		expect(matchDishByName(items, "pastor")?.name).toBe("Tacos al pastor");
		expect(matchDishByName(items, "jamaica")?.name).toBe("Agua de Jamaica");
		expect(matchDishByName(items, "sushi")).toBeUndefined();
		expect(matchDishByName(items, "")).toBeUndefined();
	});
});

describe("whatsapp toWhatsappText", () => {
	it("converts Markdown emphasis to WhatsApp syntax", () => {
		expect(toWhatsappText("**1000.00 MXN**")).toBe("*1000.00 MXN*");
		expect(toWhatsappText("__bold__")).toBe("*bold*");
		expect(toWhatsappText("***both***")).toBe("*_both_*");
		expect(toWhatsappText("~~sold out~~")).toBe("~sold out~");
	});

	it("leaves a lone `*text*` alone — already valid WhatsApp bold", () => {
		// Rewriting this to `_text_` would demote the bold the prompt asked for.
		expect(toWhatsappText("*Arrachera*")).toBe("*Arrachera*");
		expect(toWhatsappText("_Arrachera_")).toBe("_Arrachera_");
	});

	it("does not degrade bold to italic when collapsing `**` to `*`", () => {
		// The ordering trap: `**x**` → `*x*` must not then match the italic rule.
		expect(toWhatsappText("**Rib eye** y **Picaña**")).toBe("*Rib eye* y *Picaña*");
	});

	it("turns headings into bold lines and drops horizontal rules", () => {
		expect(toWhatsappText("### Carnes")).toBe("*Carnes*");
		expect(toWhatsappText("# **Entradas**")).toBe("*Entradas*");
		expect(toWhatsappText("Carnes\n\n---\n\nTacos")).toBe("Carnes\n\nTacos");
	});

	it("normalizes both list markers to a literal bullet, keeping indentation", () => {
		expect(toWhatsappText("- Birria\n* Chorizo\n+ Pastor")).toBe("• Birria\n• Chorizo\n• Pastor");
		expect(toWhatsappText("- Birria\n  - Con queso")).toBe("• Birria\n  • Con queso");
		expect(toWhatsappText("1. Birria")).toBe("1. Birria");
	});

	it("flattens links and inline code that WhatsApp cannot render", () => {
		expect(toWhatsappText("[Our menu](https://tavli.test/m)")).toBe(
			"Our menu: https://tavli.test/m"
		);
		expect(toWhatsappText("[https://tavli.test](https://tavli.test)")).toBe("https://tavli.test");
		expect(toWhatsappText("![Tacos](https://cdn.test/t.jpg)")).toBe("Tacos");
		expect(toWhatsappText("Ask for `pastor`")).toBe("Ask for pastor");
	});

	it("preserves ``` blocks and collapses long blank runs", () => {
		expect(toWhatsappText("```\n**raw** text\n```")).toBe("```\n**raw** text\n```");
		expect(toWhatsappText("Carnes\n\n\n\nTacos")).toBe("Carnes\n\nTacos");
	});

	it("leaves plain text and already-converted text untouched", () => {
		expect(toWhatsappText("¡Hola! ¿En qué puedo ayudarte hoy?")).toBe(
			"¡Hola! ¿En qué puedo ayudarte hoy?"
		);
		expect(toWhatsappText("")).toBe("");
		const converted = toWhatsappText("### Carnes\n- **Rib eye** - **1000.00 MXN**");
		expect(toWhatsappText(converted)).toBe(converted);
	});

	it("cleans up the real menu reply that leaked Markdown to the customer", () => {
		const raw = [
			'Aquí tienes el menú de "vernaculo" nuevamente:',
			"",
			"### Carnes",
			"- **Rib eye**: un delicioso corte de lomo de res - **1000.00 MXN**",
			"- **Arrachera** - **700.00 MXN**",
		].join("\n");

		expect(toWhatsappText(raw)).toBe(
			[
				'Aquí tienes el menú de "vernaculo" nuevamente:',
				"",
				"*Carnes*",
				"• *Rib eye*: un delicioso corte de lomo de res - *1000.00 MXN*",
				"• *Arrachera* - *700.00 MXN*",
			].join("\n")
		);
		expect(toWhatsappText(raw)).not.toMatch(/\*\*|###/);
	});
});

describe("whatsapp internalGetMenuForBot", () => {
	it("returns available items localized with formatted prices", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedChannel(t);
		await seedMenuItem(t, restaurantId, {
			name: "Al pastor taco",
			description: "Pork, pineapple",
			basePrice: 3500,
			translations: { es: { name: "Taco al pastor", description: "Cerdo con piña" } },
		});
		await seedMenuItem(t, restaurantId, {
			name: "Sold out special",
			basePrice: 9900,
			isAvailable: false,
		});

		const menu = await t.query(internal.whatsapp.menu.internalGetMenuForBot, {
			restaurantId,
			locale: "es",
		});

		expect(menu.currency).toBe("MXN");
		expect(menu.items).toHaveLength(1); // unavailable item excluded
		expect(menu.items[0]).toMatchObject({
			name: "Taco al pastor",
			description: "Cerdo con piña",
			priceFormatted: "35.00 MXN",
		});
	});

	it("excludes items whose parent menu is inactive", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedChannel(t);
		await seedMenuItem(t, restaurantId, { name: "Hidden", basePrice: 100, menuActive: false });

		const menu = await t.query(internal.whatsapp.menu.internalGetMenuForBot, { restaurantId });
		expect(menu.items).toHaveLength(0);
	});
});

describe("whatsapp inbound webhook (M2 menu Q&A)", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.useFakeTimers();
		process.env.TWILIO_AUTH_TOKEN = "test-token";
		process.env.TWILIO_ACCOUNT_SID = "ACtest";
		process.env.TWILIO_WHATSAPP_NUMBER = SENDER;
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

	it("rejects a request with no signature header (400)", async () => {
		const t = convexTest(schema, modules);
		await seedChannel(t);
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
		await seedChannel(t);
		mockValidateRequest.mockReturnValue(false);

		const res = await t.fetch("/whatsapp/inbound", {
			method: "POST",
			headers: INBOUND_HEADERS,
			body: inboundBody(),
		});
		await t.finishAllScheduledFunctions(() => vi.runAllTimers());

		expect(res.status).toBe(403);
		expect(mockGenerateText).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("answers a valid signed message with the LLM reply", async () => {
		const t = convexTest(schema, modules);
		await seedChannel(t);
		mockGenerateText.mockResolvedValue({
			text: "Tenemos tacos al pastor por 35.00 MXN 🌮",
			toolCalls: [{ toolName: "lookup_menu" }],
		});

		const res = await t.fetch("/whatsapp/inbound", {
			method: "POST",
			headers: INBOUND_HEADERS,
			body: inboundBody(),
		});
		expect(res.status).toBe(200);
		await t.finishAllScheduledFunctions(() => vi.runAllTimers());

		const messages = await t.run((ctx) => ctx.db.query("whatsappMessages").collect());
		const inbound = messages.filter((m) => m.direction === "inbound");
		const outbound = messages.filter((m) => m.direction === "outbound");
		expect(inbound[0].body).toBe("hola, ¿qué tienen?");
		expect(outbound).toHaveLength(1);
		expect(outbound[0].body).toBe("Tenemos tacos al pastor por 35.00 MXN 🌮");
		expect(outbound[0].messageSid).toBe("SMout");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("attaches a dish photo when the model calls get_dish_photo", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedChannel(t);
		await seedMenuItem(t, restaurantId, {
			name: "Tacos al pastor",
			basePrice: 3500,
			withImage: true,
		});
		// Simulate the model invoking the photo tool, then replying.
		mockGenerateText.mockImplementation(
			async ({
				tools,
			}: {
				tools: Record<string, { execute: (i: unknown, o: unknown) => Promise<unknown> }>;
			}) => {
				await tools.get_dish_photo.execute({ dishName: "pastor" }, {});
				return { text: "Aquí está 🌮", toolCalls: [{ toolName: "get_dish_photo" }] };
			}
		);

		await t.fetch("/whatsapp/inbound", {
			method: "POST",
			headers: INBOUND_HEADERS,
			body: inboundBody({ Body: "foto de los tacos al pastor?" }),
		});
		await t.finishAllScheduledFunctions(() => vi.runAllTimers());

		const outbound = await t.run((ctx) =>
			ctx.db
				.query("whatsappMessages")
				.filter((q) => q.eq(q.field("direction"), "outbound"))
				.collect()
		);
		expect(outbound).toHaveLength(1);
		expect(outbound[0].mediaUrl).toBeTruthy();
		// The outbound REST call carried a MediaUrl.
		const [, init] = fetchMock.mock.calls[0];
		expect(String(init?.body)).toContain("MediaUrl");
	});

	it("is idempotent: a repeated MessageSid answers once", async () => {
		const t = convexTest(schema, modules);
		await seedChannel(t);
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
		expect(mockGenerateText).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("sends a localized apology if the LLM turn throws (never silent)", async () => {
		const t = convexTest(schema, modules);
		await seedChannel(t);
		mockGenerateText.mockRejectedValue(new Error("model exploded"));

		await t.fetch("/whatsapp/inbound", {
			method: "POST",
			headers: INBOUND_HEADERS,
			body: inboundBody(),
		});
		await t.finishAllScheduledFunctions(() => vi.runAllTimers());

		const outbound = await t.run((ctx) =>
			ctx.db
				.query("whatsappMessages")
				.filter((q) => q.eq(q.field("direction"), "outbound"))
				.collect()
		);
		expect(outbound).toHaveLength(1);
		expect(outbound[0].body.toLowerCase()).toContain("lo siento"); // Spanish fallback
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("drops a message to an unknown number without invoking the model", async () => {
		const t = convexTest(schema, modules);
		await seedChannel(t);
		const res = await t.fetch("/whatsapp/inbound", {
			method: "POST",
			headers: INBOUND_HEADERS,
			body: inboundBody({ To: "whatsapp:+19999999999" }),
		});
		await t.finishAllScheduledFunctions(() => vi.runAllTimers());

		expect(res.status).toBe(200);
		expect(mockGenerateText).not.toHaveBeenCalled();
		const conversations = await t.run((ctx) => ctx.db.query("whatsappConversations").collect());
		expect(conversations).toHaveLength(0);
	});

	it("drops a message to an inactive channel", async () => {
		const t = convexTest(schema, modules);
		await seedChannel(t, { phoneNumber: SENDER, isActive: false });
		await t.fetch("/whatsapp/inbound", {
			method: "POST",
			headers: INBOUND_HEADERS,
			body: inboundBody(),
		});
		await t.finishAllScheduledFunctions(() => vi.runAllTimers());
		expect(mockGenerateText).not.toHaveBeenCalled();
		const conversations = await t.run((ctx) => ctx.db.query("whatsappConversations").collect());
		expect(conversations).toHaveLength(0);
	});
});
