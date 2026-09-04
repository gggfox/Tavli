/**
 * Auto-assignment at booking time (TAVLI-101).
 *
 * Before this, `createReservationCore` inserted `pending` rows with empty
 * `tableIds`, and `findOverlappingReservations` filters on
 * `r.tableIds.includes(tableId)` — so a pending reservation occupied no table
 * and consumed no capacity. Every booking for the same window passed the
 * availability check, and staff found out at service time.
 *
 * These tests pin the invariant that replaces it: **a reservation is admitted
 * only if a table was actually found for it**, so admission and placement are
 * the same decision.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { ymdHmToUtcMs } from "../_util/timezone";
import { RESERVATION_STATUS, TABLE_ASSIGNED_BY } from "../constants";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

const TZ = "America/Mexico_City";

/** Local wall-clock time in `TZ` as a UTC instant. */
function localAt(ymd: string, hm: string): number {
	const [h, m] = hm.split(":").map(Number);
	return ymdHmToUtcMs(ymd, h * 60 + m, TZ);
}

/** Tomorrow, so the booking horizon is satisfied without depending on the hour. */
function tomorrowYmd(): string {
	const d = new Date(Date.now() + 86_400_000);
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
		d.getUTCDate()
	).padStart(2, "0")}`;
}

async function seedRestaurant(
	t: ReturnType<typeof convexTest>,
	tables: Array<{ tableNumber: number; capacity: number }>
): Promise<Id<"restaurants">> {
	let restaurantId: Id<"restaurants">;
	await t.run(async (ctx) => {
		const organizationId = await ctx.db.insert("organizations", {
			name: "Placement Org",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner-placement",
			organizationId,
			name: "Placement Restaurant",
			slug: `placement-${Math.random().toString(36).slice(2, 10)}`,
			currency: "MXN",
			timezone: TZ,
			openTime: "10:00",
			closeTime: "23:00",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		for (const spec of tables) {
			await ctx.db.insert("tables", {
				restaurantId,
				tableNumber: spec.tableNumber,
				capacity: spec.capacity,
				isActive: true,
				createdAt: Date.now(),
			});
		}
		await ctx.db.insert("restaurantMembers", {
			restaurantId,
			organizationId,
			userId: "staff-placement",
			role: "manager",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});
	return restaurantId!;
}

function book(
	t: ReturnType<typeof convexTest>,
	restaurantId: Id<"restaurants">,
	partySize: number,
	hm: string,
	phone = "+525512345678"
) {
	return t.mutation(api.reservations.create, {
		restaurantId,
		partySize,
		startsAt: localAt(tomorrowYmd(), hm),
		contact: { name: "Ada", phone },
	});
}

describe("auto-assignment on create", () => {
	it("places the party on a real table and marks the placement as automatic", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, [
			{ tableNumber: 1, capacity: 8 },
			{ tableNumber: 2, capacity: 4 },
		]);

		const [reservationId, error] = await book(t, restaurantId, 3, "19:00");

		expect(error).toBeNull();
		const row = await t.run((ctx) => ctx.db.get(reservationId!));
		expect(row?.tableIds).toHaveLength(1);
		expect(row?.tableAssignedBy).toBe(TABLE_ASSIGNED_BY.AUTO);
		expect(row?.status).toBe(RESERVATION_STATUS.PENDING);

		// Smallest table that fits, not the first one found.
		const seated = await t.run((ctx) => ctx.db.get(row!.tableIds[0]));
		expect(seated?.tableNumber).toBe(2);
	});

	it("refuses a second booking once the only suitable table is taken", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, [{ tableNumber: 1, capacity: 4 }]);

		const [first, firstError] = await book(t, restaurantId, 4, "19:00", "+525500000001");
		expect(firstError).toBeNull();
		expect(first).not.toBeNull();

		const [second, secondError] = await book(t, restaurantId, 4, "19:30", "+525500000002");

		expect(second).toBeNull();
		expect(secondError?.message).toBe("ERROR_NO_TABLES_AVAILABLE");
	});

	it("keeps the booking pending — an auto placement is not a confirmation", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, [{ tableNumber: 1, capacity: 4 }]);

		const [reservationId] = await book(t, restaurantId, 2, "19:00");

		const row = await t.run((ctx) => ctx.db.get(reservationId!));
		expect(row?.status).toBe(RESERVATION_STATUS.PENDING);
		expect(row?.confirmedAt).toBeUndefined();
	});

	it("splits a large party across tables when no single table fits", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, [
			{ tableNumber: 1, capacity: 6 },
			{ tableNumber: 2, capacity: 6 },
		]);

		const [reservationId, error] = await book(t, restaurantId, 11, "19:00");

		expect(error).toBeNull();
		const row = await t.run((ctx) => ctx.db.get(reservationId!));
		expect(row?.tableIds).toHaveLength(2);
	});

	it("lets staff opt out of placement, leaving the row in the queue", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, [{ tableNumber: 1, capacity: 4 }]);
		const staff = t.withIdentity({ subject: "staff-placement" });

		const [reservationId, error] = await staff.mutation(api.reservations.createAsStaff, {
			restaurantId,
			partySize: 2,
			startsAt: localAt(tomorrowYmd(), "19:00"),
			contact: { name: "Ada", phone: "+525512345678" },
			leaveUnassigned: true,
		});

		expect(error).toBeNull();
		const row = await t.run((ctx) => ctx.db.get(reservationId!));
		expect(row?.tableIds).toEqual([]);
		expect(row?.tableAssignedBy).toBeUndefined();
	});
});

/**
 * Working the queue. Capacity frees up through a service as cancellations come
 * in, so a row a manager deliberately left unassigned at noon often has an
 * obvious table by 19:00 — without this they can only find it by hand.
 */
describe("placing a queued reservation", () => {
	it("finds a table for a queued row and marks the placement automatic", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, [{ tableNumber: 1, capacity: 4 }]);
		const staff = t.withIdentity({ subject: "staff-placement" });

		const [reservationId] = await staff.mutation(api.reservations.createAsStaff, {
			restaurantId,
			partySize: 2,
			startsAt: localAt(tomorrowYmd(), "19:00"),
			contact: { name: "Ada", phone: "+525512345678" },
			leaveUnassigned: true,
		});

		const [, error] = await staff.mutation(api.reservations.placeFromQueue, {
			reservationId: reservationId!,
		});

		expect(error).toBeNull();
		const row = await t.run((ctx) => ctx.db.get(reservationId!));
		expect(row?.tableIds).toHaveLength(1);
		// The machine chose it, so it stays provisional and re-placeable even
		// though a human clicked the button.
		expect(row?.tableAssignedBy).toBe(TABLE_ASSIGNED_BY.AUTO);
		expect(row?.status).toBe(RESERVATION_STATUS.PENDING);
	});

	it("reports back when the floor is still full", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, [{ tableNumber: 1, capacity: 4 }]);
		const staff = t.withIdentity({ subject: "staff-placement" });

		const [queued] = await staff.mutation(api.reservations.createAsStaff, {
			restaurantId,
			partySize: 4,
			startsAt: localAt(tomorrowYmd(), "19:00"),
			contact: { name: "Ada", phone: "+525512345678" },
			leaveUnassigned: true,
		});
		// Someone else takes the only table for that window.
		await book(t, restaurantId, 4, "19:00", "+525500000002");

		const [, error] = await staff.mutation(api.reservations.placeFromQueue, {
			reservationId: queued!,
		});

		expect(error?.message).toBe("ERROR_NO_TABLES_AVAILABLE");
		const row = await t.run((ctx) => ctx.db.get(queued!));
		expect(row?.tableIds).toEqual([]);
	});

	it("refuses a caller without access to the restaurant", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, [{ tableNumber: 1, capacity: 4 }]);
		const staff = t.withIdentity({ subject: "staff-placement" });

		const [queued] = await staff.mutation(api.reservations.createAsStaff, {
			restaurantId,
			partySize: 2,
			startsAt: localAt(tomorrowYmd(), "19:00"),
			contact: { name: "Ada", phone: "+525512345678" },
			leaveUnassigned: true,
		});

		const [, error] = await t
			.withIdentity({ subject: "outsider" })
			.mutation(api.reservations.placeFromQueue, { reservationId: queued! });

		expect(error).not.toBeNull();
	});
});
