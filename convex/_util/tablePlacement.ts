/**
 * Table placement — the single decision that answers "can this party sit, and
 * where?".
 *
 * This module is deliberately **pure**: it takes pre-loaded rows and returns a
 * table selection, with no `ctx` and no database access of its own. Two reasons,
 * both load-bearing:
 *
 * 1. **Admission and placement must be the same decision.** Before this module,
 *    `checkAvailabilityForCreate` decided whether a booking was allowed while
 *    table assignment happened later (or never), so a reservation could be
 *    admitted that no table could actually seat. Routing both through
 *    `placeParty` makes "admitted but unplaceable" impossible by construction
 *    rather than by care.
 *
 * 2. **Read cost.** The per-table conflict reads it replaces issued one indexed
 *    query per table, per candidate time. Callers now load the window once and
 *    filter in memory, which is what keeps the alternatives search (12 candidate
 *    times) inside Convex's per-function read budget. See the warning in
 *    `availability.ts` about what happens when that budget is exceeded.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { DatabaseReader } from "../_generated/server";
import { ACTIVE_RESERVATION_STATUSES, MAX_RESERVATION_TURN_MINUTES, TABLE } from "../constants";
import { tableCapacity } from "./availability";

type TableDoc = Doc<typeof TABLE.TABLES>;
type ReservationDoc = Doc<typeof TABLE.RESERVATIONS>;
type TableLockDoc = Doc<typeof TABLE.TABLE_LOCKS>;

const MS_PER_MINUTE = 60_000;

/** Everything `placeParty` needs, read once. */
export interface PlacementWindow {
	tables: TableDoc[];
	reservations: ReservationDoc[];
	locks: TableLockDoc[];
}

/**
 * Load the tables, reservations and locks covering `[fromMs, toMs)` in **three
 * queries total**, regardless of how many tables the restaurant has or how many
 * candidate times the caller goes on to probe.
 *
 * This is the read-budget half of the module's reason to exist. The per-table
 * helpers it replaces (`findFreeTablesForParty` → `isTableFreeInWindow` →
 * `findOverlappingReservations`) issue one indexed query *per table*, and the
 * alternatives search probes a dozen candidate times — enough, on a large
 * restaurant, to approach Convex's per-function read limit. Exceeding it does
 * not degrade gracefully: it breaks booking for that restaurant on every
 * channel at once.
 *
 * The lower bound mirrors `findOverlappingReservations`: a reservation starting
 * more than one maximum turn before `fromMs` has necessarily ended, so it cannot
 * overlap. That holds only because `computeTurnMinutes` clamps to
 * `MAX_RESERVATION_TURN_MINUTES`.
 */
export async function loadPlacementWindow(
	ctx: { db: DatabaseReader },
	restaurantId: Id<typeof TABLE.RESTAURANTS>,
	fromMs: number,
	toMs: number
): Promise<PlacementWindow> {
	const earliestOverlappingStart = fromMs - MAX_RESERVATION_TURN_MINUTES * MS_PER_MINUTE;

	const [tables, reservations, locks] = await Promise.all([
		ctx.db
			.query(TABLE.TABLES)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
			.collect(),
		ctx.db
			.query(TABLE.RESERVATIONS)
			.withIndex("by_restaurant_time", (q) =>
				q
					.eq("restaurantId", restaurantId)
					.gte("startsAt", earliestOverlappingStart)
					.lt("startsAt", toMs)
			)
			.collect(),
		ctx.db
			.query(TABLE.TABLE_LOCKS)
			.withIndex("by_restaurant_time", (q) =>
				q
					.eq("restaurantId", restaurantId)
					.gte("startsAt", earliestOverlappingStart)
					.lt("startsAt", toMs)
			)
			.collect(),
	]);

	return { tables, reservations, locks };
}

