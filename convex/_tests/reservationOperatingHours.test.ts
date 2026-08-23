/**
 * Operating-hours gating and the bounded conflict scan.
 *
 * Availability used to ignore `openTime`/`closeTime` entirely — those were
 * treated as Timeline rendering bounds — so a 03:00 booking succeeded whenever a
 * table happened to be free. That is tolerable for a staff-typed booking and not
 * for a customer form or an assistant, so non-staff sources are now gated.
 *
 * These tests also pin the lower bound on `findOverlappingReservations`' index
 * range. Without it that read starts at the beginning of the restaurant's
 * history, once per table, twice over — enough stale rows and every booking path
 * blows the per-transaction read limit.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
	isWithinOperatingHours,
	resolveServiceWindow,
	computeTurnMinutes,
} from "../_util/availability";
import { ymdHmToUtcMs } from "../_util/timezone";
import { MAX_RESERVATION_TURN_MINUTES, RESERVATION_SOURCE } from "../constants";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

const TZ = "America/Mexico_City";

function window(openTime: string, closeTime: string, timezone = TZ) {
	return resolveServiceWindow({ openTime, closeTime, timezone });
}

/** Local wall-clock time in `TZ` as a UTC instant. */
function localAt(ymd: string, hm: string, timezone = TZ): number {
	const [h, m] = hm.split(":").map(Number);
	return ymdHmToUtcMs(ymd, h * 60 + m, timezone);
}

