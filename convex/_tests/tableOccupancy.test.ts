/**
 * Table occupancy (TAVLI-83). A `Table` reads as taken while a `Session` is
 * open at it, so a second diner is steered to that visit's join code instead
 * of opening a parallel session at the same table.
 *
 * Occupancy is derived, never stored on the table: the session carries the
 * table (`session.tableId`, pinned at the first order) and "taken" is a read
 * of the `sessions.by_table_status` index. These tests pin both ends of that
 * derivation — what sets the table, and every way a session lets go of it
 * (diner close-out, the hourly stale sweep) — plus the two things that must
 * not happen: occupancy leaking across restaurants, and a diner's own table
 * locking them out of their second round.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { RESERVATION_STATUS, SESSION_STATUS, STALE_TAB_MAX_AGE_MS } from "../constants";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

const HOUR_MS = 60 * 60 * 1000;

type TestConvex = ReturnType<typeof convexTest<(typeof schema)["tables"]>>;

let slugCounter = 0;

async function seedRestaurant(
	t: TestConvex,
	options: { tableNumbers?: number[]; manager?: string } = {}
) {
	const slug = `occupancy-${slugCounter++}`;
	const tableNumbers = options.tableNumbers ?? [1, 2];
	let restaurantId: Id<"restaurants">;
	const tableIds: Id<"tables">[] = [];

	await t.run(async (ctx) => {
		const organizationId = await ctx.db.insert("organizations", {
			name: "Occupancy Org",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		restaurantId = await ctx.db.insert("restaurants", {
			ownerId: `owner-${slug}`,
			organizationId,
			name: "Occupancy Restaurant",
			slug,
			currency: "MXN",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		for (const tableNumber of tableNumbers) {
			tableIds.push(
				await ctx.db.insert("tables", {
					restaurantId,
					tableNumber,
					capacity: 4,
					isActive: true,
					createdAt: Date.now(),
				})
			);
		}
		if (options.manager) {
			await ctx.db.insert("restaurantMembers", {
				restaurantId,
				organizationId,
				userId: options.manager,
				role: "manager",
				isActive: true,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		}
	});

	return { restaurantId: restaurantId!, tableIds, slug };
}

/** Opens a tab as `dinerId` and pins it to `tableId` by starting the first order. */
async function openVisitAtTable(
	t: TestConvex,
	args: { slug: string; tableId: Id<"tables">; dinerId?: string }
) {
	const dinerId = args.dinerId ?? "diner-1";
	const diner = t.withIdentity({ subject: dinerId });
	const { sessionId } = await diner.mutation(api.sessions.create, { restaurantSlug: args.slug });
	const orderId = await diner.mutation(api.orders.createDraft, {
		sessionId,
		tableId: args.tableId,
	});
	return { sessionId, orderId, diner, dinerId };
}

/** Occupancy as one viewer sees it, keyed by table id. */
async function occupancyFor(
	t: TestConvex,
	restaurantId: Id<"restaurants">,
	viewer?: string
): Promise<Map<Id<"tables">, { hasOpenSession: boolean; isOwnSession: boolean }>> {
	const caller = viewer === undefined ? t : t.withIdentity({ subject: viewer });
	const rows = await caller.query(api.tables.getActiveWithOccupancy, { restaurantId });
	return new Map(
		rows.map((row) => [
			row._id,
			{ hasOpenSession: row.hasOpenSession, isOwnSession: row.isOwnSession },
		])
	);
}