export interface PlacePartyParams {
	/** Every table belonging to the restaurant, unfiltered. */
	tables: TableDoc[];
	/** Reservations already loaded for a window covering [startsAt, endsAt). */
	reservations: ReservationDoc[];
	/** Table locks already loaded for a window covering [startsAt, endsAt). */
	locks: TableLockDoc[];
	partySize: number;
	startsAt: number;
	endsAt: number;
	/** Ignore this reservation's own occupancy — used when re-placing on reschedule. */
	excludeReservationId?: Id<typeof TABLE.RESERVATIONS>;
}

/**
 * Smallest table first, ties broken by table number.
 *
 * Determinism is not cosmetic here: a placer that can return different answers
 * for identical input makes a reported collision impossible to reproduce.
 */
function bySmallestThenNumber(a: TableDoc, b: TableDoc): number {
	const byCapacity = tableCapacity(a) - tableCapacity(b);
	if (byCapacity !== 0) return byCapacity;
	return a.tableNumber - b.tableNumber;
}

/**
 * Half-open overlap: `[aStart, aEnd)` against `[bStart, bEnd)`.
 *
 * Exact touch is deliberately NOT an overlap — a reservation ending at 20:00
 * and one starting at 20:00 do not conflict. This matches
 * `findOverlappingReservations`, and matching it is the point: a placer that
 * disagreed with the codebase's canonical conflict predicate would admit
 * bookings the write paths then reject.
 */
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
	return aStart < bEnd && bStart < aEnd;
}

/** Tables that are real, active, and free for the whole window. */
export function freeTablesInWindow(params: PlacePartyParams): TableDoc[] {
	const occupied = new Set<string>();

	for (const r of params.reservations) {
		if (params.excludeReservationId && r._id === params.excludeReservationId) continue;
		if (!ACTIVE_RESERVATION_STATUSES.includes(r.status)) continue;
		if (!overlaps(r.startsAt, r.endsAt, params.startsAt, params.endsAt)) continue;
		for (const id of r.tableIds) occupied.add(id as string);
	}

	for (const lock of params.locks) {
		if (!overlaps(lock.startsAt, lock.endsAt, params.startsAt, params.endsAt)) continue;
		occupied.add(lock.tableId as string);
	}

	return (
		params.tables
			.filter((t) => t.isActive)
			// Soft-deleted tables keep `isActive: true` (see `tables.remove`), so the
			// active flag alone is not enough — without this a party gets seated at a
			// table staff have already removed from the floor.
			.filter((t) => t.deletedAt === undefined)
			.filter((t) => !occupied.has(t._id as string))
			.sort(bySmallestThenNumber)
	);
}

export function placeParty(params: PlacePartyParams): TableDoc[] | null {
	const free = freeTablesInWindow(params);

	const single = free.find((t) => tableCapacity(t) >= params.partySize);
	if (single) return [single];

	// No single table fits — split. Largest-first is the same greedy ordering
	// `checkAvailabilityForCreate` used to decide whether a party was seatable at
	// all, so anything the old admission check would have admitted, this places.
	// It also minimises the number of tables a party is spread across.
	const largestFirst = [...free].sort((a, b) => -bySmallestThenNumber(a, b));

	const selection: TableDoc[] = [];
	let seated = 0;
	for (const t of largestFirst) {
		if (seated >= params.partySize) break;
		selection.push(t);
		seated += tableCapacity(t);
	}

	return seated >= params.partySize ? selection : null;
}

/**
 * Candidate times around a requested one, ordered by how far they are from it.
 *
 * The search this feeds used to walk **forward only**, so someone asking for
 * 20:00 with 19:30 wide open was offered 21:30 and gave up. "Close to the time
 * they asked for" is a distance, not a direction.
 *
 * Later wins a tie: at equal distance a restaurant would rather push a table
 * back than pull it forward, and the caller is about to cap the list at three.
 * Arbitrary, but fixed — a stable order keeps the replies reproducible.
 */
export function symmetricCandidateTimes(
	startsAt: number,
	stepMs: number,
	maxSteps: number
): number[] {
	const candidates: number[] = [];
	for (let step = 1; step <= maxSteps; step++) {
		candidates.push(startsAt + step * stepMs);
		candidates.push(startsAt - step * stepMs);
	}
	return candidates;
}
