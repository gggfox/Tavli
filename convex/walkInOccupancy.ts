/**
 * Walk-in table occupancy (TAVLI-100).
 *
 * When an order is placed at a table that no reservation covers, the table is
 * occupied and the timeline should say so. This writes that fact.
 *
 * ## A `tableLocks` row, not a reservation
 *
 * `tableLocks` already exists and already means exactly this: "time-windowed
 * locks marking a table unavailable, stackable, auditable", unioned into both
 * the reservation overlap checks and the public availability query. Collision
 * detection therefore comes for free.
 *
 * A reservation row would need an invented `contact.name`, an invented
 * `contact.phone` and a guessed `partySize`; it would inflate every report
 * that counts reservations; and it would have to answer what happens when the
 * `RESERVATIONS` flag is off. **A lock is occupancy, not a booking**, so it is
 * unaffected by that flag — which matters, because the flag can be off while
 * the restaurant is full of people eating.
 *
 * ## Auto-move is deliberately restricted
 *
 * When a walk-in's window collides with a booking, the booking is moved only
 * to an *equivalent* table: same section, capacity enough for the party, same
 * time. Anything else is left for a human.
 *
 * That restriction is not caution for its own sake. `reservations.reschedule`
 * is staff-only drag-and-drop with **no guest notification** — its own source
 * names the hazard: *"a reschedule is the transition a guest is most likely to
 * dispute ('nobody told me you moved us to 9pm')."* The system does not know
 * why a guest chose that table — an anniversary, the window, a wheelchair —
 * and it cannot tell them it moved them. Moving within a section is the one
 * case where the guest's experience is genuinely unchanged.
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";
import { ACTIVE_RESERVATION_STATUSES, AUDIT_SYSTEM_USER_ID, TABLE } from "./constants";
import { computeTurnMinutes } from "./_util/availability";
import { loadEffectiveSettings } from "./_util/reservationSettings";
import { appendAuditEvent } from "./_util/audit";

/** Party size assumed for a walk-in, when the table does not say. */
const FALLBACK_WALK_IN_PARTY = 2;

/** Marks a lock as machine-written, so staff can tell it from their own. */
export const WALK_IN_LOCK_REASON = "walk-in";

