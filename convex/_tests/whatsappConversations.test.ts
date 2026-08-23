/**
 * The staff-facing WhatsApp conversation view (TAVLI-93).
 *
 * Read-only, and open to any ACTIVE staff member of the restaurant — not
 * managers only. The entry point is a link on a reservation, and an employee
 * who can already read that reservation and its phone number but gets a dead
 * link is the worse experience. There is nothing to escalate: no send, no
 * takeover, no export.
 *
 * What these tests hold down is the part that is not obvious from the screen:
 * a conversation id is a client-supplied string, so every read derives the
 * restaurant from the row and checks the caller's access against *that* — never
 * against an id the client asserted.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import { ERROR_NAMES } from "../_shared/errors";
import type { Id } from "../_generated/dataModel";
import {
	RESTAURANT_MEMBER_ROLE,
	WHATSAPP_CONVERSATION_MAX_MESSAGES,
	WHATSAPP_CONVERSATION_PAGE_SIZE,
	WHATSAPP_MESSAGE_SENDER,
} from "../constants";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

const OWNER = "owner-user";
const EMPLOYEE_A = "employee-a";
const EMPLOYEE_B = "employee-b";
const SUSPENDED_A = "suspended-a";
const OUTSIDER = "outsider-user";

const CUSTOMER = "+528114906208";
const OTHER_CUSTOMER = "+528114906209";

type Restaurants = { a: Id<"restaurants">; b: Id<"restaurants"> };

/** Two restaurants in one organization, each with its own staff. */
async function seedWorld(t: ReturnType<typeof convexTest>): Promise<Restaurants> {
	return await t.run(async (ctx) => {
		const now = Date.now();
		const organizationId = await ctx.db.insert("organizations", {
			name: "Conv Org",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		const make = async (name: string) =>
			await ctx.db.insert("restaurants", {
				ownerId: OWNER,
				organizationId,
				name,
				slug: `conv-${name.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`,
				currency: "MXN",
				timezone: "America/Monterrey",
				isActive: true,
				createdAt: now,
				updatedAt: now,
			});
		const a = await make("A");
		const b = await make("B");

		const member = async (userId: string, restaurantId: Id<"restaurants">, isActive: boolean) =>
			await ctx.db.insert("restaurantMembers", {
				userId,
				restaurantId,
				organizationId,
				role: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
				isActive,
				createdAt: now,
				updatedAt: now,
			});
		await member(EMPLOYEE_A, a, true);
		await member(EMPLOYEE_B, b, true);
		await member(SUSPENDED_A, a, false);

		return { a, b };
	});
}

async function seedConversation(
	t: ReturnType<typeof convexTest>,
	args: {
		restaurantId: Id<"restaurants">;
		customerPhone?: string;
		customerName?: string;
		lastMessageAt?: number;
	}
): Promise<Id<"whatsappConversations">> {
	return await t.run(async (ctx) => {
		const now = args.lastMessageAt ?? Date.now();
		const channelId = await ctx.db.insert("whatsappChannels", {
			restaurantId: args.restaurantId,
			phoneNumber: `+1415523${Math.floor(Math.random() * 9000 + 1000)}`,
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		return await ctx.db.insert("whatsappConversations", {
			channelId,
			restaurantId: args.restaurantId,
			customerPhone: args.customerPhone ?? CUSTOMER,
			customerName: args.customerName,
			status: "active",
			lastMessageAt: now,
			lastInboundAt: now,
			createdAt: now,
			updatedAt: now,
		});
	});
}

async function seedMessages(
	t: ReturnType<typeof convexTest>,
	conversationId: Id<"whatsappConversations">,
	restaurantId: Id<"restaurants">,
	rows: Array<{
		direction: "inbound" | "outbound";
		body: string;
		modelBody?: string;
		sentBy?: "assistant" | "system" | "staff";
		deliveryFailedAt?: number;
	}>
) {
	await t.run(async (ctx) => {
		for (const [i, row] of rows.entries()) {
			await ctx.db.insert("whatsappMessages", {
				conversationId,
				restaurantId,
				direction: row.direction,
				body: row.body,
				modelBody: row.modelBody,
				sentBy: row.sentBy,
				deliveryFailedAt: row.deliveryFailedAt,
				createdAt: 1_700_000_000_000 + i,
			});
		}
	});
}

const as = (t: ReturnType<typeof convexTest>, userId: string) =>
	t.withIdentity({ subject: userId });

// ============================================================================
// The list
// ============================================================================

describe("whatsappConversations.listForRestaurant", () => {
	it("lists the restaurant's threads, most recently active first", async () => {
		const t = convexTest(schema, modules);
		const { a } = await seedWorld(t);
		await seedConversation(t, {
			restaurantId: a,
			customerPhone: CUSTOMER,
			lastMessageAt: 1_700_000_000_000,
		});
		await seedConversation(t, {
			restaurantId: a,
			customerPhone: OTHER_CUSTOMER,
			lastMessageAt: 1_700_000_900_000,
		});

		const [rows, error] = await as(t, EMPLOYEE_A).query(
			api.whatsappConversations.listForRestaurant,
			{ restaurantId: a }
		);

		expect(error).toBeNull();
		expect(rows?.map((r) => r.customerPhone)).toEqual([OTHER_CUSTOMER, CUSTOMER]);
	});

	it("never returns another restaurant's threads", async () => {
		const t = convexTest(schema, modules);
		const { a, b } = await seedWorld(t);
		await seedConversation(t, { restaurantId: a, customerPhone: CUSTOMER });
		await seedConversation(t, { restaurantId: b, customerPhone: OTHER_CUSTOMER });

		const [rows] = await as(t, EMPLOYEE_A).query(api.whatsappConversations.listForRestaurant, {
			restaurantId: a,
		});

		expect(rows?.map((r) => r.customerPhone)).toEqual([CUSTOMER]);
	});

	it("refuses a staff member of a different restaurant", async () => {
		const t = convexTest(schema, modules);
		const { a } = await seedWorld(t);
		await seedConversation(t, { restaurantId: a });

		const [rows, error] = await as(t, EMPLOYEE_B).query(
			api.whatsappConversations.listForRestaurant,
			{ restaurantId: a }
		);

		expect(rows).toBeNull();
		expect(error?.name).toBe(ERROR_NAMES.NOT_AUTHORIZED);
	});

	it("refuses a member whose access has been switched off", async () => {
		const t = convexTest(schema, modules);
		const { a } = await seedWorld(t);
		await seedConversation(t, { restaurantId: a });

		const [rows, error] = await as(t, SUSPENDED_A).query(
			api.whatsappConversations.listForRestaurant,
			{ restaurantId: a }
		);

		expect(rows).toBeNull();
		expect(error?.name).toBe(ERROR_NAMES.NOT_AUTHORIZED);
	});

	it("refuses an anonymous caller", async () => {
		const t = convexTest(schema, modules);
		const { a } = await seedWorld(t);

		const [rows, error] = await t.query(api.whatsappConversations.listForRestaurant, {
			restaurantId: a,
		});

		expect(rows).toBeNull();
		expect(error?.name).toBe(ERROR_NAMES.NOT_AUTHENTICATED);
	});
});

// ============================================================================
// The thread
// ============================================================================

describe("whatsappConversations.getThread", () => {
	it("shows what the diner actually received, not the model's context copy", async () => {
		const t = convexTest(schema, modules);
		const { a } = await seedWorld(t);
		const conversationId = await seedConversation(t, { restaurantId: a });
		await seedMessages(t, conversationId, a, [
			{ direction: "inbound", body: "¿tienen mesa?" },
			{
				direction: "outbound",
				// `body` is what went on the wire; `modelBody` deliberately omits the
				// server-composed confirmation line. Staff answering "but your bot
				// told me…" need the line the diner saw.
				body: "¡Sí! ✅ Reservación confirmada para 4 el viernes.",
				modelBody: "¡Sí!",
				sentBy: WHATSAPP_MESSAGE_SENDER.ASSISTANT,
			},
		]);

		const [thread, error] = await as(t, EMPLOYEE_A).query(api.whatsappConversations.getThread, {
			conversationId,
		});

		expect(error).toBeNull();
		expect(thread?.messages.map((m) => m.body)).toEqual([
			"¿tienen mesa?",
			"¡Sí! ✅ Reservación confirmada para 4 el viernes.",
		]);
		// `modelBody` must not even reach the client — nothing can render the
		// wrong one by accident.
		expect(JSON.stringify(thread)).not.toContain("modelBody");
	});

	it("marks a reply the diner never received", async () => {
		const t = convexTest(schema, modules);
		const { a } = await seedWorld(t);
		const conversationId = await seedConversation(t, { restaurantId: a });
		await seedMessages(t, conversationId, a, [
			{ direction: "inbound", body: "hola" },
			{
				direction: "outbound",
				body: "¡hola!",
				sentBy: WHATSAPP_MESSAGE_SENDER.ASSISTANT,
				deliveryFailedAt: 1_700_000_500_000,
			},
		]);

		const [thread] = await as(t, EMPLOYEE_A).query(api.whatsappConversations.getThread, {
			conversationId,
		});

		expect(thread?.messages[1].deliveryFailedAt).toBe(1_700_000_500_000);
	});

	it("attributes every outbound row, defaulting rows written before the field", async () => {
		const t = convexTest(schema, modules);
		const { a } = await seedWorld(t);
		const conversationId = await seedConversation(t, { restaurantId: a });
		await seedMessages(t, conversationId, a, [
			{ direction: "inbound", body: "hola" },
			// A row from before `sentBy` existed. No staff-reply path existed then
			// either, so reading it as the assistant cannot wrongly credit a human.
			{ direction: "outbound", body: "vieja", modelBody: "vieja" },
			{ direction: "outbound", body: "lo siento", sentBy: WHATSAPP_MESSAGE_SENDER.SYSTEM },
		]);

		const [thread] = await as(t, EMPLOYEE_A).query(api.whatsappConversations.getThread, {
			conversationId,
		});

		expect(thread?.messages.map((m) => m.sentBy)).toEqual([
			null,
			WHATSAPP_MESSAGE_SENDER.ASSISTANT,
			WHATSAPP_MESSAGE_SENDER.SYSTEM,
		]);
	});

	it("refuses a conversation id belonging to another restaurant", async () => {
		const t = convexTest(schema, modules);
		const { a } = await seedWorld(t);
		const conversationId = await seedConversation(t, { restaurantId: a });
		await seedMessages(t, conversationId, a, [{ direction: "inbound", body: "secreto" }]);

		// B's employee has a valid session and a real conversation id. The only
		// thing standing between them and A's diner is this check.
		const [thread, error] = await as(t, EMPLOYEE_B).query(api.whatsappConversations.getThread, {
			conversationId,
		});

		expect(thread).toBeNull();
		expect(error?.name).toBe(ERROR_NAMES.NOT_AUTHORIZED);
	});

	it("returns the newest page and says older messages exist", async () => {
		const t = convexTest(schema, modules);
		const { a } = await seedWorld(t);
		const conversationId = await seedConversation(t, { restaurantId: a });
		const total = WHATSAPP_CONVERSATION_PAGE_SIZE + 10;
		await seedMessages(
			t,
			conversationId,
			a,
			Array.from({ length: total }, (_, i) => ({
				direction: "inbound" as const,
				body: `msg-${i}`,
			}))
		);

		const [thread] = await as(t, EMPLOYEE_A).query(api.whatsappConversations.getThread, {
			conversationId,
		});

		expect(thread?.messages).toHaveLength(WHATSAPP_CONVERSATION_PAGE_SIZE);
		// Oldest-first inside the page, and the page is the *newest* slice.
		expect(thread?.messages[0].body).toBe(`msg-${total - WHATSAPP_CONVERSATION_PAGE_SIZE}`);
		expect(thread?.messages.at(-1)?.body).toBe(`msg-${total - 1}`);
		expect(thread?.hasOlder).toBe(true);
	});

	it("loads older messages when asked for a bigger window", async () => {
		const t = convexTest(schema, modules);
		const { a } = await seedWorld(t);
		const conversationId = await seedConversation(t, { restaurantId: a });
		const total = WHATSAPP_CONVERSATION_PAGE_SIZE + 10;
		await seedMessages(
			t,
			conversationId,
			a,
			Array.from({ length: total }, (_, i) => ({
				direction: "inbound" as const,
				body: `msg-${i}`,
			}))
		);

		const [thread] = await as(t, EMPLOYEE_A).query(api.whatsappConversations.getThread, {
			conversationId,
			limit: WHATSAPP_CONVERSATION_PAGE_SIZE * 2,
		});

		expect(thread?.messages).toHaveLength(total);
		expect(thread?.messages[0].body).toBe("msg-0");
		expect(thread?.hasOlder).toBe(false);
	});

	it("clamps an absurd limit so one thread can never blow the read budget", async () => {
		const t = convexTest(schema, modules);
		const { a } = await seedWorld(t);
		const conversationId = await seedConversation(t, { restaurantId: a });
		await seedMessages(
			t,
			conversationId,
			a,
			Array.from({ length: WHATSAPP_CONVERSATION_MAX_MESSAGES + 5 }, (_, i) => ({
				direction: "inbound" as const,
				body: `msg-${i}`,
			}))
		);

		const [thread] = await as(t, EMPLOYEE_A).query(api.whatsappConversations.getThread, {
			conversationId,
			limit: 100_000,
		});

		expect(thread?.messages).toHaveLength(WHATSAPP_CONVERSATION_MAX_MESSAGES);
		expect(thread?.hasOlder).toBe(true);
	});

	it("survives a limit the client made up", async () => {
		const t = convexTest(schema, modules);
		const { a } = await seedWorld(t);
		const conversationId = await seedConversation(t, { restaurantId: a });
		await seedMessages(t, conversationId, a, [
			{ direction: "inbound", body: "older" },
			{ direction: "inbound", body: "newest" },
		]);

		// `limit` is a client-supplied number and reaches `.take(limit + 1)`.
		// Unclamped, a negative one is an argument error the staff sees as a
		// broken screen rather than a conversation.
		const [thread, error] = await as(t, EMPLOYEE_A).query(api.whatsappConversations.getThread, {
			conversationId,
			limit: -5,
		});

		expect(error).toBeNull();
		expect(thread?.messages.map((m) => m.body)).toEqual(["newest"]);
		expect(thread?.hasOlder).toBe(true);
	});

	it("carries the customer's identity so the thread can be labelled", async () => {
		const t = convexTest(schema, modules);
		const { a } = await seedWorld(t);
		const conversationId = await seedConversation(t, {
			restaurantId: a,
			customerName: "Ana",
			customerPhone: CUSTOMER,
		});

		const [thread] = await as(t, EMPLOYEE_A).query(api.whatsappConversations.getThread, {
			conversationId,
		});

		expect(thread?.conversation).toMatchObject({ customerName: "Ana", customerPhone: CUSTOMER });
	});
});

// ============================================================================
// The reservation → conversation link
// ============================================================================

describe("whatsappConversations.getForReservation", () => {
	async function seedReservation(
		t: ReturnType<typeof convexTest>,
		restaurantId: Id<"restaurants">,
		args: { source: "whatsapp" | "ui" | "staff"; phone: string }
	): Promise<Id<"reservations">> {
		return await t.run((ctx) =>
			ctx.db.insert("reservations", {
				restaurantId,
				partySize: 2,
				startsAt: Date.now() + 3_600_000,
				endsAt: Date.now() + 7_200_000,
				tableIds: [],
				status: "pending",
				source: args.source,
				contact: { name: "Ana", phone: args.phone },
				createdAt: Date.now(),
				updatedAt: Date.now(),
			})
		);
	}

	it("resolves the thread a WhatsApp booking came from", async () => {
		const t = convexTest(schema, modules);
		const { a } = await seedWorld(t);
		const conversationId = await seedConversation(t, {
			restaurantId: a,
			customerPhone: CUSTOMER,
		});
		const reservationId = await seedReservation(t, a, { source: "whatsapp", phone: CUSTOMER });

		const [link, error] = await as(t, EMPLOYEE_A).query(
			api.whatsappConversations.getForReservation,
			{ reservationId }
		);

		expect(error).toBeNull();
		expect(link?.conversationId).toBe(conversationId);
	});

	it("has nothing to offer for a booking that did not come from WhatsApp", async () => {
		const t = convexTest(schema, modules);
		const { a } = await seedWorld(t);
		await seedConversation(t, { restaurantId: a, customerPhone: CUSTOMER });
		const reservationId = await seedReservation(t, a, { source: "ui", phone: CUSTOMER });

		const [link, error] = await as(t, EMPLOYEE_A).query(
			api.whatsappConversations.getForReservation,
			{ reservationId }
		);

		expect(error).toBeNull();
		expect(link).toBeNull();
	});

	it("never matches a same-phone thread at another restaurant", async () => {
		const t = convexTest(schema, modules);
		const { a, b } = await seedWorld(t);
		// The same diner messages both restaurants. A's staff must see A's thread
		// or nothing — never B's.
		await seedConversation(t, { restaurantId: b, customerPhone: CUSTOMER });
		const reservationId = await seedReservation(t, a, { source: "whatsapp", phone: CUSTOMER });

		const [link] = await as(t, EMPLOYEE_A).query(api.whatsappConversations.getForReservation, {
			reservationId,
		});

		expect(link).toBeNull();
	});

	it("refuses a caller who is not staff at the reservation's restaurant", async () => {
		const t = convexTest(schema, modules);
		const { a } = await seedWorld(t);
		await seedConversation(t, { restaurantId: a, customerPhone: CUSTOMER });
		const reservationId = await seedReservation(t, a, { source: "whatsapp", phone: CUSTOMER });

		const [link, error] = await as(t, OUTSIDER).query(api.whatsappConversations.getForReservation, {
			reservationId,
		});

		expect(link).toBeNull();
		expect(error?.name).toBe(ERROR_NAMES.NOT_AUTHORIZED);
	});
});
