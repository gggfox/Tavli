/**
 * Pure availability helpers used by every reservation mutation.
 *
 * All helpers either read from the database or operate on plain values. They
 * do not write. Their only job is to answer "can this party fit at this time?"
 * with enough granularity that callers can reject early or pick alternatives.
 *
 * The "no double booking" invariant is enforced here: any caller that intends
 * to assign a `tableId` for a window must first call `findOverlappingReservations`
 * and `findOverlappingLocks`. Because these reads + the subsequent write happen
 * inside one Convex mutation transaction, OCC retries handle concurrent writers
 * without explicit locking.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { DatabaseReader } from "../_generated/server";
import {
	ACTIVE_RESERVATION_STATUSES,
	DEFAULT_RESTAURANT_CLOSE_TIME,
	DEFAULT_RESTAURANT_OPEN_TIME,
	FALLBACK_TABLE_CAPACITY,
	MAX_RESERVATION_TURN_MINUTES,
	TABLE,
} from "../constants";
import {
	addDaysToYmd,
	parseHm,
	resolveRestaurantTimezone,
	utcMsToYmdInTimezone,
	ymdHmToUtcMs,
} from "./timezone";

type ReservationDoc = Doc<typeof TABLE.RESERVATIONS>;
type ReservationSettingsDoc = Doc<typeof TABLE.RESERVATION_SETTINGS>;
type RestaurantDoc = Doc<typeof TABLE.RESTAURANTS>;
type TableDoc = Doc<typeof TABLE.TABLES>;
type TableLockDoc = Doc<typeof TABLE.TABLE_LOCKS>;

type ReadCtx = { db: DatabaseReader };

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

/**
 * Pick the turn time for a party. Looks at the per-capacity overrides first
 * (first matching range wins), falls back to defaultTurnMinutes.
 */
export function computeTurnMinutes(
	settings: Pick<ReservationSettingsDoc, "defaultTurnMinutes" | "turnMinutesByCapacity">,
	partySize: number
): number {
	for (const range of settings.turnMinutesByCapacity) {
		if (partySize >= range.minPartySize && partySize <= range.maxPartySize) {
			return clampTurnMinutes(range.turnMinutes);
		}
	}
	return clampTurnMinutes(settings.defaultTurnMinutes);
}

/**
 * Clamp to `MAX_RESERVATION_TURN_MINUTES`. Not cosmetic: `findOverlappingReservations`
 * bounds its index scan on the assumption that no turn exceeds this, so a
 * mis-configured 3-day turn would otherwise make the conflict read miss rows.
 */
function clampTurnMinutes(turnMinutes: number): number {
	if (!Number.isFinite(turnMinutes) || turnMinutes <= 0) return 1;
	return Math.min(turnMinutes, MAX_RESERVATION_TURN_MINUTES);
}

/**
 * `endsAt` derived from `startsAt + turnMinutes`. Returned as UTC epoch ms.
 */
export function computeEndsAt(startsAt: number, turnMinutes: number): number {
	return startsAt + turnMinutes * MS_PER_MINUTE;
}

/**
 * Effective capacity of a table. Returns FALLBACK_TABLE_CAPACITY for rows that
 * predate the capacity column.
 */
export function tableCapacity(table: Pick<TableDoc, "capacity">): number {
	return table.capacity ?? FALLBACK_TABLE_CAPACITY;
}

interface IsWithinHorizonParams {
	minAdvanceMinutes: number;
	maxAdvanceDays: number;
	startsAt: number;
	now: number;
}
/**
 * True iff the requested start time is far enough in the future and not too
 * far out, given the restaurant's policy.
 */
export function isWithinHorizon(params: IsWithinHorizonParams): boolean {
	const { minAdvanceMinutes, maxAdvanceDays, startsAt, now } = params;
	const earliest = now + minAdvanceMinutes * MS_PER_MINUTE;
	const latest = now + maxAdvanceDays * MS_PER_DAY;
	return startsAt >= earliest && startsAt <= latest;
}