describe("table occupancy", () => {
	describe("pinning the table onto the session", () => {
		it("records the table at the first order and shows it taken to everyone else", async () => {
			const t = convexTest(schema, modules);
			const { restaurantId, tableIds, slug } = await seedRestaurant(t);
			const [taken, free] = tableIds;

			const { sessionId } = await openVisitAtTable(t, { slug, tableId: taken });

			const session = await t.run((ctx) => ctx.db.get(sessionId));
			expect(session?.tableId).toBe(taken);

			const asStranger = await occupancyFor(t, restaurantId, "diner-2");
			expect(asStranger.get(taken)).toEqual({ hasOpenSession: true, isOwnSession: false });
			expect(asStranger.get(free)).toEqual({ hasOpenSession: false, isOwnSession: false });

			// Staff floor editor reads the id set off a sibling query.
			const occupiedIds = await t.query(api.tables.getOccupiedTableIds, { restaurantId });
			expect(occupiedIds).toEqual([taken]);
		});

		it("leaves the shape of getActiveByRestaurant untouched", async () => {
			const t = convexTest(schema, modules);
			const { restaurantId, tableIds, slug } = await seedRestaurant(t);
			await openVisitAtTable(t, { slug, tableId: tableIds[0] });

			const rows = await t.query(api.tables.getActiveByRestaurant, { restaurantId });

			expect(rows).toHaveLength(tableIds.length);
			// Callers that never asked about occupancy (reservations, schedule)
			// keep getting plain table rows.
			expect(rows.every((row) => !("hasOpenSession" in row))).toBe(true);
		});

		it("does not move a session that already sits at a table", async () => {
			const t = convexTest(schema, modules);
			const { tableIds, slug } = await seedRestaurant(t);
			const [firstTable, otherTable] = tableIds;

			const { sessionId, diner } = await openVisitAtTable(t, { slug, tableId: firstTable });
			// The draft is what `createDraft` returns on a repeat call, so clear it
			// to reach the branch a genuine second round takes.
			await t.run(async (ctx) => {
				const draft = await ctx.db
					.query("orders")
					.withIndex("by_session", (q) => q.eq("sessionId", sessionId))
					.first();
				if (draft) await ctx.db.delete(draft._id);
			});

			await diner.mutation(api.orders.createDraft, { sessionId, tableId: otherTable });

			const session = await t.run((ctx) => ctx.db.get(sessionId));
			expect(session?.tableId).toBe(firstTable);
		});
	});

	describe("the diner's own visit", () => {
		it("stays selectable for the opener and for a friend who joined by code", async () => {
			const t = convexTest(schema, modules);
			const { restaurantId, tableIds, slug } = await seedRestaurant(t);
			const [taken] = tableIds;

			const { sessionId } = await openVisitAtTable(t, { slug, tableId: taken });
			const joinCode = (await t.run((ctx) => ctx.db.get(sessionId)))!.joinCode!;
			await t
				.withIdentity({ subject: "friend-1" })
				.mutation(api.sessions.joinByCode, { restaurantSlug: slug, joinCode });

			const asOpener = await occupancyFor(t, restaurantId, "diner-1");
			expect(asOpener.get(taken)).toEqual({ hasOpenSession: true, isOwnSession: true });

			const asFriend = await occupancyFor(t, restaurantId, "friend-1");
			expect(asFriend.get(taken)).toEqual({ hasOpenSession: true, isOwnSession: true });
		});

		it("reads as taken for an anonymous browser, without requiring auth", async () => {
			const t = convexTest(schema, modules);
			const { restaurantId, tableIds, slug } = await seedRestaurant(t);
			const [taken] = tableIds;
			await openVisitAtTable(t, { slug, tableId: taken });

			// Menu browsing is anonymous — a missing identity must not throw.
			const anonymous = await occupancyFor(t, restaurantId);
			expect(anonymous.get(taken)).toEqual({ hasOpenSession: true, isOwnSession: false });
		});
	});

	describe("releasing the table", () => {
		it("frees the table when the diner closes the visit", async () => {
			const t = convexTest(schema, modules);
			const { restaurantId, tableIds, slug } = await seedRestaurant(t);
			const [taken] = tableIds;

			const { sessionId, diner } = await openVisitAtTable(t, { slug, tableId: taken });
			expect((await occupancyFor(t, restaurantId, "diner-2")).get(taken)?.hasOpenSession).toBe(
				true
			);

			await diner.mutation(api.sessions.close, { sessionId });

			expect((await occupancyFor(t, restaurantId, "diner-2")).get(taken)?.hasOpenSession).toBe(
				false
			);
			expect(await t.query(api.tables.getOccupiedTableIds, { restaurantId })).toEqual([]);
			// The closed session keeps its table for history — occupancy is a read
			// of `status`, not a field the close has to unset.
			expect((await t.run((ctx) => ctx.db.get(sessionId)))?.tableId).toBe(taken);
		});

		it("frees the table when the stale sweep closes an abandoned tab", async () => {
			const t = convexTest(schema, modules);
			const { restaurantId, tableIds, slug } = await seedRestaurant(t);
			const [taken] = tableIds;

			const { sessionId } = await openVisitAtTable(t, { slug, tableId: taken });
			// Age the tab past the 24h cutoff, still inside the sweep's lookback.
			await t.run(async (ctx) => {
				await ctx.db.patch(sessionId, { startedAt: Date.now() - STALE_TAB_MAX_AGE_MS - HOUR_MS });
			});
			expect((await occupancyFor(t, restaurantId, "diner-2")).get(taken)?.hasOpenSession).toBe(
				true
			);

			const result = await t.mutation(internal.sessions.sweepStaleOpenTabs, {});

			expect(result.closed).toBe(1);
			expect((await t.run((ctx) => ctx.db.get(sessionId)))?.status).toBe(SESSION_STATUS.CLOSED);
			expect((await occupancyFor(t, restaurantId, "diner-2")).get(taken)?.hasOpenSession).toBe(
				false
			);
			expect(await t.query(api.tables.getOccupiedTableIds, { restaurantId })).toEqual([]);
		});

		it("keeps the table taken while a stale tab still owes money", async () => {
			const t = convexTest(schema, modules);
			const { restaurantId, tableIds } = await seedRestaurant(t);
			const [taken] = tableIds;

			// A walkout: the sweep only flags an unpaid tab, so its table must
			// stay occupied for staff rather than quietly free itself.
			const sessionId = await t.run(async (ctx) => {
				const id = await ctx.db.insert("sessions", {
					restaurantId,
					tableId: taken,
					userId: "walkout",
					status: SESSION_STATUS.ACTIVE,
					startedAt: Date.now() - STALE_TAB_MAX_AGE_MS - HOUR_MS,
				});
				await ctx.db.insert("orders", {
					sessionId: id,
					restaurantId,
					tableId: taken,
					status: "submitted",
					totalAmount: 1500,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
				return id;
			});

			const result = await t.mutation(internal.sessions.sweepStaleOpenTabs, {});

			expect(result.flagged).toBe(1);
			expect((await t.run((ctx) => ctx.db.get(sessionId)))?.status).toBe(SESSION_STATUS.ACTIVE);
			expect((await occupancyFor(t, restaurantId, "diner-2")).get(taken)?.hasOpenSession).toBe(
				true
			);
		});
	});

	describe("reservation-seated visits", () => {
		it("shows the table as taken the moment staff seat the guest, before any order", async () => {
			const t = convexTest(schema, modules);
			const manager = "manager-seating";
			const { restaurantId, tableIds } = await seedRestaurant(t, { manager });
			const [seated, free] = tableIds;

			const reservationId = await t.run(async (ctx) =>
				ctx.db.insert("reservations", {
					restaurantId,
					partySize: 2,
					startsAt: Date.now(),
					endsAt: Date.now() + 2 * HOUR_MS,
					tableIds: [seated],
					status: RESERVATION_STATUS.CONFIRMED,
					source: "ui",
					contact: { name: "Ada", phone: "+525512345678" },
					createdAt: Date.now(),
					updatedAt: Date.now(),
				})
			);

			const [result, error] = await t
				.withIdentity({ subject: manager })
				.mutation(api.reservations.markSeated, { reservationId });

			expect(error).toBeNull();
			expect((await t.run((ctx) => ctx.db.get(result!.sessionId)))?.tableId).toBe(seated);

			const asDiner = await occupancyFor(t, restaurantId, "diner-walk-in");
			expect(asDiner.get(seated)?.hasOpenSession).toBe(true);
			expect(asDiner.get(free)?.hasOpenSession).toBe(false);
			expect(await t.query(api.tables.getOccupiedTableIds, { restaurantId })).toEqual([seated]);
		});
	});

	describe("restaurant isolation", () => {
		it("does not leak occupancy from another restaurant's tables", async () => {
			const t = convexTest(schema, modules);
			const quiet = await seedRestaurant(t, { tableNumbers: [1] });
			const busy = await seedRestaurant(t, { tableNumbers: [1] });

			await openVisitAtTable(t, { slug: busy.slug, tableId: busy.tableIds[0] });

			const quietTables = await occupancyFor(t, quiet.restaurantId, "diner-2");
			expect(quietTables.size).toBe(1);
			expect(quietTables.get(quiet.tableIds[0])?.hasOpenSession).toBe(false);
			expect(
				await t.query(api.tables.getOccupiedTableIds, { restaurantId: quiet.restaurantId })
			).toEqual([]);

			const busyTables = await occupancyFor(t, busy.restaurantId, "diner-2");
			expect(busyTables.get(busy.tableIds[0])?.hasOpenSession).toBe(true);
		});
	});
});
