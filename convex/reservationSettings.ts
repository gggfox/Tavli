/**
 * Reservation settings: per-restaurant configuration for the reservation
 * system. One row per restaurant; auto-seeded with `DEFAULT_RESERVATION_SETTINGS`
 * the first time the panel saves anything.
 *
 * - `get` is public (no PII; just turn times, blackout windows, etc.) so the
 *   public reservation form can read horizon/blackout config too.
 * - `update` requires owner/manager via `requireRestaurantStaffAccess`.
 */
import { v } from "convex/values";
import {
	NotAuthenticatedErrorObject,
	NotAuthorizedErrorObject,
	NotFoundErrorObject,
	UserInputValidationError,
	UserInputValidationErrorObject,
} from "./_shared/errors";
import { AsyncReturn } from "./_shared/types";
import { stampUpdated } from "./_util/audit";
import { getCurrentUserId, requireRestaurantManagerOrAbove } from "./_util/auth";
import {
	EffectiveReservationSettings,
	loadEffectiveSettings,
} from "./_util/reservationSettings";
import { mutation, query } from "./_generated/server";
import { TABLE } from "./constants";

type StaffAuthErrors = NotAuthenticatedErrorObject | NotAuthorizedErrorObject;

const turnRangeValidator = v.object({
	minPartySize: v.number(),
	maxPartySize: v.number(),
	turnMinutes: v.number(),
});

const blackoutWindowValidator = v.object({
	startsAt: v.number(),
	endsAt: v.number(),
	reason: v.optional(v.string()),
});

/**
 * Public read. Returns either the saved row or a synthesized default.
 * Callers don't need to handle the "no row yet" case.
 */
export const get = query({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async (ctx, args): Promise<EffectiveReservationSettings> => {
		return await loadEffectiveSettings(ctx, args.restaurantId);
	},
});

type UpdateErrors =
	| StaffAuthErrors
	| NotFoundErrorObject
	| UserInputValidationErrorObject;

/**
 * Upsert settings for a restaurant. Creates the row on first save.
 * Owner/manager only -- employees can confirm reservations but can't change
 * the rules of the road.
 */
export const update = mutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		defaultTurnMinutes: v.optional(v.number()),
		turnMinutesByCapacity: v.optional(v.array(turnRangeValidator)),
		minAdvanceMinutes: v.optional(v.number()),
		maxAdvanceDays: v.optional(v.number()),
		noShowGraceMinutes: v.optional(v.number()),
		blackoutWindows: v.optional(v.array(blackoutWindowValidator)),
		acceptingReservations: v.optional(v.boolean()),
	},
	handler: async function (ctx, args): AsyncReturn<string, UpdateErrors> {
		const [userId, authError] = await getCurrentUserId(ctx);
		if (authError) return [null, authError];
		const [, managerError] = await requireRestaurantManagerOrAbove(ctx, userId, args.restaurantId);
		if (managerError) return [null, managerError];

		const validation = validateSettingsArgs(args);
		if (validation) return [null, validation];

		const existing = await ctx.db
			.query(TABLE.RESERVATION_SETTINGS)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
			.first();

		if (existing) {
			await ctx.db.patch(existing._id, {
				...(args.defaultTurnMinutes !== undefined && {
					defaultTurnMinutes: args.defaultTurnMinutes,
				}),
				...(args.turnMinutesByCapacity !== undefined && {
					turnMinutesByCapacity: args.turnMinutesByCapacity,
				}),
				...(args.minAdvanceMinutes !== undefined && {
					minAdvanceMinutes: args.minAdvanceMinutes,
				}),
				...(args.maxAdvanceDays !== undefined && { maxAdvanceDays: args.maxAdvanceDays }),
				...(args.noShowGraceMinutes !== undefined && {
					noShowGraceMinutes: args.noShowGraceMinutes,
				}),
				...(args.blackoutWindows !== undefined && { blackoutWindows: args.blackoutWindows }),
				...(args.acceptingReservations !== undefined && {
					acceptingReservations: args.acceptingReservations,
				}),
				...stampUpdated(userId),
			});
			return [existing._id, null];
		}

		// First save: seed with provided values OR defaults from loadEffectiveSettings.
		const defaults = await loadEffectiveSettings(ctx, args.restaurantId);
		const now = Date.now();
		const id = await ctx.db.insert(TABLE.RESERVATION_SETTINGS, {
			restaurantId: args.restaurantId,
			defaultTurnMinutes: args.defaultTurnMinutes ?? defaults.defaultTurnMinutes,
			turnMinutesByCapacity:
				args.turnMinutesByCapacity ?? defaults.turnMinutesByCapacity,
			minAdvanceMinutes: args.minAdvanceMinutes ?? defaults.minAdvanceMinutes,
			maxAdvanceDays: args.maxAdvanceDays ?? defaults.maxAdvanceDays,
			noShowGraceMinutes: args.noShowGraceMinutes ?? defaults.noShowGraceMinutes,
			blackoutWindows: args.blackoutWindows ?? defaults.blackoutWindows,
			acceptingReservations: args.acceptingReservations ?? defaults.acceptingReservations,
			createdAt: now,
			updatedAt: now,
			updatedBy: userId,
		});
		return [id, null];
	},
});