export interface ServiceWindow {
	openMinutes: number;
	closeMinutes: number;
	timezone: string;
	/** True when the window crosses midnight (e.g. 18:00–02:00). */
	isOvernight: boolean;
}

/**
 * Resolve a restaurant's bookable service window from its `openTime`/`closeTime`
 * pair, falling back to the documented defaults when either is unset or
 * unparseable.
 */
export function resolveServiceWindow(
	restaurant: Pick<RestaurantDoc, "openTime" | "closeTime" | "timezone">
): ServiceWindow {
	const openMinutes = parseHm(restaurant.openTime ?? "") ?? parseHm(DEFAULT_RESTAURANT_OPEN_TIME)!;
	const closeMinutes =
		parseHm(restaurant.closeTime ?? "") ?? parseHm(DEFAULT_RESTAURANT_CLOSE_TIME)!;
	return {
		openMinutes,
		closeMinutes,
		timezone: resolveRestaurantTimezone(restaurant.timezone),
		isOvernight: closeMinutes <= openMinutes,
	};
}

const MINUTES_PER_DAY = 1440;

/**
 * True iff [startsAt, endsAt) fits entirely inside the restaurant's service
 * window on the local service day it belongs to.
 *
 * Note this bounds the whole reservation, not just its start: with a 90-minute
 * turn and a 23:00 close, the last bookable start is 21:30.
 *
 * Overnight windows are checked against the *previous* local day as well — a
 * 01:00 booking belongs to yesterday's 18:00–02:00 service, not to today's
 * not-yet-open window.
 */
export function isWithinOperatingHours(params: {
	startsAt: number;
	endsAt: number;
	window: ServiceWindow;
}): boolean {
	const { startsAt, endsAt, window } = params;
	const { timezone, openMinutes, closeMinutes, isOvernight } = window;
	const closeOffset = isOvernight ? closeMinutes + MINUTES_PER_DAY : closeMinutes;

	const fitsOn = (ymd: string): boolean => {
		const openMs = ymdHmToUtcMs(ymd, openMinutes, timezone);
		const closeMs = ymdHmToUtcMs(ymd, closeOffset, timezone);
		return startsAt >= openMs && endsAt <= closeMs;
	};

	const ymd = utcMsToYmdInTimezone(startsAt, timezone);
	if (fitsOn(ymd)) return true;
	// Only an overnight window can have a booking belong to the previous day.
	return isOvernight && fitsOn(addDaysToYmd(ymd, -1));
}

/**
 * True iff [startsAt, endsAt) intersects any restaurant-wide blackout window.
 */
export function intersectsBlackout(
	settings: Pick<ReservationSettingsDoc, "blackoutWindows">,
	startsAt: number,
	endsAt: number
): boolean {
	return settings.blackoutWindows.some((b) => b.startsAt < endsAt && b.endsAt > startsAt);
}

/**
 * Sum of capacities >= partySize, given a multi-table assignment.
 */
export function requiredCapacityCovered(tables: TableDoc[], partySize: number): boolean {
	const total = tables.reduce((sum, t) => sum + tableCapacity(t), 0);
	return total >= partySize;
}

/**
 * Read every active reservation on `tableId` whose window overlaps
 * [startsAt, endsAt). Optionally exclude one reservation (used by `confirm`
 * when re-checking conflicts on the row being updated).
 *
 * This is THE canonical conflict read. Putting it in a single helper keeps
 * the exact predicate ("overlap" + "active status") consistent across every
 * mutation path so we can't accidentally let one path through a slightly
 * looser check.
 */
