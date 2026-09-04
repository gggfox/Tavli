/**
 * Alternatives offered when the requested time is full (TAVLI-101).
 *
 * The search used to walk forward only, so a customer asking for 20:00 with the
 * earlier evening wide open was offered late-night slots and nothing else.
 * "Close to the time they asked for" is a distance, not a direction.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { ymdHmToUtcMs } from "../_util/timezone";
import { RESERVATION_STATUS } from "../constants";
import schema from "../schema";

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
