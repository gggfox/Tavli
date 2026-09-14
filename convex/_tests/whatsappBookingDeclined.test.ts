/**
 * What a diner is told when a booking does NOT go through.
 *
 * Success has always had a server-composed line (`copy.bookingRequested`).
 * Failure used to be model prose over a bare reason code — which is how
 * `ERROR_NO_TABLES_AVAILABLE` at a restaurant with no tables became "no tables
 * at that time, would you like another?", forever. These tests pin the
 * replacement: every decline reason has a fixed bilingual line, the line
 * reaches the diner, and the prompt no longer instructs the model to ask for
 * another time when no other time can exist.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import { DEFAULT_RESERVATION_SETTINGS, WHATSAPP_LOCALE } from "../constants";
import schema from "../schema";
import { bookingDeclinedNotice, getBotCopy } from "../whatsapp/copy";
import { enableReservationsFlag } from "./helpers/reservationsFlag";

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

const TZ = "America/Mexico_City";
const SENDER = "+14155238886";
const SHORT_CODE_DISPLAY = "NTB-7Q1";
const CUSTOMER = "+15551230000";

const INBOUND_HEADERS = {
	"x-twilio-signature": "test-signature",
	"content-type": "application/x-www-form-urlencoded",
};

/** The eight reasons `book_reservation` can come back with. */
const DECLINE_REASONS = [
	"ERROR_NOT_ACCEPTING_RESERVATIONS",
	"ERROR_NO_TABLES_AVAILABLE",
	"ERROR_OUTSIDE_OPERATING_HOURS",
	"ERROR_BLACKOUT_WINDOW",
	"ERROR_OUTSIDE_BOOKING_HORIZON",
	"ERROR_INVALID_DATE_OR_TIME",
	"ERROR_INVALID_PARTY_SIZE",
	"ERROR_NOT_FOUND",
] as const;

type ToolMap = Record<string, { execute: (i: unknown, o: unknown) => Promise<unknown> }>;