async function seedRestaurant(
	t: ReturnType<typeof convexTest>,
	opts: { openTime?: string; closeTime?: string; tables?: number } = {}
): Promise<Id<"restaurants">> {
	let restaurantId: Id<"restaurants">;
	await t.run(async (ctx) => {
		const organizationId = await ctx.db.insert("organizations", {
			name: "Hours Org",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner-hours",
			organizationId,
			name: "Hours Restaurant",
			slug: `hours-${Math.random().toString(36).slice(2, 10)}`,
			currency: "MXN",
			timezone: TZ,
			openTime: opts.openTime,
			closeTime: opts.closeTime,
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		for (let i = 0; i < (opts.tables ?? 1); i++) {
			await ctx.db.insert("tables", {
				restaurantId,
				tableNumber: i + 1,
				capacity: 4,
				isActive: true,
				createdAt: Date.now(),
			});
		}
	});
	return restaurantId!;
}

const CONTACT = { name: "Ada", phone: "+15550001111" };

describe("isWithinOperatingHours", () => {
	const day = "2026-08-12";

	it("accepts a reservation fully inside the window", () => {
		expect(
			isWithinOperatingHours({
				startsAt: localAt(day, "20:00"),
				endsAt: localAt(day, "21:30"),
				window: window("10:00", "23:00"),
			})
		).toBe(true);
	});

	it("rejects a start before opening", () => {
		expect(
			isWithinOperatingHours({
				startsAt: localAt(day, "09:00"),
				endsAt: localAt(day, "10:30"),
				window: window("10:00", "23:00"),
			})
		).toBe(false);
	});

	it("bounds the whole reservation, not just its start", () => {
		// 22:00 is open, but a 90-minute turn runs to 23:30 — past close. The last
		// bookable start against a 23:00 close is 21:30.
		expect(
			isWithinOperatingHours({
				startsAt: localAt(day, "22:00"),
				endsAt: localAt(day, "23:30"),
				window: window("10:00", "23:00"),
			})
		).toBe(false);
		expect(
			isWithinOperatingHours({
				startsAt: localAt(day, "21:30"),
				endsAt: localAt(day, "23:00"),
				window: window("10:00", "23:00"),
			})
		).toBe(true);
	});

	it("attributes an after-midnight booking to the previous service day", () => {
		const overnight = window("18:00", "02:00");
		expect(overnight.isOvernight).toBe(true);
		// 01:00 belongs to yesterday's 18:00–02:00 service, not to today's window
		// which has not opened yet.
		expect(
			isWithinOperatingHours({
				startsAt: localAt("2026-08-13", "01:00"),
				endsAt: localAt("2026-08-13", "01:45"),
				window: overnight,
			})
		).toBe(true);
		expect(
			isWithinOperatingHours({
				startsAt: localAt("2026-08-13", "03:00"),
				endsAt: localAt("2026-08-13", "04:00"),
				window: overnight,
			})
		).toBe(false);
	});

	it("falls back to 10:00-23:00 when hours are unset", () => {
		const fallback = resolveServiceWindow({
			openTime: undefined,
			closeTime: undefined,
			timezone: TZ,
		});
		expect(fallback.openMinutes).toBe(600);
		expect(fallback.closeMinutes).toBe(1380);
		expect(
			isWithinOperatingHours({
				startsAt: localAt(day, "03:00"),
				endsAt: localAt(day, "04:00"),
				window: fallback,
			})
		).toBe(false);
	});

	it("handles a DST transition day", () => {
		// Mexico abolished DST in 2022, so exercise this with a zone that still has
		// it. 2026-03-08 is the US spring-forward date: 02:00 local does not exist.
		const ny = window("10:00", "23:00", "America/New_York");
		expect(
			isWithinOperatingHours({
				startsAt: localAt("2026-03-08", "12:00", "America/New_York"),
				endsAt: localAt("2026-03-08", "13:30", "America/New_York"),
				window: ny,
			})
		).toBe(true);
		expect(
			isWithinOperatingHours({
				startsAt: localAt("2026-03-08", "06:00", "America/New_York"),
				endsAt: localAt("2026-03-08", "07:00", "America/New_York"),
				window: ny,
			})
		).toBe(false);
	});
});

describe("computeTurnMinutes clamp", () => {
	it("caps a misconfigured turn so the bounded conflict scan stays correct", () => {
		expect(computeTurnMinutes({ defaultTurnMinutes: 90, turnMinutesByCapacity: [] }, 2)).toBe(90);
		expect(
			computeTurnMinutes({ defaultTurnMinutes: 60 * 24 * 3, turnMinutesByCapacity: [] }, 2)
		).toBe(MAX_RESERVATION_TURN_MINUTES);
		expect(
			computeTurnMinutes(
				{
					defaultTurnMinutes: 90,
					turnMinutesByCapacity: [{ minPartySize: 1, maxPartySize: 4, turnMinutes: 99_999 }],
				},
				2
			)
		).toBe(MAX_RESERVATION_TURN_MINUTES);
	});

	it("coerces a non-positive turn to a minimum rather than producing endsAt <= startsAt", () => {
		expect(computeTurnMinutes({ defaultTurnMinutes: 0, turnMinutesByCapacity: [] }, 2)).toBe(1);
	});
});

describe("operating hours on the create path", () => {
	/** Tomorrow in the restaurant's timezone, so the booking horizon is satisfied. */
	function tomorrowYmd(): string {
		const d = new Date(Date.now() + 86_400_000);
		return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
			d.getUTCDate()
		).padStart(2, "0")}`;
	}

	it("rejects an out-of-hours WhatsApp booking and writes nothing", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, { openTime: "10:00", closeTime: "23:00" });

		const [id, error] = await t.mutation(internal.reservations.internalCreate, {
			restaurantId,
			partySize: 2,
			startsAt: localAt(tomorrowYmd(), "03:00"),
			contact: CONTACT,
			source: RESERVATION_SOURCE.WHATSAPP,
		});

		expect(id).toBeNull();
		expect(error?.message).toBe("ERROR_OUTSIDE_OPERATING_HOURS");
		const rows = await t.run((ctx) => ctx.db.query("reservations").collect());
		expect(rows).toHaveLength(0);
	});

	it("accepts an in-hours WhatsApp booking", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, { openTime: "10:00", closeTime: "23:00" });

		const [id, error] = await t.mutation(internal.reservations.internalCreate, {
			restaurantId,
			partySize: 2,
			startsAt: localAt(tomorrowYmd(), "20:00"),
			contact: CONTACT,
			source: RESERVATION_SOURCE.WHATSAPP,
		});

		expect(error).toBeNull();
		expect(id).toBeTruthy();
	});

	it("rejects an out-of-hours customer-form booking too", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, { openTime: "10:00", closeTime: "23:00" });

		const [id, error] = await t.mutation(internal.reservations.internalCreate, {
			restaurantId,
			partySize: 2,
			startsAt: localAt(tomorrowYmd(), "03:00"),
			contact: CONTACT,
			source: RESERVATION_SOURCE.UI,
		});

		expect(id).toBeNull();
		expect(error?.message).toBe("ERROR_OUTSIDE_OPERATING_HOURS");
	});

	it("lets staff override for private and after-hours events", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, { openTime: "10:00", closeTime: "23:00" });

		const [id, error] = await t.mutation(internal.reservations.internalCreate, {
			restaurantId,
			partySize: 2,
			startsAt: localAt(tomorrowYmd(), "03:00"),
			contact: CONTACT,
			source: RESERVATION_SOURCE.STAFF,
		});

		expect(error).toBeNull();
		expect(id).toBeTruthy();
	});

	it("reports the reason through the public availability query", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, { openTime: "10:00", closeTime: "23:00" });

		const outOfHours = await t.query(api.reservations.getAvailability, {
			restaurantId,
			partySize: 2,
			startsAt: localAt(tomorrowYmd(), "03:00"),
		});
		expect(outOfHours.available).toBe(false);
		expect(outOfHours.reason).toBe("ERROR_OUTSIDE_OPERATING_HOURS");

		const inHours = await t.query(api.reservations.getAvailability, {
			restaurantId,
			partySize: 2,
			startsAt: localAt(tomorrowYmd(), "20:00"),
		});
		expect(inHours.available).toBe(true);
	});

	it("only offers day slots that fit inside opening hours", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, { openTime: "18:00", closeTime: "22:00" });
		const ymd = tomorrowYmd();

		const { slots, turnMinutes } = await t.query(api.reservations.listReservationSlotsForDay, {
			restaurantId,
			partySize: 2,
			fromMs: localAt(ymd, "00:00"),
			toMs: localAt(ymd, "23:59"),
		});

		expect(slots.length).toBeGreaterThan(0);
		const open = localAt(ymd, "18:00");
		const close = localAt(ymd, "22:00");
		for (const slot of slots) {
			expect(slot).toBeGreaterThanOrEqual(open);
			expect(slot + turnMinutes * 60_000).toBeLessThanOrEqual(close);
		}
	});
});

describe("bounded conflict scan", () => {
	it("ignores history far outside the requested window", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, { openTime: "10:00", closeTime: "23:00" });
		const tableId = await t.run(async (ctx) => {
			const table = await ctx.db
				.query("tables")
				.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
				.first();
			return table!._id;
		});

		// Old confirmed reservations on the same table, well before the window.
		await t.run(async (ctx) => {
			for (let i = 1; i <= 40; i++) {
				const startsAt = Date.now() - i * 7 * 86_400_000;
				await ctx.db.insert("reservations", {
					restaurantId,
					partySize: 2,
					startsAt,
					endsAt: startsAt + 90 * 60_000,
					tableIds: [tableId],
					status: "completed",
					source: RESERVATION_SOURCE.UI,
					contact: { name: "Old", phone: "+15550009999" },
					createdAt: startsAt,
					updatedAt: startsAt,
				});
			}
		});

		const d = new Date(Date.now() + 86_400_000);
		const ymd = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
			d.getUTCDate()
		).padStart(2, "0")}`;

		// The only table is free tomorrow evening despite all that history.
		const availability = await t.query(api.reservations.getAvailability, {
			restaurantId,
			partySize: 2,
			startsAt: localAt(ymd, "20:00"),
		});
		expect(availability.available).toBe(true);
	});

	it("still detects a genuine overlap that starts before the window", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, { openTime: "10:00", closeTime: "23:00" });
		const tableId = await t.run(async (ctx) => {
			const table = await ctx.db
				.query("tables")
				.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
				.first();
			return table!._id;
		});

		const d = new Date(Date.now() + 86_400_000);
		const ymd = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
			d.getUTCDate()
		).padStart(2, "0")}`;
		const conflictStart = localAt(ymd, "19:30");

		await t.run(async (ctx) => {
			await ctx.db.insert("reservations", {
				restaurantId,
				partySize: 4,
				startsAt: conflictStart,
				endsAt: conflictStart + 90 * 60_000,
				tableIds: [tableId],
				status: "confirmed",
				source: RESERVATION_SOURCE.UI,
				contact: { name: "Sitting", phone: "+15550008888" },
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		// 20:00 starts after 19:30 but inside its turn — the lower bound must not
		// have excluded it.
		const availability = await t.query(api.reservations.getAvailability, {
			restaurantId,
			partySize: 2,
			startsAt: localAt(ymd, "20:00"),
		});
		expect(availability.available).toBe(false);
		expect(availability.reason).toBe("ERROR_NO_TABLES_AVAILABLE");
	});
});
