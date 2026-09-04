/**
 * The platform reservations switch, and walk-in occupancy (TAVLI-100).
 *
 * The gate tests all check the same thing from four angles: **hiding a tab is
 * not a gate**. The Reserve tab lives in the client bundle, the mutation name
 * lives in the client bundle, and the WhatsApp assistant never touches the web
 * UI at all. A switch that only hides things is a switch that a restaurant
 * finds out about when someone walks in holding a booking confirmation.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { FEATURE_FLAGS } from "../featureFlags";
import { WALK_IN_LOCK_REASON } from "../walkInOccupancy";
import { DEFAULT_RESTAURANT_TIMEZONE } from "../constants";
import { addDaysToYmd, utcMsToYmdInTimezone, ymdHmToUtcMs } from "../_util/timezone";

const modules = import.meta.glob("../**/*.ts");

function harness() {
	return convexTest(schema, modules);
}
type T = ReturnType<typeof harness>;

/** Fixed timestamp for row bookkeeping (createdAt etc.), never for windows. */
const NOW = 1_750_000_000_000;

/**
 * Tomorrow at 13:00 in the restaurant's timezone.
 *
 * Relative to the real clock, because the horizon check is — a fixed past
 * constant reads as ERROR_OUTSIDE_BOOKING_HORIZON, which looks like a flag bug
 * and is not one. But the *hour* is pinned, which a bare `Date.now() + 3h` is
 * not: that inherits the current wall-clock hour, so from about 19:30 local the
 * booking's 90-minute turn ran past the seeded 23:59 close and every one of
 * these tests failed with ERROR_OUTSIDE_OPERATING_HOURS. The seed already tries
 * to dodge that with a round-the-clock window, but 23:59 is not round the clock
 * for a booking whose turn crosses midnight.
 */
const soon = () => {
	const tomorrow = addDaysToYmd(utcMsToYmdInTimezone(Date.now(), DEFAULT_RESTAURANT_TIMEZONE), 1);
	return ymdHmToUtcMs(tomorrow, 13 * 60, DEFAULT_RESTAURANT_TIMEZONE);
};
const DINER = "diner-user";

async function seed(t: T, options: { reservationsFlag?: boolean } = {}) {
	return t.run(async (ctx) => {
		const organizationId = await ctx.db.insert("organizations", {
			name: "Org",
			slug: "org",
			isActive: true,
			createdAt: NOW,
			updatedAt: NOW,
		});
		const restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner",
			organizationId,
			name: "Tacos",
			slug: "tacos",
			currency: "MXN",
			isActive: true,
			// Round-the-clock on purpose. This suite is about the flag, and
			// narrow operating hours make it fail or pass depending on what time
			// CI happens to run — a known flake source in this repo.
			openTime: "00:00",
			closeTime: "23:59",
			createdAt: NOW,
			updatedAt: NOW,
		});
		const sectionId = await ctx.db.insert("sections", {
			restaurantId,
			name: "Main",
			displayOrder: 0,
			isActive: true,
			createdAt: NOW,
			updatedAt: NOW,
		});
		if (options.reservationsFlag !== undefined) {
			await ctx.db.insert("featureFlags", {
				key: FEATURE_FLAGS.RESERVATIONS,
				enabled: options.reservationsFlag,
				createdAt: NOW,
				updatedAt: NOW,
			});
		}
		return { organizationId, restaurantId, sectionId };
	});
}

async function seedTable(
	t: T,
	seeded: { restaurantId: Id<"restaurants">; sectionId: Id<"sections"> },
	tableNumber: number,
	capacity = 4
) {
	return t.run(async (ctx) =>
		ctx.db.insert("tables", {
			restaurantId: seeded.restaurantId,
			sectionId: seeded.sectionId,
			tableNumber,
			capacity,
			isActive: true,
			createdAt: NOW,
		})
	);
}

