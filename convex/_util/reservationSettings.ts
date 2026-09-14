/**
 * Effective reservation settings loader.
 *
 * Centralized so every caller (reservations.ts, tableLocks.ts, the bot HTTP
 * routes, the settings panel) sees the same shape whether or not the
 * restaurant has saved its own settings yet. The DEFAULT_RESERVATION_SETTINGS
 * constant defines the fallback values; the panel writes a real row the first
 * time it's saved.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { DatabaseReader } from "../_generated/server";
import { DEFAULT_RESERVATION_SETTINGS, TABLE } from "../constants";

type ReservationSettingsDoc = Doc<typeof TABLE.RESERVATION_SETTINGS>;

/**
 * Shape returned to callers. Identical to a stored doc, plus a flag indicating
 * whether the row exists. Useful for the UI to surface "using defaults".
 */
export type EffectiveReservationSettings = Omit<
	ReservationSettingsDoc,
	"_id" | "_creationTime" | "createdAt" | "updatedAt"
> & {
	_id: Id<typeof TABLE.RESERVATION_SETTINGS> | null;
	isDefault: boolean;
	/**
	 * The owner's toggle as saved (or defaulted) — what the settings panel binds
	 * to and what a first save must persist. Distinct from `acceptingReservations`
	 * below, which is the *effective* answer after the tables fold.
	 */
	acceptingReservationsSetting: boolean;
	/** At least one table that is active and not soft-deleted. */
	hasActiveTables: boolean;
};

/**
 * Whether the restaurant has any table a party could be placed at.
 *
 * Same predicate as `freeTablesInWindow` in `tablePlacement.ts`: `isActive`
 * alone is not enough, because `tables.remove` soft-deletes and leaves the
 * flag on. Kept here, next to the fold that consumes it, so every surface
 * asks the same question the placer does.
 */
export async function hasActiveTables(
	ctx: { db: DatabaseReader },
	restaurantId: Id<typeof TABLE.RESTAURANTS>
): Promise<boolean> {
	const tables = await ctx.db
		.query(TABLE.TABLES)
		.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	return tables.some((t) => t.isActive && t.deletedAt === undefined);
}

/**
 * Read the saved settings for a restaurant, or synthesize the defaults.
 * Always returns a complete settings shape -- callers never have to handle
 * the "no row yet" case themselves.
 *
 * **Zero tables folds into `acceptingReservations: false`.** Capacity is
 * entirely table-derived, so a restaurant with no active tables cannot seat
 * anyone at any time. Reporting that as `ERROR_NO_TABLES_AVAILABLE` — the same
 * code a fully booked floor produces — sent the WhatsApp assistant into an
 * endless "try another time?" loop, because no other time could ever be free.
 * Every surface already honours the accepting flag (bot tool, bot prompt, the
 * web form, staff create), so folding here fixes all of them with no new code.
 * The fold is derived at read time and never written: `acceptingReservationsSetting`
 * carries the owner's real toggle, and `update` seeds a first save from that.
 */
export async function loadEffectiveSettings(
	ctx: { db: DatabaseReader },
	restaurantId: Id<typeof TABLE.RESTAURANTS>
): Promise<EffectiveReservationSettings> {
	const stored = await ctx.db
		.query(TABLE.RESERVATION_SETTINGS)
		.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
		.first();

	const tablesReady = await hasActiveTables(ctx, restaurantId);

	if (stored) {
		return {
			_id: stored._id,
			restaurantId: stored.restaurantId,
			defaultTurnMinutes: stored.defaultTurnMinutes,
			turnMinutesByCapacity: stored.turnMinutesByCapacity,
			minAdvanceMinutes: stored.minAdvanceMinutes,
			maxAdvanceDays: stored.maxAdvanceDays,
			noShowGraceMinutes: stored.noShowGraceMinutes,
			blackoutWindows: stored.blackoutWindows,
			acceptingReservations: stored.acceptingReservations && tablesReady,
			acceptingReservationsSetting: stored.acceptingReservations,
			hasActiveTables: tablesReady,
			isDefault: false,
		};
	}

	return {
		_id: null,
		restaurantId,
		defaultTurnMinutes: DEFAULT_RESERVATION_SETTINGS.defaultTurnMinutes,
		turnMinutesByCapacity: [...DEFAULT_RESERVATION_SETTINGS.turnMinutesByCapacity],
		minAdvanceMinutes: DEFAULT_RESERVATION_SETTINGS.minAdvanceMinutes,
		maxAdvanceDays: DEFAULT_RESERVATION_SETTINGS.maxAdvanceDays,
		noShowGraceMinutes: DEFAULT_RESERVATION_SETTINGS.noShowGraceMinutes,
		blackoutWindows: [...DEFAULT_RESERVATION_SETTINGS.blackoutWindows],
		acceptingReservations: DEFAULT_RESERVATION_SETTINGS.acceptingReservations && tablesReady,
		acceptingReservationsSetting: DEFAULT_RESERVATION_SETTINGS.acceptingReservations,
		hasActiveTables: tablesReady,
		isDefault: true,
	};
}
