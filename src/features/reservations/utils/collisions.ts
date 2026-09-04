import type { Id } from "../../../../convex/_generated/dataModel";

/**
 * Double-bookings on a single table row.
 *
 * This is a **safety net, not the primary defence**. Every write path
 * (`confirm`, `reschedule`, `markSeated`) already calls
 * `checkTablesFreeForReservation`, and creates now go through `placeParty`. A
 * collision that survives all of that means legacy data or a path that bypassed
 * the check — which is exactly the kind of thing worth showing staff rather than
 * discovering at service time.
 *
 * The predicate deliberately mirrors the backend's canonical conflict read: only
 * active statuses collide, and an exact handover (one ends as the next begins)
 * does not. A detector that disagreed with the writers would raise alarms nobody
 * could act on, because the system would happily re-create the state it just
 * flagged.
 */

/** Matches `ACTIVE_RESERVATION_STATUSES` in `convex/constants.ts`. */
const ACTIVE_STATUSES = new Set(["pending", "confirmed", "seated", "completed"]);

interface CollidableReservation {
	_id: Id<"reservations">;
	startsAt: number;
	endsAt: number;
	status: string;
}

/**
 * Ids of the reservations to flag among cards sharing one table.
 *
 * Of an overlapping pair the **later-starting** card is flagged — the next one
 * rightward on the timeline. In a pile-up every card that starts inside an
 * earlier card's window is flagged, so a three-way overlap surfaces two
 * problems, not one: flagging only the last would leave the middle card looking
 * clean while it is equally half of a double-booking.
 */
export function findCollidingReservationIds(
	reservations: CollidableReservation[]
): Set<Id<"reservations">> {
	const active = reservations
		.filter((r) => ACTIVE_STATUSES.has(r.status))
		.sort((a, b) => a.startsAt - b.startsAt);

	const colliding = new Set<Id<"reservations">>();
	for (let i = 0; i < active.length; i++) {
		for (let j = 0; j < i; j++) {
			// Sorted by start, so `active[j]` starts no later than `active[i]`.
			// Half-open on purpose: `endsAt === startsAt` is a handover, not a clash.
			if (active[j].endsAt > active[i].startsAt) {
				colliding.add(active[i]._id);
				break;
			}
		}
	}
	return colliding;
}