/** Two half-open ranges overlap when each starts before the other ends. */
export function windowsOverlap(
	a: { startsAt: number; endsAt: number },
	b: { startsAt: number; endsAt: number }
): boolean {
	return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

/**
 * Note that a table is occupied by walk-ins, and resolve anything it collides
 * with.
 *
 * Idempotent for the life of one visit: a second order at the same table
 * inside an existing walk-in window extends it rather than stacking a new
 * lock, so a table with four rounds has one bar on the timeline and not four.
 */
export interface WalkInOccupancyResult {
	lockId: Id<"tableLocks"> | null;
	movedReservations: number;
	unresolvedCollisions: number;
}

const NO_OCCUPANCY: WalkInOccupancyResult = {
	lockId: null,
	movedReservations: 0,
	unresolvedCollisions: 0,
};

/**
 * Record occupancy for one order, **inline in the caller's transaction**.
 *
 * Called directly from `orders.createDraft` rather than through
 * `ctx.scheduler.runAfter`, and the reason is consistency rather than
 * convenience: a Convex mutation is a transaction, so inline means the order
 * and the occupancy land together or neither does. Scheduling would let an
 * order exist for a moment with the table unmarked — and, if the scheduled job
 * failed, permanently.
 *
 * The caller wraps this in a try/catch, so a failure here degrades to a
 * timeline that is briefly wrong rather than to a menu that will not take an
 * order. Partial work is safe under that catch: the lock is written before any
 * reservation is moved, so a mid-way failure leaves an unresolved collision —
 * which is precisely the state the timeline already knows how to show in red.
 */
export async function recordWalkInOccupancyForOrder(
	ctx: MutationCtx,
	orderId: Id<"orders">
): Promise<WalkInOccupancyResult> {
	const order = await ctx.db.get(orderId);
	if (!order) return NO_OCCUPANCY;

	const table = await ctx.db.get(order.tableId);
	if (!table || table.deletedAt != null) return NO_OCCUPANCY;

	const settings = await loadEffectiveSettings(ctx, order.restaurantId);
	const partySize = table.capacity ?? FALLBACK_WALK_IN_PARTY;
	const turnMinutes = computeTurnMinutes(settings, partySize);

	const now = Date.now();
	const endsAt = now + turnMinutes * 60_000;

	// A reservation already covering this table right now means these are the
	// booked guests, seated. Nothing to record and nothing to move.
	if (await hasCoveringReservation(ctx, order.tableId, now)) return NO_OCCUPANCY;

	const lockId = await upsertWalkInLock(ctx, order.tableId, now, endsAt);

	const { moved, unresolved } = await resolveCollisions(ctx, {
		restaurantId: order.restaurantId,
		tableId: order.tableId,
		startsAt: now,
		endsAt,
	});

	return { lockId, movedReservations: moved, unresolvedCollisions: unresolved };
}

/**
 * Mutation wrapper, for tests and for re-running occupancy by hand.
 *
 * The ordering path does not go through this — it calls
 * {@link recordWalkInOccupancyForOrder} directly, in its own transaction.
 */
export const recordWalkInOccupancy = internalMutation({
	args: { orderId: v.id(TABLE.ORDERS) },
	returns: v.object({
		lockId: v.union(v.id(TABLE.TABLE_LOCKS), v.null()),
		movedReservations: v.number(),
		unresolvedCollisions: v.number(),
	}),
	handler: async (ctx, args) => recordWalkInOccupancyForOrder(ctx, args.orderId),
});

/** Is an active reservation already sitting on this table at `at`? */
async function hasCoveringReservation(
	ctx: MutationCtx,
	tableId: Id<"tables">,
	at: number
): Promise<boolean> {
	const table = await ctx.db.get(tableId);
	if (!table) return false;

	// Bounded by the day: a reservation covering `at` cannot have started more
	// than one long turn before it.
	const dayStart = at - 24 * 60 * 60 * 1000;
	const candidates = await ctx.db
		.query(TABLE.RESERVATIONS)
		.withIndex("by_restaurant_time", (q) =>
			q.eq("restaurantId", table.restaurantId).gte("startsAt", dayStart).lte("startsAt", at)
		)
		.collect();

	return candidates.some(
		(reservation) =>
			ACTIVE_RESERVATION_STATUSES.includes(reservation.status) &&
			reservation.tableIds.includes(tableId) &&
			reservation.startsAt <= at &&
			reservation.endsAt > at
	);
}

/**
 * Extend the live walk-in lock on this table, or create one.
 *
 * Extending rather than stacking keeps the timeline readable: a table with
 * four rounds of orders is one occupied bar, not four overlapping ones.
 */
async function upsertWalkInLock(
	ctx: MutationCtx,
	tableId: Id<"tables">,
	startsAt: number,
	endsAt: number
): Promise<Id<"tableLocks">> {
	const existing = await ctx.db
		.query(TABLE.TABLE_LOCKS)
		.withIndex("by_table_time", (q) => q.eq("tableId", tableId).lte("startsAt", startsAt))
		.collect();

	const live = existing.find(
		(lock) => lock.reason === WALK_IN_LOCK_REASON && lock.endsAt > startsAt
	);
	if (live) {
		// Only ever forward. A later order cannot shorten a window that an
		// earlier one already justified.
		if (endsAt > live.endsAt) await ctx.db.patch(live._id, { endsAt });
		return live._id;
	}

	return await ctx.db.insert(TABLE.TABLE_LOCKS, {
		restaurantId: (await ctx.db.get(tableId))!.restaurantId,
		tableId,
		startsAt,
		endsAt,
		reason: WALK_IN_LOCK_REASON,
		lockedBy: AUDIT_SYSTEM_USER_ID,
		createdAt: Date.now(),
	});
}

/**
 * Move colliding bookings where it is safe, and count what is left.
 *
 * "Safe" is narrow on purpose — see the module note. Everything else stays put
 * and shows red on the timeline, which is where a manager will be looking.
 */
async function resolveCollisions(
	ctx: MutationCtx,
	window: {
		restaurantId: Id<"restaurants">;
		tableId: Id<"tables">;
		startsAt: number;
		endsAt: number;
	}
): Promise<{ moved: number; unresolved: number }> {
	const colliding = await ctx.db
		.query(TABLE.RESERVATIONS)
		.withIndex("by_restaurant_time", (q) =>
			q
				.eq("restaurantId", window.restaurantId)
				.gte("startsAt", window.startsAt)
				.lte("startsAt", window.endsAt)
		)
		.collect();

	const original = await ctx.db.get(window.tableId);
	if (!original) return { moved: 0, unresolved: 0 };

	let moved = 0;
	let unresolved = 0;

	for (const reservation of colliding) {
		if (!ACTIVE_RESERVATION_STATUSES.includes(reservation.status)) continue;
		if (!reservation.tableIds.includes(window.tableId)) continue;
		if (!windowsOverlap(reservation, window)) continue;

		const replacement = await findEquivalentTable(ctx, reservation, original);
		if (!replacement) {
			unresolved++;
			continue;
		}

		await ctx.db.patch(reservation._id, {
			tableIds: reservation.tableIds.map((id) => (id === window.tableId ? replacement._id : id)),
			updatedAt: Date.now(),
			updatedBy: AUDIT_SYSTEM_USER_ID,
		});
		moved++;

		// Audited because a guest may dispute it and nothing else records that
		// it happened — the move is silent to them by construction.
		await appendAuditEvent(ctx, {
			aggregateType: TABLE.RESERVATIONS,
			aggregateId: reservation._id,
			eventType: "reservations.auto_moved_for_walk_in",
			restaurantId: window.restaurantId,
			payload: {
				restaurantId: window.restaurantId,
				fromTableId: window.tableId,
				toTableId: replacement._id,
				sectionId: original.sectionId,
				startsAt: reservation.startsAt,
			},
			userId: AUDIT_SYSTEM_USER_ID,
		});
	}

	return { moved, unresolved };
}

/**
 * A table the booking can move to without the guest noticing.
 *
 * Same section, capacity for the party, free for the whole window. "Same
 * section" is the substantive condition: moving a guest across the room is a
 * different evening, and nothing here can tell them it happened.
 */
async function findEquivalentTable(
	ctx: MutationCtx,
	reservation: Doc<"reservations">,
	original: Doc<"tables">
): Promise<Doc<"tables"> | null> {
	// A booking with no section on its original table has no notion of
	// equivalence to preserve — leave it for a human rather than guess.
	if (!original.sectionId) return null;

	const candidates = await ctx.db
		.query(TABLE.TABLES)
		.withIndex("by_restaurant", (q) => q.eq("restaurantId", original.restaurantId))
		.collect();

	for (const candidate of candidates) {
		if (candidate._id === original._id) continue;
		if (candidate.deletedAt != null || !candidate.isActive) continue;
		if (candidate.sectionId !== original.sectionId) continue;
		if ((candidate.capacity ?? 0) < reservation.partySize) continue;
		if (reservation.tableIds.includes(candidate._id)) continue;
		if (await isTableBusy(ctx, candidate._id, reservation)) continue;
		return candidate;
	}
	return null;
}

/** Any active reservation or lock overlapping the window on this table. */
async function isTableBusy(
	ctx: MutationCtx,
	tableId: Id<"tables">,
	window: { startsAt: number; endsAt: number; restaurantId: Id<"restaurants"> }
): Promise<boolean> {
	const locks = await ctx.db
		.query(TABLE.TABLE_LOCKS)
		.withIndex("by_table_time", (q) => q.eq("tableId", tableId))
		.collect();
	if (locks.some((lock) => windowsOverlap(lock, window))) return true;

	const reservations = await ctx.db
		.query(TABLE.RESERVATIONS)
		.withIndex("by_restaurant_time", (q) =>
			q
				.eq("restaurantId", window.restaurantId)
				.gte("startsAt", window.startsAt - 24 * 60 * 60 * 1000)
				.lte("startsAt", window.endsAt)
		)
		.collect();

	return reservations.some(
		(reservation) =>
			ACTIVE_RESERVATION_STATUSES.includes(reservation.status) &&
			reservation.tableIds.includes(tableId) &&
			windowsOverlap(reservation, window)
	);
}