describe("isBookableByDiners", () => {
	it("is false when the platform flag has no row at all", () => {
		// A deployment that never ran the seed has reservations dark. That is
		// the intended dark-launch posture, not an accident — but it must be
		// unambiguous, because it is also what a fresh environment looks like.
		return (async () => {
			const t = harness();
			const seeded = await seed(t);
			await expect(
				t.query(api.reservations.isBookableByDiners, { restaurantId: seeded.restaurantId })
			).resolves.toBe(false);
		})();
	});

	it("is false when the platform flag is off, whatever the restaurant says", async () => {
		const t = harness();
		const seeded = await seed(t, { reservationsFlag: false });
		await expect(
			t.query(api.reservations.isBookableByDiners, { restaurantId: seeded.restaurantId })
		).resolves.toBe(false);
	});

	it("is true when the flag is on and the restaurant accepts", async () => {
		const t = harness();
		const seeded = await seed(t, { reservationsFlag: true });
		await expect(
			t.query(api.reservations.isBookableByDiners, { restaurantId: seeded.restaurantId })
		).resolves.toBe(true);
	});

	it("is false when the flag is on but the restaurant has paused", async () => {
		// The two switches are different tools: the platform decides whether the
		// product offers reservations, the restaurant decides whether it is
		// taking them today. A diner must clear both.
		const t = harness();
		const seeded = await seed(t, { reservationsFlag: true });
		await t.run(async (ctx) => {
			const settings = await ctx.db
				.query("reservationSettings")
				.withIndex("by_restaurant", (q) => q.eq("restaurantId", seeded.restaurantId))
				.first();
			if (settings) await ctx.db.patch(settings._id, { acceptingReservations: false });
			else
				await ctx.db.insert("reservationSettings", {
					restaurantId: seeded.restaurantId,
					defaultTurnMinutes: 90,
					turnMinutesByCapacity: [],
					minAdvanceMinutes: 0,
					maxAdvanceDays: 30,
					noShowGraceMinutes: 15,
					blackoutWindows: [],
					acceptingReservations: false,
					createdAt: NOW,
					updatedAt: NOW,
				});
		});
		await expect(
			t.query(api.reservations.isBookableByDiners, { restaurantId: seeded.restaurantId })
		).resolves.toBe(false);
	});

	it("answers an anonymous caller", async () => {
		// It gates a public page, so it has to be readable without an identity.
		const t = harness();
		const seeded = await seed(t, { reservationsFlag: true });
		await expect(
			t.query(api.reservations.isBookableByDiners, { restaurantId: seeded.restaurantId })
		).resolves.toBe(true);
	});
});

describe("reservations.create is refused when the switch is off", () => {
	it("rejects a diner booking even though the tab is hidden", async () => {
		// The point of the whole enforcement half. The mutation name ships in
		// the client bundle; hiding the Reserve tab stops navigation and
		// nothing else.
		//
		// The table below is load-bearing, and its absence is how this test was
		// vacuous when first written: with no table the booking fails anyway
		// (ERROR_NO_TABLES_AVAILABLE), so the assertion passed with the flag
		// check deleted. Seed a table so the booking WOULD succeed, and pin the
		// exact code so only the flag can be what stopped it.
		const t = harness();
		const seeded = await seed(t, { reservationsFlag: false });
		await seedTable(t, seeded, 1);

		const [id, error] = await t.withIdentity({ subject: DINER }).mutation(api.reservations.create, {
			restaurantId: seeded.restaurantId,
			partySize: 2,
			startsAt: soon(),
			contact: { name: "Ana", phone: "+528112345678" },
		});

		expect(id).toBeNull();
		expect(error?.message).toBe("ERROR_NOT_ACCEPTING_RESERVATIONS");
	});

	it("accepts the same booking once the flag is on — proving the flag is what refused it", async () => {
		// The control. Without it the test above cannot distinguish "the flag
		// blocked this" from "this booking was never going to work".
		const t = harness();
		const seeded = await seed(t, { reservationsFlag: true });
		await seedTable(t, seeded, 1);

		const [id, error] = await t.withIdentity({ subject: DINER }).mutation(api.reservations.create, {
			restaurantId: seeded.restaurantId,
			partySize: 2,
			startsAt: soon(),
			contact: { name: "Ana", phone: "+528112345678" },
		});

		expect(error, JSON.stringify(error)).toBeNull();
		expect(id).not.toBeNull();
	});

	it("still lets staff write down the party in front of them", async () => {
		// Switching the product's reservations off must not stop a manager
		// recording a booking taken over the phone.
		const t = harness();
		const seeded = await seed(t, { reservationsFlag: false });
		await seedTable(t, seeded, 1);
		const staff = "manager-user";
		await t.run(async (ctx) =>
			ctx.db.insert("restaurantMembers", {
				userId: staff,
				restaurantId: seeded.restaurantId,
				organizationId: seeded.organizationId,
				role: "manager",
				isActive: true,
				createdAt: NOW,
				updatedAt: NOW,
			})
		);

		const [id, error] = await t
			.withIdentity({ subject: staff })
			.mutation(api.reservations.createAsStaff, {
				restaurantId: seeded.restaurantId,
				partySize: 2,
				startsAt: soon(),
				contact: { name: "Ana", phone: "+528112345678" },
			});
		expect(error, JSON.stringify(error)).toBeNull();
		expect(id).not.toBeNull();
	});

	it("offers no availability slots to a diner", async () => {
		// The public booking form must agree with what `create` will accept.
		// Offering slots the create path refuses is worse than offering none.
		const t = harness();
		const seeded = await seed(t, { reservationsFlag: false });
		const result = await t.query(api.reservations.listReservationSlotsForDay, {
			restaurantId: seeded.restaurantId,
			partySize: 2,
			fromMs: Date.now(),
			toMs: Date.now() + 6 * 60 * 60 * 1000,
		});
		expect(result.slots).toEqual([]);
	});
});

