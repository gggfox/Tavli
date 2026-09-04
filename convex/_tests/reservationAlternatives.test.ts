/**
 * Alternatives offered when the requested time is full (TAVLI-101).
 *
 * The search used to walk forward only, so a customer asking for 20:00 with the
 * earlier evening wide open was offered late-night slots and nothing else.
 * "Close to the time they asked for" is a distance, not a direction.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { ymdHmToUtcMs } from "../_util/timezone";
import { RESERVATION_STATUS } from "../constants";
import schema from "../schema";
import { enableReservationsFlag } from "./helpers/reservationsFlag";

const modules = import.meta.glob("../**/*.ts");

const TZ = "America/Mexico_City";

function localAt(ymd: string, hm: string): number {
	const [h, m] = hm.split(":").map(Number);
	return ymdHmToUtcMs(ymd, h * 60 + m, TZ);
}

function tomorrowYmd(): string {
	const d = new Date(Date.now() + 86_400_000);
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
		d.getUTCDate()
	).padStart(2, "0")}`;
}

/** One table, already taken 20:00–21:30. The evening either side is free. */
async function seedWithBookedTable(t: ReturnType<typeof convexTest>) {
	let restaurantId: Id<"restaurants">;
	await t.run(async (ctx) => {
		const organizationId = await ctx.db.insert("organizations", {
			name: "Alt Org",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner-alt",
			organizationId,
			name: "Alt Restaurant",
			slug: `alt-${Math.random().toString(36).slice(2, 10)}`,
			currency: "MXN",
			timezone: TZ,
			openTime: "10:00",
			closeTime: "23:00",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		const tableId = await ctx.db.insert("tables", {
			restaurantId,
			tableNumber: 1,
			capacity: 4,
			isActive: true,
			createdAt: Date.now(),
		});
		// TAVLI-100 gates customer-facing reservations behind a flag that ships OFF.
		await enableReservationsFlag(ctx.db);
		await ctx.db.insert("reservations", {
			restaurantId,
			partySize: 4,
			startsAt: localAt(tomorrowYmd(), "20:00"),
			endsAt: localAt(tomorrowYmd(), "21:30"),
			tableIds: [tableId],
			status: RESERVATION_STATUS.CONFIRMED,
			source: "staff",
			contact: { name: "Blocker", phone: "+525500000009" },
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});
	return restaurantId!;
}

describe("suggested alternatives", () => {
	it("offers an earlier slot the forward-only search could never reach", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedWithBookedTable(t);

		const result = await t.query(api.reservations.getAvailability, {
			restaurantId,
			partySize: 4,
			startsAt: localAt(tomorrowYmd(), "20:00"),
		});

		expect(result.available).toBe(false);
		expect(result.suggestedTimes).toContain(localAt(tomorrowYmd(), "18:30"));
	});

	it("never suggests a time outside operating hours", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedWithBookedTable(t);

		// 10:30 is bookable; searching backwards from it runs straight into
		// opening time, which must not be offered.
		const result = await t.query(api.reservations.getAvailability, {
			restaurantId,
			partySize: 4,
			startsAt: localAt(tomorrowYmd(), "20:00"),
		});

		const openAt = localAt(tomorrowYmd(), "10:00");
		const closeAt = localAt(tomorrowYmd(), "23:00");
		for (const suggestion of result.suggestedTimes) {
			expect(suggestion).toBeGreaterThanOrEqual(openAt);
			expect(suggestion).toBeLessThan(closeAt);
		}
	});

	it("caps the list so the reply stays short", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedWithBookedTable(t);

		const result = await t.query(api.reservations.getAvailability, {
			restaurantId,
			partySize: 4,
			startsAt: localAt(tomorrowYmd(), "20:00"),
		});

		expect(result.suggestedTimes.length).toBeLessThanOrEqual(3);
	});
});

/**
 * The availability query and the create path must answer the same question.
 * They are two different code paths reading the same world, and a disagreement
 * is worse than either being wrong alone: the assistant promises a table, then
 * booking refuses it, and the customer is told the slot vanished mid-sentence.
 */
describe("availability agrees with what booking will do", () => {
	it("reports a soft-deleted table as unavailable, exactly as create does", async () => {
		const t = convexTest(schema, modules);
		let restaurantId: Id<"restaurants">;
		await t.run(async (ctx) => {
			const organizationId = await ctx.db.insert("organizations", {
				name: "Agree Org",
				isActive: true,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
			restaurantId = await ctx.db.insert("restaurants", {
				ownerId: "owner-agree",
				organizationId,
				name: "Agree Restaurant",
				slug: `agree-${Math.random().toString(36).slice(2, 10)}`,
				currency: "MXN",
				timezone: TZ,
				openTime: "10:00",
				closeTime: "23:00",
				isActive: true,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
			// TAVLI-100 gates customer-facing reservations behind a flag that ships OFF.
			await enableReservationsFlag(ctx.db);
			// Removed from the floor, but `tables.remove` leaves `isActive: true`.
			await ctx.db.insert("tables", {
				restaurantId,
				tableNumber: 1,
				capacity: 4,
				isActive: true,
				createdAt: Date.now(),
				deletedAt: Date.now(),
				deletedBy: "owner-agree",
				hardDeleteAfterAt: Date.now() + 86_400_000,
			});
		});

		const startsAt = localAt(tomorrowYmd(), "19:00");
		const availability = await t.query(api.reservations.getAvailability, {
			restaurantId: restaurantId!,
			partySize: 4,
			startsAt,
		});
		const [created, createError] = await t.mutation(api.reservations.create, {
			restaurantId: restaurantId!,
			partySize: 4,
			startsAt,
			contact: { name: "Ada", phone: "+525512345678" },
		});

		expect(created).toBeNull();
		expect(createError?.message).toBe("ERROR_NO_TABLES_AVAILABLE");
		expect(availability.available).toBe(false);
	});
});

/**
 * When the assistant cannot book, it must be able to say *why* and offer
 * something in the same breath. Returning a bare error code would leave the
 * model to either guess alternatives or make a second tool call — and a model
 * inventing times is exactly what the tool boundary exists to prevent.
 */
describe("the assistant's booking failure carries alternatives", () => {
	it("returns nearby times when the requested one is full", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedWithBookedTable(t);

		const result = await t.mutation(internal.whatsapp.reservations.internalBookForBot, {
			restaurantId,
			phone: "+15551230000",
			name: "Ada",
			partySize: 4,
			date: tomorrowYmd(),
			time: "20:00",
			idempotencyKey: `test-${Math.random()}`,
		});

		expect(result.booked).toBe(false);
		expect(result.reason).toBe("ERROR_NO_TABLES_AVAILABLE");
		// Local wall-clock strings, never epoch ms — the model must have no
		// timestamp to invent variations of.
		expect(result.alternatives).toContainEqual({ date: tomorrowYmd(), time: "18:30" });
	});

	it("offers nothing to invent when the failure is not about capacity", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedWithBookedTable(t);

		const result = await t.mutation(internal.whatsapp.reservations.internalBookForBot, {
			restaurantId,
			phone: "+15551230000",
			name: "Ada",
			partySize: 4,
			date: tomorrowYmd(),
			time: "03:00",
			idempotencyKey: `test-${Math.random()}`,
		});

		expect(result.booked).toBe(false);
		expect(result.alternatives).toEqual([]);
	});
});