export async function findOverlappingReservations(
	ctx: ReadCtx,
	tableId: Id<typeof TABLE.TABLES>,
	startsAt: number,
	endsAt: number,
	options: { excludeReservationId?: Id<typeof TABLE.RESERVATIONS> } = {}
): Promise<ReservationDoc[]> {
	// We can't use a compound index on tableIds (it's an array). Fall back to
	// querying the restaurant's reservations in the time window, then filter
	// to those that include this tableId. Callers always know the restaurant
	// because tableId implies it.
	const table = await ctx.db.get(tableId);
	if (!table) return [];

	// Query reservations that start before endsAt for this restaurant via the
	// time-ordered index, then filter on overlap + active status + tableId
	// membership.
	//
	// The lower bound is what keeps this read bounded. Without it the scan starts
	// at the beginning of the restaurant's history, and since this runs once per
	// table (twice over, via the single-table then multi-table passes in
	// `checkAvailabilityForCreate`), a few hundred stale rows are enough to blow
	// the per-transaction read limit and break *all* booking for the restaurant —
	// web form and staff included, permanently, because the rows persist.
	//
	// Correctness: a reservation starting earlier than one full turn before
	// `startsAt` must already have ended, so it cannot overlap. That holds only
	// because `computeTurnMinutes` clamps to MAX_RESERVATION_TURN_MINUTES.
	const earliestOverlappingStart = startsAt - MAX_RESERVATION_TURN_MINUTES * MS_PER_MINUTE;
	const candidates = await ctx.db
		.query(TABLE.RESERVATIONS)
		.withIndex("by_restaurant_time", (q) =>
			q
				.eq("restaurantId", table.restaurantId)
				.gte("startsAt", earliestOverlappingStart)
				.lt("startsAt", endsAt)
		)
		.collect();

	return candidates.filter((r) => {
		if (options.excludeReservationId && r._id === options.excludeReservationId) return false;
		if (!ACTIVE_RESERVATION_STATUSES.includes(r.status)) return false;
		if (r.endsAt <= startsAt) return false;
		return r.tableIds.includes(tableId);
	});
}

/**
 * Read every lock on `tableId` whose window overlaps [startsAt, endsAt).
 */
export async function findOverlappingLocks(
	ctx: ReadCtx,
	tableId: Id<typeof TABLE.TABLES>,
	startsAt: number,
	endsAt: number
): Promise<TableLockDoc[]> {
	const candidates = await ctx.db
		.query(TABLE.TABLE_LOCKS)
		.withIndex("by_table_time", (q) => q.eq("tableId", tableId).lt("startsAt", endsAt))
		.collect();

	return candidates.filter((lock) => lock.endsAt > startsAt);
}

/**
 * True iff the table has no overlapping reservations OR locks for the window.
 * Convenience wrapper used by listing endpoints; mutation paths should call
 * the two helpers separately so they can return finer-grained error reasons.
 */
export async function isTableFreeInWindow(
	ctx: ReadCtx,
	tableId: Id<typeof TABLE.TABLES>,
	startsAt: number,
	endsAt: number,
	options: { excludeReservationId?: Id<typeof TABLE.RESERVATIONS> } = {}
): Promise<boolean> {
	const reservations = await findOverlappingReservations(ctx, tableId, startsAt, endsAt, options);
	if (reservations.length > 0) return false;
	const locks = await findOverlappingLocks(ctx, tableId, startsAt, endsAt);
	return locks.length === 0;
}

/**
 * Tables in the restaurant filtered to those big enough for the party AND
 * free for the entire [startsAt, endsAt) window. Used by both the customer
 * availability query and the staff table picker. Inactive tables are
 * excluded; that's the "table doesn't exist for the customer" case.
 */
export async function findFreeTablesForParty(
	ctx: ReadCtx,
	restaurantId: Id<typeof TABLE.RESTAURANTS>,
	partySize: number,
	startsAt: number,
	endsAt: number
): Promise<TableDoc[]> {
	const tables = await ctx.db
		.query(TABLE.TABLES)
		.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
		.collect();

	const eligible: TableDoc[] = [];
	for (const t of tables) {
		if (!t.isActive) continue;
		if (tableCapacity(t) < partySize) continue;
		if (await isTableFreeInWindow(ctx, t._id, startsAt, endsAt)) {
			eligible.push(t);
		}
	}
	return eligible;
}