describe("recordWalkInOccupancy", () => {
	async function seedOrderAtTable(
		t: T,
		seeded: Awaited<ReturnType<typeof seed>>,
		tableId: Id<"tables">
	) {
		return t.run(async (ctx) => {
			const sessionId = await ctx.db.insert("sessions", {
				restaurantId: seeded.restaurantId,
				tableId,
				status: "active",
				startedAt: NOW,
			});
			return ctx.db.insert("orders", {
				restaurantId: seeded.restaurantId,
				sessionId,
				tableId,
				status: "draft",
				totalAmount: 0,
				createdAt: NOW,
				updatedAt: NOW,
			});
		});
	}

	const locksFor = (t: T, tableId: Id<"tables">) =>
		t.run(async (ctx) =>
			ctx.db
				.query("tableLocks")
				.withIndex("by_table_time", (q) => q.eq("tableId", tableId))
				.collect()
		);

	it("is recorded by createDraft itself, in the same transaction", async () => {
		// The ordering path calls `recordWalkInOccupancyForOrder` inline rather
		// than scheduling it, so the order and the occupancy commit together.
		// Scheduling let an order exist for a moment with its table unmarked —
		// and permanently if the scheduled job failed. It also produced
		// "Write outside of transaction" errors under convex-test that failed
		// CI while every test still reported passing.
		const t = harness();
		const seeded = await seed(t, { reservationsFlag: true });
		const tableId = await seedTable(t, seeded, 1);

		const sessionId = await t.run(async (ctx) =>
			ctx.db.insert("sessions", {
				restaurantId: seeded.restaurantId,
				userId: DINER,
				status: "active",
				startedAt: NOW,
			})
		);

		await t
			.withIdentity({ subject: DINER })
			.mutation(api.orders.createDraft, { sessionId, tableId });

		// No draining, no timers: if this needed a scheduled job to have run,
		// the lock would not be here yet.
		const locks = await t.run(async (ctx) =>
			ctx.db
				.query("tableLocks")
				.withIndex("by_table_time", (q) => q.eq("tableId", tableId))
				.collect()
		);
		expect(locks).toHaveLength(1);
		expect(locks[0].reason).toBe(WALK_IN_LOCK_REASON);
	});

	it("writes a lock, not a reservation", async () => {
		// A reservation row would need an invented name, an invented phone and a
		// guessed party size, and would inflate every report that counts
		// bookings. A lock is occupancy, which is what actually happened.
		const t = harness();
		const seeded = await seed(t, { reservationsFlag: true });
		const tableId = await seedTable(t, seeded, 1);
		const orderId = await seedOrderAtTable(t, seeded, tableId);

		await t.run(async (ctx) =>
			ctx.runMutation(internal.walkInOccupancy.recordWalkInOccupancy, { orderId })
		);

		const locks = await locksFor(t, tableId);
		expect(locks).toHaveLength(1);
		expect(locks[0].reason).toBe(WALK_IN_LOCK_REASON);

		const reservations = await t.run(async (ctx) => ctx.db.query("reservations").collect());
		expect(reservations).toHaveLength(0);
	});

	it("works while the reservations flag is off", async () => {
		// A lock is occupancy, not a booking. The flag can be off while the
		// restaurant is full of people eating, and the timeline still has to
		// say which tables are taken.
		const t = harness();
		const seeded = await seed(t, { reservationsFlag: false });
		const tableId = await seedTable(t, seeded, 1);
		const orderId = await seedOrderAtTable(t, seeded, tableId);

		await t.run(async (ctx) =>
			ctx.runMutation(internal.walkInOccupancy.recordWalkInOccupancy, { orderId })
		);
		expect(await locksFor(t, tableId)).toHaveLength(1);
	});

	it("extends one lock rather than stacking a new one per round", async () => {
		// A table with four rounds is one occupied bar on the timeline, not
		// four overlapping ones.
		const t = harness();
		const seeded = await seed(t, { reservationsFlag: true });
		const tableId = await seedTable(t, seeded, 1);

		for (let i = 0; i < 3; i++) {
			const orderId = await seedOrderAtTable(t, seeded, tableId);
			await t.run(async (ctx) =>
				ctx.runMutation(internal.walkInOccupancy.recordWalkInOccupancy, { orderId })
			);
		}
		expect(await locksFor(t, tableId)).toHaveLength(1);
	});

	it("records nothing when a reservation already covers the table", async () => {
		// These are the booked guests, seated. Marking them as a walk-in would
		// invent a collision with their own booking.
		const t = harness();
		const seeded = await seed(t, { reservationsFlag: true });
		const tableId = await seedTable(t, seeded, 1);
		await t.run(async (ctx) =>
			ctx.db.insert("reservations", {
				restaurantId: seeded.restaurantId,
				partySize: 2,
				startsAt: Date.now() - 10 * 60 * 1000,
				endsAt: Date.now() + 60 * 60 * 1000,
				tableIds: [tableId],
				status: "seated",
				source: "ui",
				contact: { name: "Ana", phone: "+528112345678" },
				createdAt: NOW,
				updatedAt: NOW,
			})
		);

		const orderId = await seedOrderAtTable(t, seeded, tableId);
		const result = await t.run(async (ctx) =>
			ctx.runMutation(internal.walkInOccupancy.recordWalkInOccupancy, { orderId })
		);
		expect(result.lockId).toBeNull();
		expect(await locksFor(t, tableId)).toHaveLength(0);
	});

	it("moves a colliding booking to an equivalent table in the same section", async () => {
		const t = harness();
		const seeded = await seed(t, { reservationsFlag: true });
		const busy = await seedTable(t, seeded, 1, 4);
		const spare = await seedTable(t, seeded, 2, 4);

		const reservationId = await t.run(async (ctx) =>
			ctx.db.insert("reservations", {
				restaurantId: seeded.restaurantId,
				partySize: 2,
				startsAt: Date.now() + 20 * 60 * 1000,
				endsAt: Date.now() + 80 * 60 * 1000,
				tableIds: [busy],
				status: "confirmed",
				source: "ui",
				contact: { name: "Ana", phone: "+528112345678" },
				createdAt: NOW,
				updatedAt: NOW,
			})
		);

		const orderId = await seedOrderAtTable(t, seeded, busy);
		const result = await t.run(async (ctx) =>
			ctx.runMutation(internal.walkInOccupancy.recordWalkInOccupancy, { orderId })
		);

		expect(result.movedReservations).toBe(1);
		const moved = await t.run(async (ctx) => ctx.db.get(reservationId));
		expect(moved?.tableIds).toEqual([spare]);
	});

	it("leaves a booking alone when the only free table is in another section", async () => {
		// The restriction that matters. `reschedule` has no guest notification,
		// and the system does not know why a guest chose that table — an
		// anniversary, the window, a wheelchair. Moving them across the room is
		// a different evening, silently.
		const t = harness();
		const seeded = await seed(t, { reservationsFlag: true });
		const busy = await seedTable(t, seeded, 1, 4);
		const otherSection = await t.run(async (ctx) =>
			ctx.db.insert("sections", {
				restaurantId: seeded.restaurantId,
				name: "Patio",
				displayOrder: 1,
				isActive: true,
				createdAt: NOW,
				updatedAt: NOW,
			})
		);
		await t.run(async (ctx) =>
			ctx.db.insert("tables", {
				restaurantId: seeded.restaurantId,
				sectionId: otherSection,
				tableNumber: 9,
				capacity: 8,
				isActive: true,
				createdAt: NOW,
			})
		);

		const reservationId = await t.run(async (ctx) =>
			ctx.db.insert("reservations", {
				restaurantId: seeded.restaurantId,
				partySize: 2,
				startsAt: Date.now() + 20 * 60 * 1000,
				endsAt: Date.now() + 80 * 60 * 1000,
				tableIds: [busy],
				status: "confirmed",
				source: "ui",
				contact: { name: "Ana", phone: "+528112345678" },
				createdAt: NOW,
				updatedAt: NOW,
			})
		);

		const orderId = await seedOrderAtTable(t, seeded, busy);
		const result = await t.run(async (ctx) =>
			ctx.runMutation(internal.walkInOccupancy.recordWalkInOccupancy, { orderId })
		);

		expect(result.movedReservations).toBe(0);
		expect(result.unresolvedCollisions).toBe(1);
		const untouched = await t.run(async (ctx) => ctx.db.get(reservationId));
		expect(untouched?.tableIds).toEqual([busy]);
	});

	it("will not move a party onto a table too small for them", async () => {
		const t = harness();
		const seeded = await seed(t, { reservationsFlag: true });
		const busy = await seedTable(t, seeded, 1, 8);
		await seedTable(t, seeded, 2, 2);

		await t.run(async (ctx) =>
			ctx.db.insert("reservations", {
				restaurantId: seeded.restaurantId,
				partySize: 6,
				startsAt: Date.now() + 20 * 60 * 1000,
				endsAt: Date.now() + 80 * 60 * 1000,
				tableIds: [busy],
				status: "confirmed",
				source: "ui",
				contact: { name: "Ana", phone: "+528112345678" },
				createdAt: NOW,
				updatedAt: NOW,
			})
		);

		const orderId = await seedOrderAtTable(t, seeded, busy);
		const result = await t.run(async (ctx) =>
			ctx.runMutation(internal.walkInOccupancy.recordWalkInOccupancy, { orderId })
		);
		expect(result.movedReservations).toBe(0);
		expect(result.unresolvedCollisions).toBe(1);
	});

	it("does not move a booking onto a table that is itself busy", async () => {
		const t = harness();
		const seeded = await seed(t, { reservationsFlag: true });
		const busy = await seedTable(t, seeded, 1, 4);
		const alsoBusy = await seedTable(t, seeded, 2, 4);

		const window = { startsAt: Date.now() + 20 * 60 * 1000, endsAt: Date.now() + 80 * 60 * 1000 };
		await t.run(async (ctx) => {
			await ctx.db.insert("reservations", {
				restaurantId: seeded.restaurantId,
				partySize: 2,
				...window,
				tableIds: [busy],
				status: "confirmed",
				source: "ui",
				contact: { name: "Ana", phone: "+528112345678" },
				createdAt: NOW,
				updatedAt: NOW,
			});
			await ctx.db.insert("reservations", {
				restaurantId: seeded.restaurantId,
				partySize: 2,
				...window,
				tableIds: [alsoBusy],
				status: "confirmed",
				source: "ui",
				contact: { name: "Bea", phone: "+528112345679" },
				createdAt: NOW,
				updatedAt: NOW,
			});
		});

		const orderId = await seedOrderAtTable(t, seeded, busy);
		const result = await t.run(async (ctx) =>
			ctx.runMutation(internal.walkInOccupancy.recordWalkInOccupancy, { orderId })
		);
		expect(result.movedReservations).toBe(0);
		expect(result.unresolvedCollisions).toBe(1);
	});
});
