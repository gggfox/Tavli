/**
 * Bounds tests for `reservations.sweepNoShows`.
 *
 * The sweep runs every 15 minutes. It used to query `by_restaurant_time` with
 * only an upper bound and filter status in JS, so each run re-read the whole
 * reservation history of every restaurant -- cost grew forever while the work
 * to be done stayed flat. These tests pin the window, the status scoping, the
 * batch cap, and the soft-delete skip.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
	NO_SHOW_SWEEP_BATCH_SIZE,
	NO_SHOW_SWEEP_LOOKBACK_MS,
	RESERVATION_STATUS,
	type ReservationStatus,
} from "../constants";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

const HOUR_MS = 60 * 60 * 1000;
/** Comfortably past the 15-minute default `noShowGraceMinutes`. */
const PAST_GRACE_MS = 2 * HOUR_MS;

async function seedRestaurant(
	t: ReturnType<typeof convexTest>,
	opts: { deleted?: boolean } = {}
): Promise<Id<"restaurants">> {
	let restaurantId: Id<"restaurants">;
	await t.run(async (ctx) => {
		const organizationId = await ctx.db.insert("organizations", {
			name: "Sweep Org",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner-sweep",
			organizationId,
			name: "Sweep Restaurant",
			slug: `sweep-${Math.random().toString(36).slice(2, 10)}`,
			currency: "MXN",
			isActive: true,
			deletedAt: opts.deleted ? Date.now() : undefined,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});
	return restaurantId!;
}

async function insertReservation(
	t: ReturnType<typeof convexTest>,
	args: { restaurantId: Id<"restaurants">; status: ReservationStatus; startsAgoMs: number }
): Promise<Id<"reservations">> {
	let reservationId: Id<"reservations">;
	await t.run(async (ctx) => {
		const startsAt = Date.now() - args.startsAgoMs;
		reservationId = await ctx.db.insert("reservations", {
			restaurantId: args.restaurantId,
			partySize: 2,
			startsAt,
			endsAt: startsAt + 90 * 60 * 1000,
			tableIds: [],
			status: args.status,
			source: "ui",
			contact: { name: "Ada", phone: "+525512345678" },
			createdAt: startsAt,
			updatedAt: startsAt,
		});
	});
	return reservationId!;
}

function statusOf(t: ReturnType<typeof convexTest>, id: Id<"reservations">) {
	return t.run(async (ctx) => (await ctx.db.get(id))?.status);
}

describe("sweepNoShows", () => {
	it("flips pending and confirmed reservations past the grace period", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const pending = await insertReservation(t, {
			restaurantId,
			status: RESERVATION_STATUS.PENDING,
			startsAgoMs: PAST_GRACE_MS,
		});
		const confirmed = await insertReservation(t, {
			restaurantId,
			status: RESERVATION_STATUS.CONFIRMED,
			startsAgoMs: PAST_GRACE_MS,
		});

		const { flipped } = await t.mutation(internal.reservations.sweepNoShows, {});

		expect(flipped).toBe(2);
		await expect(statusOf(t, pending)).resolves.toBe(RESERVATION_STATUS.NO_SHOW);
		await expect(statusOf(t, confirmed)).resolves.toBe(RESERVATION_STATUS.NO_SHOW);
	});

	it("leaves reservations still inside the grace period alone", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		// Default noShowGraceMinutes is 15; one minute ago is well inside it.
		const recent = await insertReservation(t, {
			restaurantId,
			status: RESERVATION_STATUS.CONFIRMED,
			startsAgoMs: 60_000,
		});

		const { flipped } = await t.mutation(internal.reservations.sweepNoShows, {});

		expect(flipped).toBe(0);
		await expect(statusOf(t, recent)).resolves.toBe(RESERVATION_STATUS.CONFIRMED);
	});

	it.each([
		RESERVATION_STATUS.SEATED,
		RESERVATION_STATUS.COMPLETED,
		RESERVATION_STATUS.CANCELLED,
		RESERVATION_STATUS.NO_SHOW,
	])("leaves %s reservations alone", async (status) => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const row = await insertReservation(t, {
			restaurantId,
			status: status as ReservationStatus,
			startsAgoMs: PAST_GRACE_MS,
		});

		const { flipped } = await t.mutation(internal.reservations.sweepNoShows, {});

		expect(flipped).toBe(0);
		await expect(statusOf(t, row)).resolves.toBe(status);
	});

	it("does not read reservations older than the lookback window", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const ancient = await insertReservation(t, {
			restaurantId,
			status: RESERVATION_STATUS.CONFIRMED,
			startsAgoMs: NO_SHOW_SWEEP_LOOKBACK_MS + HOUR_MS,
		});
		const recent = await insertReservation(t, {
			restaurantId,
			status: RESERVATION_STATUS.CONFIRMED,
			startsAgoMs: PAST_GRACE_MS,
		});

		const { flipped } = await t.mutation(internal.reservations.sweepNoShows, {});

		expect(flipped).toBe(1);
		// Deliberate: a row this old keeps its last status rather than the sweep
		// re-reading unbounded history on every 15-minute run.
		await expect(statusOf(t, ancient)).resolves.toBe(RESERVATION_STATUS.CONFIRMED);
		await expect(statusOf(t, recent)).resolves.toBe(RESERVATION_STATUS.NO_SHOW);
	});

	it("skips soft-deleted restaurants", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, { deleted: true });
		const row = await insertReservation(t, {
			restaurantId,
			status: RESERVATION_STATUS.CONFIRMED,
			startsAgoMs: PAST_GRACE_MS,
		});

		const { flipped } = await t.mutation(internal.reservations.sweepNoShows, {});

		expect(flipped).toBe(0);
		await expect(statusOf(t, row)).resolves.toBe(RESERVATION_STATUS.CONFIRMED);
	});

	it("caps rows per status per run, and drains the remainder next run", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t);
		const overflow = 3;
		await t.run(async (ctx) => {
			for (let i = 0; i < NO_SHOW_SWEEP_BATCH_SIZE + overflow; i++) {
				// Spread starts so index order is deterministic; all past grace.
				const startsAt = Date.now() - PAST_GRACE_MS - i * 1000;
				await ctx.db.insert("reservations", {
					restaurantId,
					partySize: 2,
					startsAt,
					endsAt: startsAt + 90 * 60 * 1000,
					tableIds: [],
					status: RESERVATION_STATUS.CONFIRMED,
					source: "ui",
					contact: { name: `Guest ${i}`, phone: "+525512345678" },
					createdAt: startsAt,
					updatedAt: startsAt,
				});
			}
		});

		const first = await t.mutation(internal.reservations.sweepNoShows, {});
		expect(first.flipped).toBe(NO_SHOW_SWEEP_BATCH_SIZE);

		// Flipped rows leave the confirmed range, so the leftovers come next run.
		const second = await t.mutation(internal.reservations.sweepNoShows, {});
		expect(second.flipped).toBe(overflow);

		const stillConfirmed = await t.run(async (ctx) =>
			ctx.db
				.query("reservations")
				.withIndex("by_restaurant_status_time", (q) =>
					q.eq("restaurantId", restaurantId).eq("status", RESERVATION_STATUS.CONFIRMED)
				)
				.collect()
		);
		expect(stillConfirmed).toHaveLength(0);
	});
});
