/**
 * Corrections on reservations that already happened (TAVLI-71 item 9).
 *
 * A `completed` reservation is still in `ACTIVE_RESERVATION_STATUSES`, so it
 * keeps holding its table window for availability and double-booking checks.
 * That makes two staff mistakes expensive: a mistyped duration blocks the
 * table for hours it never occupied, and marking the wrong booking completed
 * blocks it entirely. These tests pin the two escape hatches — reschedule and
 * cancel — while keeping the terminal statuses closed.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { AUDIT_EVENT, RESERVATION_STATUS, type ReservationStatus } from "../constants";
import { MIN_RESERVATION_DURATION_MS } from "../reservationHelpers";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

type TestConvex = ReturnType<typeof convexTest<(typeof schema)["tables"]>>;

async function seedRestaurantWithStaff(t: TestConvex) {
	let restaurantId: Id<"restaurants">;
	let tableId: Id<"tables">;
	await t.run(async (ctx) => {
		const organizationId = await ctx.db.insert("organizations", {
			name: "Corrections Org",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner-corrections",
			organizationId,
			name: "Corrections Restaurant",
			slug: `corrections-${Math.random().toString(36).slice(2, 10)}`,
			currency: "MXN",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		tableId = await ctx.db.insert("tables", {
			restaurantId,
			tableNumber: 7,
			capacity: 4,
			isActive: true,
			createdAt: Date.now(),
		});
		await ctx.db.insert("restaurantMembers", {
			restaurantId,
			organizationId,
			userId: "staff-corrections",
			role: "manager",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});
	return {
		restaurantId: restaurantId!,
		tableId: tableId!,
		staff: t.withIdentity({ subject: "staff-corrections" }),
	};
}

/**
 * Inserts directly rather than walking the lifecycle: the mutations under test
 * only read `status`, and a completed visit lives in the past, which
 * `reservations.create` would refuse to book.
 */
async function insertReservation(
	t: TestConvex,
	args: {
		restaurantId: Id<"restaurants">;
		tableIds: Id<"tables">[];
		status: ReservationStatus;
		startsAt: number;
		endsAt: number;
	}
): Promise<Id<"reservations">> {
	let reservationId: Id<"reservations">;
	await t.run(async (ctx) => {
		reservationId = await ctx.db.insert("reservations", {
			restaurantId: args.restaurantId,
			partySize: 2,
			startsAt: args.startsAt,
			endsAt: args.endsAt,
			tableIds: args.tableIds,
			status: args.status,
			source: "ui",
			contact: { name: "Ada", phone: "+525512345678" },
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});
	return reservationId!;
}

/** A visit that finished yesterday, running two hours longer than it should. */
function pastVisitWindow(overrunHours = 3) {
	const startsAt = Date.now() - DAY_MS;
	return { startsAt, endsAt: startsAt + overrunHours * HOUR_MS };
}

describe("reservations.cancel on a completed visit", () => {
	it("cancels, records the reason, and emits the audit event", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, tableId, staff } = await seedRestaurantWithStaff(t);
		const { startsAt, endsAt } = pastVisitWindow();
		const reservationId = await insertReservation(t, {
			restaurantId,
			tableIds: [tableId],
			status: RESERVATION_STATUS.COMPLETED,
			startsAt,
			endsAt,
		});

		const [returnedId, error] = await staff.mutation(api.reservations.cancel, {
			reservationId,
			reason: "marked the wrong booking completed",
		});

		expect(error).toBeNull();
		expect(returnedId).toBe(reservationId);

		const row = await t.run((ctx) => ctx.db.get(reservationId));
		expect(row?.status).toBe(RESERVATION_STATUS.CANCELLED);
		expect(row?.cancelReason).toBe("marked the wrong booking completed");
		expect(row?.cancelledAt).toBeTypeOf("number");

		const events = await t.run((ctx) =>
			ctx.db
				.query("allEvents")
				.withIndex("by_event_type", (q) => q.eq("eventType", AUDIT_EVENT.RESERVATION_CANCELLED))
				.collect()
		);
		expect(events).toHaveLength(1);
		expect(events[0].userId).toBe("staff-corrections");
		expect(events[0].payload).toMatchObject({
			fromStatus: RESERVATION_STATUS.COMPLETED,
			reason: "marked the wrong booking completed",
		});
	});

	it("accepts a completed cancellation with no reason", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, tableId, staff } = await seedRestaurantWithStaff(t);
		const { startsAt, endsAt } = pastVisitWindow();
		const reservationId = await insertReservation(t, {
			restaurantId,
			tableIds: [tableId],
			status: RESERVATION_STATUS.COMPLETED,
			startsAt,
			endsAt,
		});

		const [, error] = await staff.mutation(api.reservations.cancel, { reservationId });

		expect(error).toBeNull();
		const row = await t.run((ctx) => ctx.db.get(reservationId));
		expect(row?.status).toBe(RESERVATION_STATUS.CANCELLED);
		expect(row?.cancelReason).toBeUndefined();
	});

	it.each([RESERVATION_STATUS.CANCELLED, RESERVATION_STATUS.NO_SHOW] as const)(
		"still refuses to cancel a %s reservation",
		async (status) => {
			const t = convexTest(schema, modules);
			const { restaurantId, tableId, staff } = await seedRestaurantWithStaff(t);
			const { startsAt, endsAt } = pastVisitWindow();
			const reservationId = await insertReservation(t, {
				restaurantId,
				tableIds: [tableId],
				status,
				startsAt,
				endsAt,
			});

			const [value, error] = await staff.mutation(api.reservations.cancel, { reservationId });

			expect(value).toBeNull();
			expect(error).not.toBeNull();
			const row = await t.run((ctx) => ctx.db.get(reservationId));
			expect(row?.status).toBe(status);
		}
	);
});