type FieldError = { field: string; message: string };

type SettingsArgs = {
	defaultTurnMinutes?: number;
	turnMinutesByCapacity?: Array<{ minPartySize: number; maxPartySize: number; turnMinutes: number }>;
	minAdvanceMinutes?: number;
	maxAdvanceDays?: number;
	noShowGraceMinutes?: number;
	blackoutWindows?: Array<{ startsAt: number; endsAt: number; reason?: string }>;
};

function validateScalarFields(args: SettingsArgs): FieldError[] {
	const fields: FieldError[] = [];
	if (args.defaultTurnMinutes !== undefined && args.defaultTurnMinutes <= 0) {
		fields.push({ field: "defaultTurnMinutes", message: "Must be greater than 0" });
	}
	if (args.minAdvanceMinutes !== undefined && args.minAdvanceMinutes < 0) {
		fields.push({ field: "minAdvanceMinutes", message: "Cannot be negative" });
	}
	if (args.maxAdvanceDays !== undefined && args.maxAdvanceDays <= 0) {
		fields.push({ field: "maxAdvanceDays", message: "Must be greater than 0" });
	}
	if (args.noShowGraceMinutes !== undefined && args.noShowGraceMinutes < 0) {
		fields.push({ field: "noShowGraceMinutes", message: "Cannot be negative" });
	}
	return fields;
}

function validateTurnRange(
	range: { minPartySize: number; maxPartySize: number; turnMinutes: number },
	index: number
): FieldError[] {
	const fields: FieldError[] = [];
	if (range.minPartySize < 1) {
		fields.push({
			field: `turnMinutesByCapacity[${index}].minPartySize`,
			message: "Must be at least 1",
		});
	}
	if (range.maxPartySize < range.minPartySize) {
		fields.push({
			field: `turnMinutesByCapacity[${index}].maxPartySize`,
			message: "Must be >= minPartySize",
		});
	}
	if (range.turnMinutes <= 0) {
		fields.push({
			field: `turnMinutesByCapacity[${index}].turnMinutes`,
			message: "Must be greater than 0",
		});
	}
	return fields;
}

function validateBlackoutWindows(
	windows: Array<{ startsAt: number; endsAt: number }>
): FieldError[] {
	return windows.flatMap((b, i) =>
		b.endsAt <= b.startsAt
			? [{ field: `blackoutWindows[${i}]`, message: "endsAt must be after startsAt" }]
			: []
	);
}

function validateSettingsArgs(args: SettingsArgs): UserInputValidationErrorObject | null {
	const fields: FieldError[] = [
		...validateScalarFields(args),
		...(args.turnMinutesByCapacity?.flatMap((r, i) => validateTurnRange(r, i)) ?? []),
		...(args.blackoutWindows ? validateBlackoutWindows(args.blackoutWindows) : []),
	];
	if (fields.length === 0) return null;
	return new UserInputValidationError({ fields }).toObject();
}