function tomorrowYmd(): string {
	const d = new Date(Date.now() + 86_400_000);
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
		d.getUTCDate()
	).padStart(2, "0")}`;
}

function inboundBody(body: string): string {
	return new URLSearchParams({
		MessageSid: "SM1",
		From: `whatsapp:${CUSTOMER}`,
		To: `whatsapp:${SENDER}`,
		Body: `${body} · ${SHORT_CODE_DISPLAY}`,
	}).toString();
}

/** An enabled restaurant whose toggle says "accepting" — with `tableCount` tables. */
async function seedChannel(
	t: ReturnType<typeof convexTest>,
	tableCount: number
): Promise<Id<"restaurants">> {
	let restaurantId: Id<"restaurants">;
	await t.run(async (ctx) => {
		const organizationId = await ctx.db.insert("organizations", {
			name: "Declined Org",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner-declined",
			organizationId,
			name: "Declined Restaurant",
			slug: `declined-${Math.random().toString(36).slice(2, 10)}`,
			currency: "MXN",
			timezone: TZ,
			openTime: "10:00",
			closeTime: "23:00",
			defaultLanguage: "es",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		await ctx.db.insert("reservationSettings", {
			restaurantId,
			defaultTurnMinutes: DEFAULT_RESERVATION_SETTINGS.defaultTurnMinutes,
			turnMinutesByCapacity: [...DEFAULT_RESERVATION_SETTINGS.turnMinutesByCapacity],
			minAdvanceMinutes: DEFAULT_RESERVATION_SETTINGS.minAdvanceMinutes,
			maxAdvanceDays: DEFAULT_RESERVATION_SETTINGS.maxAdvanceDays,
			noShowGraceMinutes: DEFAULT_RESERVATION_SETTINGS.noShowGraceMinutes,
			blackoutWindows: [],
			acceptingReservations: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		for (let i = 0; i < tableCount; i++) {
			await ctx.db.insert("tables", {
				restaurantId,
				tableNumber: i + 1,
				capacity: 5,
				isActive: true,
				createdAt: Date.now(),
			});
		}
		await enableReservationsFlag(ctx.db);
		await ctx.db.insert("whatsappChannels", {
			restaurantId,
			shortCode: SHORT_CODE_DISPLAY.replace("-", ""),
			isActive: true,
			defaultLocale: "es",
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});
	return restaurantId!;
}

/** Everything the diner's phone received for this turn, in order. */
async function outboundBodies(t: ReturnType<typeof convexTest>): Promise<string[]> {
	const rows = await t.run((ctx) =>
		ctx.db
			.query("whatsappMessages")
			.filter((q) => q.eq(q.field("direction"), "outbound"))
			.collect()
	);
	return rows.map((r) => r.body);
}

describe("bookingDeclinedNotice", () => {
	it("has a distinct, non-empty line for every decline reason in both languages", () => {
		for (const locale of [WHATSAPP_LOCALE.EN, WHATSAPP_LOCALE.ES]) {
			const copy = getBotCopy(locale);
			const lines = DECLINE_REASONS.map((reason) =>
				bookingDeclinedNotice(copy, reason, {
					hasAlternatives: false,
					openTime: "10:00",
					closeTime: "23:00",
					minAdvanceMinutes: 30,
					maxAdvanceDays: 60,
					maxPartySize: 12,
				})
			);
			for (const line of lines) expect(line?.trim().length ?? 0).toBeGreaterThan(20);
			expect(new Set(lines).size).toBe(DECLINE_REASONS.length);
		}
	});

	it("is the approved wording for a restaurant that is not accepting", () => {
		const en = bookingDeclinedNotice(
			getBotCopy(WHATSAPP_LOCALE.EN),
			"ERROR_NOT_ACCEPTING_RESERVATIONS",
			{
				hasAlternatives: false,
			}
		);
		const es = bookingDeclinedNotice(
			getBotCopy(WHATSAPP_LOCALE.ES),
			"ERROR_NOT_ACCEPTING_RESERVATIONS",
			{
				hasAlternatives: false,
			}
		);
		expect(en).toBe(
			"This restaurant isn't taking reservations right now. I can still help with the menu, hours, and directions."
		);
		expect(es).toBe(
			"Este restaurante no está tomando reservaciones por ahora. Con gusto te ayudo con el menú, horarios y cómo llegar."
		);
	});

	it("says nothing for a reason it does not know, rather than inventing one", () => {
		expect(
			bookingDeclinedNotice(getBotCopy(WHATSAPP_LOCALE.EN), "ERROR_SOMETHING_NEW", {
				hasAlternatives: false,
			})
		).toBeNull();
	});
});

describe("what the diner receives when a booking is declined", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.useFakeTimers();
		process.env.TWILIO_AUTH_TOKEN = "test-token";
		process.env.TWILIO_ACCOUNT_SID = "ACtest";
		process.env.TWILIO_WHATSAPP_NUMBER = SENDER;
		process.env.OPENROUTER_API_KEY = "test-openrouter";
		mockValidateRequest.mockReset().mockReturnValue(true);
		fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sid: "SMout" }) });
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	async function turn(t: ReturnType<typeof convexTest>, body: string) {
		await t.fetch("/whatsapp/inbound", {
			method: "POST",
			headers: INBOUND_HEADERS,
			body: inboundBody(body),
		});
		await t.finishAllScheduledFunctions(() => vi.runAllTimers());
	}

	it("gets the fixed not-accepting line when the model books at a table-less restaurant", async () => {
		const t = convexTest(schema, modules);
		await seedChannel(t, 0);
		mockGenerateText.mockImplementation(async ({ tools }: { tools: ToolMap }) => {
			await tools.book_reservation.execute(
				{ date: tomorrowYmd(), time: "13:00", partySize: 5, name: "Samuel" },
				{}
			);
			return { text: "Lo siento, no se pudo.", toolCalls: [] };
		});

		await turn(t, "quiero reservar mañana a la 1 para 5");

		const all = (await outboundBodies(t)).join("\n");
		expect(all).toContain("Este restaurante no está tomando reservaciones por ahora.");
		// The old improvisation — "no tables at that time" — must be gone.
		expect(all.toLowerCase()).not.toContain("no hay mesas disponibles");
	});

	it("gets the same line when the model only checks availability — and only once", async () => {
		const t = convexTest(schema, modules);
		await seedChannel(t, 0);
		mockGenerateText.mockImplementation(async ({ tools }: { tools: ToolMap }) => {
			await tools.check_availability.execute(
				{ date: tomorrowYmd(), time: "13:00", partySize: 5 },
				{}
			);
			await tools.check_availability.execute(
				{ date: tomorrowYmd(), time: "20:00", partySize: 5 },
				{}
			);
			await tools.book_reservation.execute(
				{ date: tomorrowYmd(), time: "20:00", partySize: 5, name: "Samuel" },
				{}
			);
			return { text: "Lo siento.", toolCalls: [] };
		});

		await turn(t, "hay mesa mañana?");

		const all = (await outboundBodies(t)).join("\n");
		const line = "Este restaurante no está tomando reservaciones por ahora.";
		expect(all.split(line).length - 1).toBe(1);
	});

	it("gets the slot-full line, not the not-accepting one, when the floor is merely booked", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedChannel(t, 1);
		const date = tomorrowYmd();
		// Occupy the only table for the whole evening.
		await t.run(async (ctx) => {
			const table = await ctx.db
				.query("tables")
				.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
				.first();
			const startsAt = new Date(`${date}T18:00:00-06:00`).getTime();
			await ctx.db.insert("reservations", {
				restaurantId,
				partySize: 4,
				startsAt,
				endsAt: startsAt + 5 * 60 * 60_000,
				tableIds: [table!._id],
				status: "confirmed",
				source: "staff",
				contact: { name: "Blocker", phone: "+15550000000" },
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});
		mockGenerateText.mockImplementation(async ({ tools }: { tools: ToolMap }) => {
			await tools.book_reservation.execute({ date, time: "20:00", partySize: 4, name: "Ana" }, {});
			return { text: "Ese horario no.", toolCalls: [] };
		});

		await turn(t, "mesa mañana 8pm para 4");

		const all = (await outboundBodies(t)).join("\n");
		expect(all).not.toContain("no está tomando reservaciones");
		expect(all).toContain(
			bookingDeclinedNotice(getBotCopy(WHATSAPP_LOCALE.ES), "ERROR_NO_TABLES_AVAILABLE", {
				hasAlternatives: false,
			})!
		);
	});
});

describe("the prompt", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		process.env.TWILIO_AUTH_TOKEN = "test-token";
		process.env.TWILIO_ACCOUNT_SID = "ACtest";
		process.env.TWILIO_WHATSAPP_NUMBER = SENDER;
		process.env.OPENROUTER_API_KEY = "test-openrouter";
		mockValidateRequest.mockReset().mockReturnValue(true);
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sid: "SMout" }) })
		);
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("no longer tells the model to ask for another time when the restaurant is not accepting", async () => {
		const t = convexTest(schema, modules);
		await seedChannel(t, 0);
		let system = "";
		mockGenerateText.mockImplementation(async (args: { system: string }) => {
			system = args.system;
			return { text: "ok", toolCalls: [] };
		});

		await t.fetch("/whatsapp/inbound", {
			method: "POST",
			headers: INBOUND_HEADERS,
			body: inboundBody("hola"),
		});
		await t.finishAllScheduledFunctions(() => vi.runAllTimers());

		// The blanket instruction that produced the loop.
		expect(system).not.toContain(
			"If `alternatives` is empty, say so and ask what else would suit them"
		);
		// Its replacement: a terminal reason must not be answered with "try another time".
		expect(system).toContain("ERROR_NOT_ACCEPTING_RESERVATIONS");
		// ADR-011 drift: the assistant now takes a provisional table; the restaurant
		// confirms. The prompt must not claim the restaurant assigns it.
		expect(system).not.toContain("The restaurant confirms it and assigns a table");
	});
});