describe("reservations.reschedule on a completed visit", () => {
	it("shortens the duration even though the window is in the past", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, tableId, staff } = await seedRestaurantWithStaff(t);
		const { startsAt, endsAt } = pastVisitWindow(3);
		const reservationId = await insertReservation(t, {
			restaurantId,
			tableIds: [tableId],
			status: RESERVATION_STATUS.COMPLETED,
			startsAt,
			endsAt,
		});

		const correctedEndsAt = startsAt + HOUR_MS;
		const [returnedId, error] = await staff.mutation(api.reservations.reschedule, {
			reservationId,
			startsAt,
			endsAt: correctedEndsAt,
		});

		expect(error).toBeNull();
		expect(returnedId).toBe(reservationId);

		const row = await t.run((ctx) => ctx.db.get(reservationId));
		expect(row?.startsAt).toBe(startsAt);
		expect(row?.endsAt).toBe(correctedEndsAt);
		// The correction must not resurrect the booking into the active flow.
		expect(row?.status).toBe(RESERVATION_STATUS.COMPLETED);
		expect(row?.tableIds).toEqual([tableId]);
	});

	it("records the before/after window in the reschedule audit event", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, tableId, staff } = await seedRestaurantWithStaff(t);
		const { startsAt, endsAt } = pastVisitWindow(3);
		const reservationId = await insertReservation(t, {
			restaurantId,
			tableIds: [tableId],
			status: RESERVATION_STATUS.COMPLETED,
			startsAt,
			endsAt,
		});

		await staff.mutation(api.reservations.reschedule, {
			reservationId,
			endsAt: startsAt + HOUR_MS,
		});

		const events = await t.run((ctx) =>
			ctx.db
				.query("allEvents")
				.withIndex("by_event_type", (q) => q.eq("eventType", AUDIT_EVENT.RESERVATION_RESCHEDULED))
				.collect()
		);
		expect(events).toHaveLength(1);
		expect(events[0].payload).toMatchObject({
			fromStatus: RESERVATION_STATUS.COMPLETED,
			fromEndsAt: endsAt,
			toEndsAt: startsAt + HOUR_MS,
			reopened: false,
		});
	});

	it("still enforces the 15-minute minimum duration", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, tableId, staff } = await seedRestaurantWithStaff(t);
		const { startsAt, endsAt } = pastVisitWindow(3);
		const reservationId = await insertReservation(t, {
			restaurantId,
			tableIds: [tableId],
			status: RESERVATION_STATUS.COMPLETED,
			startsAt,
			endsAt,
		});

		const [value, error] = await staff.mutation(api.reservations.reschedule, {
			reservationId,
			endsAt: startsAt + MIN_RESERVATION_DURATION_MS - 60_000,
		});

		expect(value).toBeNull();
		expect(error).not.toBeNull();
		const row = await t.run((ctx) => ctx.db.get(reservationId));
		expect(row?.endsAt).toBe(endsAt);
	});

	it("still refuses an end that precedes the start", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, tableId, staff } = await seedRestaurantWithStaff(t);
		const { startsAt, endsAt } = pastVisitWindow(3);
		const reservationId = await insertReservation(t, {
			restaurantId,
			tableIds: [tableId],
			status: RESERVATION_STATUS.COMPLETED,
			startsAt,
			endsAt,
		});

		const [value, error] = await staff.mutation(api.reservations.reschedule, {
			reservationId,
			endsAt: startsAt - HOUR_MS,
		});

		expect(value).toBeNull();
		expect(error).not.toBeNull();
	});

	it("keeps the booking horizon for statuses that are still bookable", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, tableId, staff } = await seedRestaurantWithStaff(t);
		const { startsAt, endsAt } = pastVisitWindow(2);
		const reservationId = await insertReservation(t, {
			restaurantId,
			tableIds: [tableId],
			status: RESERVATION_STATUS.CONFIRMED,
			startsAt,
			endsAt,
		});

		const [value, error] = await staff.mutation(api.reservations.reschedule, {
			reservationId,
			startsAt,
			endsAt: startsAt + HOUR_MS,
		});

		expect(value).toBeNull();
		expect(error).toMatchObject({ message: "ERROR_OUTSIDE_BOOKING_HORIZON" });
	});
});
