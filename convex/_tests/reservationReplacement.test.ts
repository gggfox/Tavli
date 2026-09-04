/**
 * Re-placement on reschedule, and the decay of the `auto` marker (TAVLI-101).
 *
 * Auto-assignment introduces a regression if `reschedule` is left alone: the row
 * carries its machine-picked table into the new window and is rejected whenever
 * that one table is busy there — even with the rest of the room free. Nobody
 * chose that table, so nothing is lost by picking another.
 *
 * A `staff` placement is the opposite case: a human put this party on that
 * table, possibly for reasons the system cannot see, so a time change must not
 * quietly move them.
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

async function seed(t: ReturnType<typeof convexTest>, tableCount: number) {
	let restaurantId: Id<"restaurants">;
	const tableIds: Id<"tables">[] = [];
	await t.run(async (ctx) => {
		const organizationId = await ctx.db.insert("organizations", {
			name: "Replace Org",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner-replace",
			organizationId,
			name: "Replace Restaurant",
			slug: `replace-${Math.random().toString(36).slice(2, 10)}`,
			currency: "MXN",
			timezone: TZ,
			openTime: "10:00",
			closeTime: "23:00",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		for (let i = 0; i < tableCount; i++) {
			tableIds.push(
				await ctx.db.insert("tables", {
					restaurantId,
					tableNumber: i + 1,
					capacity: 4,
					isActive: true,
					createdAt: Date.now(),
				})
			);
		}
		await ctx.db.insert("restaurantMembers", {
			restaurantId,
			organizationId,
			userId: "staff-replace",
			role: "manager",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});
	return {
		restaurantId: restaurantId!,
		tableIds,
		staff: t.withIdentity({ subject: "staff-replace" }),
	};
}

function book(
	t: ReturnType<typeof convexTest>,
	restaurantId: Id<"restaurants">,
	hm: string,
	phone: string
) {
	return t.mutation(api.reservations.create, {
		restaurantId,
		partySize: 4,
		startsAt: localAt(tomorrowYmd(), hm),
		contact: { name: "Ada", phone },
	});
}

describe("reschedule re-places automatic assignments", () => {
	it("moves an auto-assigned party to a free table instead of rejecting the new time", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, staff } = await seed(t, 2);

		// Two bookings at 19:00 take both tables; smallest-fit + tie-break puts the
		// first on table 1 and the second on table 2.
		const [moving] = await book(t, restaurantId, "19:00", "+525500000001");
		const [blocker] = await book(t, restaurantId, "21:00", "+525500000002");

		const blockerRow = await t.run((ctx) => ctx.db.get(blocker!));
		const movingRow = await t.run((ctx) => ctx.db.get(moving!));
		// The blocker sits on the very table the mover would carry into 21:00.
		expect(blockerRow?.tableIds).toEqual(movingRow?.tableIds);

		const [, error] = await staff.mutation(api.reservations.reschedule, {
			reservationId: moving!,
			startsAt: localAt(tomorrowYmd(), "21:00"),
		});

		expect(error).toBeNull();
		const moved = await t.run((ctx) => ctx.db.get(moving!));
		expect(moved?.startsAt).toBe(localAt(tomorrowYmd(), "21:00"));
		// Re-placed onto the other table rather than refused.
		expect(moved?.tableIds).not.toEqual(blockerRow?.tableIds);
		expect(moved?.tableIds).toHaveLength(1);
		expect(moved?.tableAssignedBy).toBe(TABLE_ASSIGNED_BY.AUTO);
	});

	it("still refuses when the whole restaurant is full at the new time", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, staff } = await seed(t, 1);

		const [moving] = await book(t, restaurantId, "19:00", "+525500000001");
		await t.run(async (ctx) => {
			const tables = await ctx.db.query("tables").collect();
			await ctx.db.insert("reservations", {
				restaurantId,
				partySize: 4,
				startsAt: localAt(tomorrowYmd(), "21:00"),
				endsAt: localAt(tomorrowYmd(), "21:00") + 90 * 60_000,
				tableIds: [tables[0]._id],
				status: RESERVATION_STATUS.CONFIRMED,
				source: "staff",
				contact: { name: "Blocker", phone: "+525500000009" },
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		const [, error] = await staff.mutation(api.reservations.reschedule, {
			reservationId: moving!,
			startsAt: localAt(tomorrowYmd(), "21:00"),
		});

		expect(error?.message).toBe("ERROR_TABLE_UNAVAILABLE");
	});

	it("never re-places a table a human chose", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, tableIds, staff } = await seed(t, 2);

		const [reservationId] = await book(t, restaurantId, "19:00", "+525500000001");
		// Staff deliberately place them on table 2.
		await staff.mutation(api.reservations.confirm, {
			reservationId: reservationId!,
			tableIds: [tableIds[1]],
		});

		// Block table 2 at 21:00 while table 1 sits free.
		await t.run(async (ctx) => {
			await ctx.db.insert("reservations", {
				restaurantId,
				partySize: 4,
				startsAt: localAt(tomorrowYmd(), "21:00"),
				endsAt: localAt(tomorrowYmd(), "21:00") + 90 * 60_000,
				tableIds: [tableIds[1]],
				status: RESERVATION_STATUS.CONFIRMED,
				source: "staff",
				contact: { name: "Blocker", phone: "+525500000009" },
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		const [, error] = await staff.mutation(api.reservations.reschedule, {
			reservationId: reservationId!,
			startsAt: localAt(tomorrowYmd(), "21:00"),
		});

		// Refused rather than silently moved off the table a manager picked.
		expect(error?.message).toBe("ERROR_TABLE_UNAVAILABLE");
	});
});

describe("the auto marker decays through staff writes", () => {
	it("confirm promotes an automatic placement to a staff one", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, tableIds, staff } = await seed(t, 2);

		const [reservationId] = await book(t, restaurantId, "19:00", "+525500000001");
		const before = await t.run((ctx) => ctx.db.get(reservationId!));
		expect(before?.tableAssignedBy).toBe(TABLE_ASSIGNED_BY.AUTO);

		await staff.mutation(api.reservations.confirm, {
			reservationId: reservationId!,
			tableIds: [tableIds[0]],
		});

		const after = await t.run((ctx) => ctx.db.get(reservationId!));
		expect(after?.tableAssignedBy).toBe(TABLE_ASSIGNED_BY.STAFF);
	});

	it("an explicit table change on reschedule counts as a staff decision", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, tableIds, staff } = await seed(t, 2);

		const [reservationId] = await book(t, restaurantId, "19:00", "+525500000001");

		await staff.mutation(api.reservations.reschedule, {
			reservationId: reservationId!,
			tableIds: [tableIds[1]],
		});

		const after = await t.run((ctx) => ctx.db.get(reservationId!));
		expect(after?.tableIds).toEqual([tableIds[1]]);
		expect(after?.tableAssignedBy).toBe(TABLE_ASSIGNED_BY.STAFF);
	});

	it("seating a party pins the table they are physically sitting at", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, staff } = await seed(t, 2);

		const [reservationId] = await book(t, restaurantId, "19:00", "+525500000001");
		const row = await t.run((ctx) => ctx.db.get(reservationId!));
		// `markSeated` refuses a pending row, and `confirm` would already promote
		// the marker -- so the only way an auto placement reaches seating is a
		// walk-in on a booking that was cancelled first.
		await staff.mutation(api.reservations.cancel, { reservationId: reservationId! });

		await staff.mutation(api.reservations.markSeated, {
			reservationId: reservationId!,
			tableId: row!.tableIds[0],
		});

		const after = await t.run((ctx) => ctx.db.get(reservationId!));
		expect(after?.status).toBe(RESERVATION_STATUS.SEATED);
		expect(after?.tableAssignedBy).toBe(TABLE_ASSIGNED_BY.STAFF);
	});
});
