/**
 * Collision detection for the reservations timeline (TAVLI-100).
 *
 * ## Derived, never stored
 *
 * A stored `hasCollision` flag goes stale the instant a manager resolves the
 * clash by hand — dragging the booking somewhere else, or clearing the table.
 * Clearing it would need a second pass over every row that might have been
 * affected, and the one that gets missed is the one that erodes trust in the
 * colour: a manager who sees a red bar with nothing wrong learns to ignore red
 * bars.
 *
 * Recomputing from the windows costs a pass over one day's rows and is correct
 * by construction — fix the clash and the red disappears with no second action.
 *
 * ## Both sides go red
 *
 * A collision is a *relationship*, not a property of one bar. Colouring only
 * the booking leaves a manager looking at a red reservation with no visible
 * reason; colouring only the walk-in says a table is occupied without saying
 * what that costs. Both, and the walk-in is drawn hatched so it is obvious at a
 * glance which side is a booking and which is someone already eating.
 */

export interface TimeWindow {
	readonly startsAt: number;
	readonly endsAt: number;
}

/** Half-open overlap: each starts before the other ends. */
export function windowsOverlap(a: TimeWindow, b: TimeWindow): boolean {
	return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

/**
 * The lock `reason` the walk-in recorder writes. Kept in step with
 * `convex/walkInOccupancy.ts`; a lock a human created has their own reason (or
 * none) and is never treated as a collision, because a manager blocking a
 * table has already decided what happens to anything on it.
 */
export const WALK_IN_LOCK_REASON = "walk-in";

export interface CollisionInput {
	readonly reservations: ReadonlyArray<{ _id: string } & TimeWindow>;
	readonly locks: ReadonlyArray<{ _id: string; reason?: string } & TimeWindow>;
}

export interface CollisionResult {
	/** Reservation ids overlapping a walk-in lock on the same table. */
	readonly collidingReservationIds: ReadonlySet<string>;
	/** Walk-in lock ids overlapping a reservation on the same table. */
	readonly collidingLockIds: ReadonlySet<string>;
}

const EMPTY: CollisionResult = {
	collidingReservationIds: new Set(),
	collidingLockIds: new Set(),
};

/**
 * Find the clashes on **one table**.
 *
 * Only walk-in locks count. A manager who blocked a table for a private event
 * and then booked it anyway has made a decision; flagging that as a system
 * problem would be the software second-guessing the person holding the floor
 * plan.
 */
export function findCollisionsForTable(input: CollisionInput): CollisionResult {
	const walkIns = input.locks.filter((lock) => lock.reason === WALK_IN_LOCK_REASON);
	if (walkIns.length === 0 || input.reservations.length === 0) return EMPTY;

	const collidingReservationIds = new Set<string>();
	const collidingLockIds = new Set<string>();

	for (const reservation of input.reservations) {
		for (const lock of walkIns) {
			if (!windowsOverlap(reservation, lock)) continue;
			collidingReservationIds.add(reservation._id);
			collidingLockIds.add(lock._id);
		}
	}

	return { collidingReservationIds, collidingLockIds };
}

/**
 * Roll the per-table result up across the whole timeline.
 *
 * Keyed by table because a walk-in on table 4 has nothing to say about a
 * booking on table 9 — comparing across tables would flag every busy service
 * as one enormous collision.
 */
export function findCollisions(
	reservationsByTable: ReadonlyMap<string, ReadonlyArray<{ _id: string } & TimeWindow>>,
	locksByTable: ReadonlyMap<string, ReadonlyArray<{ _id: string; reason?: string } & TimeWindow>>
): CollisionResult {
	const collidingReservationIds = new Set<string>();
	const collidingLockIds = new Set<string>();

	for (const [tableId, locks] of locksByTable) {
		const reservations = reservationsByTable.get(tableId);
		if (!reservations || reservations.length === 0) continue;
		const result = findCollisionsForTable({ reservations, locks });
		for (const id of result.collidingReservationIds) collidingReservationIds.add(id);
		for (const id of result.collidingLockIds) collidingLockIds.add(id);
	}

	return { collidingReservationIds, collidingLockIds };
}
