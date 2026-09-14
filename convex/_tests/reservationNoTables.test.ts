/**
 * A restaurant with no tables is not taking reservations.
 *
 * Capacity is entirely table-derived: with no table rows, `placeParty` returns
 * `null` for every party at every time, which used to surface as
 * `ERROR_NO_TABLES_AVAILABLE` — the same code a fully booked floor produces.
 * The assistant then told diners "no tables at that time, try another?" for
 * every time that will ever exist. These tests pin the replacement: zero
 * active tables folds into `acceptingReservations: false`, so every surface
 * that already honours that flag tells the truth with no new reason code.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { loadEffectiveSettings } from "../_util/reservationSettings";
import { DEFAULT_RESERVATION_SETTINGS } from "../constants";
import schema from "../schema";
import { enableReservationsFlag } from "./helpers/reservationsFlag";

const modules = import.meta.glob("../**/*.ts");

const TZ = "America/Mexico_City";
const MANAGER = "manager-no-tables";

type TableSpec = { capacity: number; isActive?: boolean; deletedAt?: number };

/** Tomorrow, so the booking horizon is satisfied without depending on the hour. */
function tomorrowYmd(): string {
	const d = new Date(Date.now() + 86_400_000);
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
		d.getUTCDate()
	).padStart(2, "0")}`;
}

/**
 * A restaurant whose saved settings say it IS accepting reservations — so any
 * "not accepting" below is the tables, not the toggle.
 */
async function seedRestaurant(
	t: ReturnType<typeof convexTest>,
	tables: TableSpec[]
): Promise<Id<"restaurants">> {
	let restaurantId: Id<"restaurants">;
	await t.run(async (ctx) => {
		const organizationId = await ctx.db.insert("organizations", {
			name: "No Tables Org",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner-no-tables",
			organizationId,
			name: "No Tables Restaurant",
			slug: `no-tables-${Math.random().toString(36).slice(2, 10)}`,
			currency: "MXN",
			timezone: TZ,
			openTime: "10:00",
			closeTime: "23:00",
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
		for (const [i, spec] of tables.entries()) {
			await ctx.db.insert("tables", {
				restaurantId,
				tableNumber: i + 1,
				capacity: spec.capacity,
				isActive: spec.isActive ?? true,
				...(spec.deletedAt !== undefined && { deletedAt: spec.deletedAt }),
				createdAt: Date.now(),
			});
		}
		await enableReservationsFlag(ctx.db);
		await ctx.db.insert("restaurantMembers", {
			restaurantId,
			organizationId,
			userId: MANAGER,
			role: "manager",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});
	return restaurantId!;
}

describe("effective settings fold zero tables into not-accepting", () => {
	it("a restaurant with no tables is not accepting reservations, whatever its toggle says", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, []);

		const settings = await t.run((ctx) => loadEffectiveSettings(ctx, restaurantId));

		expect(settings.acceptingReservations).toBe(false);
		// The owner's own toggle is untouched — the fold is derived, never stored.
		expect(settings.acceptingReservationsSetting).toBe(true);
		expect(settings.hasActiveTables).toBe(false);
	});

	it("one active table is enough to accept", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, [{ capacity: 4 }]);

		const settings = await t.run((ctx) => loadEffectiveSettings(ctx, restaurantId));

		expect(settings.acceptingReservations).toBe(true);
		expect(settings.hasActiveTables).toBe(true);
	});

	it("a soft-deleted table does not count — staff removed it from the floor", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, [{ capacity: 4, deletedAt: Date.now() }]);

		const settings = await t.run((ctx) => loadEffectiveSettings(ctx, restaurantId));

		expect(settings.acceptingReservations).toBe(false);
	});

	it("an inactive table does not count", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, [{ capacity: 4, isActive: false }]);

		const settings = await t.run((ctx) => loadEffectiveSettings(ctx, restaurantId));

		expect(settings.acceptingReservations).toBe(false);
	});
});

describe("the assistant at a table-less restaurant", () => {
	it("is told 'not accepting', not 'no tables at that time' — and gets no alternatives to loop on", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, []);

		const result = await t.query(internal.whatsapp.reservations.internalCheckAvailabilityForBot, {
			restaurantId,
			partySize: 2,
			date: tomorrowYmd(),
			time: "13:00",
		});

		expect(result.available).toBe(false);
		expect(result.reason).toBe("ERROR_NOT_ACCEPTING_RESERVATIONS");
		expect(result.alternatives).toEqual([]);
	});

	it("has its booking declined as 'not accepting'", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, []);

		const result = await t.mutation(internal.whatsapp.reservations.internalBookForBot, {
			restaurantId,
			phone: "+15551230000",
			name: "Samuel",
			partySize: 5,
			date: tomorrowYmd(),
			time: "13:00",
			idempotencyKey: "whatsapp:SMtest:no-tables",
		});

		expect(result.booked).toBe(false);
		if (!result.booked) expect(result.reason).toBe("ERROR_NOT_ACCEPTING_RESERVATIONS");
	});
});

describe("the fold is derived, never stored", () => {
	it("a first save at a table-less restaurant keeps the owner's toggle ON", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, []);
		// No saved row yet — that is the case where `update` seeds from defaults.
		await t.run(async (ctx) => {
			const row = await ctx.db
				.query("reservationSettings")
				.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
				.first();
			if (row) await ctx.db.delete(row._id);
		});

		// The owner tweaks something unrelated before ever adding a table.
		const [id, error] = await t
			.withIdentity({ subject: MANAGER })
			.mutation(api.reservationSettings.update, { restaurantId, defaultTurnMinutes: 60 });
		expect(error).toBeNull();

		const stored = await t.run((ctx) => ctx.db.get(id as Id<"reservationSettings">));
		// Persisting the *effective* value here would switch reservations off for
		// good the moment tables were added — the exact opposite of the fold's intent.
		expect(stored?.acceptingReservations).toBe(true);
	});
});

describe("the assistant's booking context", () => {
	it("reads 'not accepting' at a table-less restaurant so the prompt says so up front", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, []);

		const context = await t.query(internal.whatsapp.reservations.internalGetBookingContextForBot, {
			restaurantId,
		});

		expect(context?.acceptingReservations).toBe(false);
	});

	it("reads 'accepting' once a table exists", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, [{ capacity: 4 }]);

		const context = await t.query(internal.whatsapp.reservations.internalGetBookingContextForBot, {
			restaurantId,
		});

		expect(context?.acceptingReservations).toBe(true);
	});
});
