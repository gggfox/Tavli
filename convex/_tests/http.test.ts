/**
 * HTTP boundary tests for the reservations-bot routes in `convex/http.ts`.
 *
 * The point of these is the *failure* shapes. Everything past the bearer-token
 * check is attacker-controlled, and the routes used to cast raw strings with
 * `as Id<...>`, so a malformed id reached Convex's arg validator and came back
 * as a 500 whose body spelled out the internal argument shape. Every assertion
 * below that expects a 4xx is really asserting "not a 500, and no internals".
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

// Must clear MIN_RESERVATIONS_BOT_TOKEN_LENGTH (32) or every request is a 401.
const BOT_TOKEN = "test-reservations-bot-token-0123456789";
const AUTH = { Authorization: `Bearer ${BOT_TOKEN}`, "Content-Type": "application/json" };

const AVAILABILITY_PATH = "/api/v1/reservations/availability";
const CREATE_PATH = "/api/v1/reservations";

function futureStartsAt(): number {
	// Comfortably inside the default booking horizon (min advance / max advance).
	return Date.now() + 3 * 24 * 60 * 60 * 1000;
}

async function seedRestaurant(
	t: ReturnType<typeof convexTest>,
	opts: { deleted?: boolean } = {}
): Promise<Id<"restaurants">> {
	let restaurantId: Id<"restaurants">;
	await t.run(async (ctx) => {
		const organizationId = await ctx.db.insert("organizations", {
			name: "Bot Org",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner-bot",
			organizationId,
			name: "Bot Test Restaurant",
			slug: `bot-${Math.random().toString(36).slice(2, 10)}`,
			currency: "MXN",
			isActive: true,
			deletedAt: opts.deleted ? Date.now() : undefined,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		// Without at least one active table every create is a capacity conflict,
		// which would mask the boundary behaviour these tests are about.
		await ctx.db.insert("tables", {
			restaurantId,
			tableNumber: 1,
			capacity: 4,
			isActive: true,
			createdAt: Date.now(),
		});
	});
	return restaurantId!;
}

function post(
	t: ReturnType<typeof convexTest>,
	path: string,
	body: unknown,
	headers: Record<string, string> = AUTH
): Promise<Response> {
	return t.fetch(path, {
		method: "POST",
		headers,
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
}

describe("reservations bot HTTP routes", () => {
	beforeEach(() => {
		vi.stubEnv("RESERVATIONS_BOT_TOKEN", BOT_TOKEN);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	describe("auth", () => {
		it("rejects a request with no Authorization header", async () => {
			const t = convexTest(schema, modules);
			const res = await post(t, AVAILABILITY_PATH, {}, { "Content-Type": "application/json" });
			expect(res.status).toBe(401);
		});

		it("rejects a request with the wrong token", async () => {
			const t = convexTest(schema, modules);
			const res = await post(t, AVAILABILITY_PATH, {}, { Authorization: "Bearer wrong-token" });
			expect(res.status).toBe(401);
		});

		it("rejects every request when the token is unset", async () => {
			vi.stubEnv("RESERVATIONS_BOT_TOKEN", "");
			const t = convexTest(schema, modules);
			const res = await post(t, AVAILABILITY_PATH, {});
			expect(res.status).toBe(401);
		});
	});

	describe("POST /api/v1/reservations/availability", () => {
		it("rejects a malformed JSON body with 400", async () => {
			const t = convexTest(schema, modules);
			const res = await post(t, AVAILABILITY_PATH, "{not json");
			expect(res.status).toBe(400);
			await expect(res.json()).resolves.toEqual({ error: "Invalid JSON body" });
		});

		it("rejects a non-object JSON body with 400", async () => {
			const t = convexTest(schema, modules);
			const res = await post(t, AVAILABILITY_PATH, '"just a string"');
			expect(res.status).toBe(400);
		});

		it("rejects a string partySize with 400", async () => {
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			// The old truthiness check let "5" through to the arg validator.
			const res = await post(t, AVAILABILITY_PATH, {
				restaurantId,
				partySize: "5",
				startsAt: futureStartsAt(),
			});
			expect(res.status).toBe(400);
		});

		it.each([0, -2, 2.5])("rejects partySize %s with 400", async (partySize) => {
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const res = await post(t, AVAILABILITY_PATH, {
				restaurantId,
				partySize,
				startsAt: futureStartsAt(),
			});
			expect(res.status).toBe(400);
		});

		it("rejects a non-numeric startsAt with 400", async () => {
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const res = await post(t, AVAILABILITY_PATH, {
				restaurantId,
				partySize: 2,
				startsAt: "2026-01-01",
			});
			expect(res.status).toBe(400);
		});

		it("returns 404 -- not 500 -- for a restaurantId that is not a valid Convex id", async () => {
			const t = convexTest(schema, modules);
			const res = await post(t, AVAILABILITY_PATH, {
				restaurantId: "definitely-not-an-id",
				partySize: 2,
				startsAt: futureStartsAt(),
			});
			expect(res.status).toBe(404);
			const body = await res.json();
			expect(body).toEqual({ error: "NOT_FOUND" });
			// The regression this guards: a validator message naming our args.
			expect(JSON.stringify(body)).not.toMatch(/validator|ArgumentValidationError|restaurantId:/i);
		});

		it("returns 404 for a soft-deleted restaurant", async () => {
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t, { deleted: true });
			const res = await post(t, AVAILABILITY_PATH, {
				restaurantId,
				partySize: 2,
				startsAt: futureStartsAt(),
			});
			expect(res.status).toBe(404);
		});

		it("returns availability for a valid request", async () => {
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const res = await post(t, AVAILABILITY_PATH, {
				restaurantId,
				partySize: 2,
				startsAt: futureStartsAt(),
			});
			expect(res.status).toBe(200);
			const body = (await res.json()) as { available: boolean; turnMinutes: number };
			expect(body).toHaveProperty("available");
			expect(typeof body.turnMinutes).toBe("number");
		});
	});

	describe("POST /api/v1/reservations", () => {
		const contact = { name: "Ada", phone: "+525512345678" };

		it("rejects a missing contact with 400", async () => {
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const res = await post(t, CREATE_PATH, {
				restaurantId,
				partySize: 2,
				startsAt: futureStartsAt(),
			});
			expect(res.status).toBe(400);
		});

		it("rejects a blank contact.phone with 400", async () => {
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const res = await post(t, CREATE_PATH, {
				restaurantId,
				partySize: 2,
				startsAt: futureStartsAt(),
				contact: { name: "Ada", phone: "   " },
			});
			expect(res.status).toBe(400);
		});

		it("rejects a non-string notes with 400", async () => {
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const res = await post(t, CREATE_PATH, {
				restaurantId,
				partySize: 2,
				startsAt: futureStartsAt(),
				contact,
				notes: { sneaky: true },
			});
			expect(res.status).toBe(400);
		});

		it("returns 404 -- not 500 -- for an unknown restaurantId", async () => {
			const t = convexTest(schema, modules);
			const res = await post(t, CREATE_PATH, {
				restaurantId: "definitely-not-an-id",
				partySize: 2,
				startsAt: futureStartsAt(),
				contact,
			});
			expect(res.status).toBe(404);
		});

		it("creates a reservation and returns 201", async () => {
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			const res = await post(t, CREATE_PATH, {
				restaurantId,
				partySize: 2,
				startsAt: futureStartsAt(),
				contact,
			});
			expect(res.status).toBe(201);
			const body = (await res.json()) as { reservationId: string };
			expect(typeof body.reservationId).toBe("string");

			const stored = await t.run(async (ctx) =>
				ctx.db.get(body.reservationId as Id<"reservations">)
			);
			expect(stored?.source).toBe("whatsapp");
		});

		it("returns only { name, message } on a domain error -- never the raw object", async () => {
			const t = convexTest(schema, modules);
			const restaurantId = await seedRestaurant(t);
			// Far outside the booking horizon -> a validation error from the core.
			const res = await post(t, CREATE_PATH, {
				restaurantId,
				partySize: 2,
				startsAt: Date.now() + 10 * 365 * 24 * 60 * 60 * 1000,
				contact,
			});
			expect(res.status).toBeGreaterThanOrEqual(400);
			const body = (await res.json()) as { error: Record<string, unknown> };
			expect(Object.keys(body.error).sort()).toEqual(["message", "name"]);
		});
	});
});
