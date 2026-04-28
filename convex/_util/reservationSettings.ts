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
};

/**
 * Read the saved settings for a restaurant, or synthesize the defaults.
 * Always returns a complete settings shape -- callers never have to handle
 * the "no row yet" case themselves.
 */
export async function loadEffectiveSettings(
	ctx: { db: DatabaseReader },
	restaurantId: Id<typeof TABLE.RESTAURANTS>
): Promise<EffectiveReservationSettings> {
	const stored = await ctx.db
		.query(TABLE.RESERVATION_SETTINGS)
		.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
		.first();

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
			acceptingReservations: stored.acceptingReservations,
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
		acceptingReservations: DEFAULT_RESERVATION_SETTINGS.acceptingReservations,
		isDefault: true,
	};
}
