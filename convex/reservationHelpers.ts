/**
 * Internal helpers extracted from `convex/reservations.ts`.
 *
 * These are plain TypeScript functions and validators -- not Convex
 * `query`/`mutation`/`action` definitions -- so the public
 * `internal.reservations.*` paths used by HTTP routes, crons, and tests are
 * unaffected. The companion file (`reservations.ts`) retains the public API
 * surface and imports the helpers below for shared logic.
 *
 * Mirrors the precedent in `convex/stripeHelpers.ts`.
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
	ConflictError,
	ConflictErrorObject,
	NotFoundError,
	NotFoundErrorObject,
	UserInputValidationError,
	UserInputValidationErrorObject,
} from "./_shared/errors";
import { AsyncReturn } from "./_shared/types";
import {
	computeEndsAt,
	computeTurnMinutes,
	findFreeTablesForParty,
	findOverlappingLocks,
	findOverlappingReservations,
	intersectsBlackout,
	isWithinHorizon,
	requiredCapacityCovered,
} from "./_util/availability";
import { loadEffectiveSettings } from "./_util/reservationSettings";
import {
	RESERVATION_SOURCE,
	RESERVATION_STATUS,
	ReservationStatus,
	TABLE,
} from "./constants";

type ReservationDoc = Doc<typeof TABLE.RESERVATIONS>;

export type CreateErrors =
	| NotFoundErrorObject
	| UserInputValidationErrorObject
	| ConflictErrorObject;

export type CreateCoreArgs = {
	restaurantId: Id<typeof TABLE.RESTAURANTS>;
	partySize: number;
	startsAt: number;
	contact: { name: string; phone: string; email?: string };
	source: (typeof RESERVATION_SOURCE)[keyof typeof RESERVATION_SOURCE];
	userId?: string;
	notes?: string;
	idempotencyKey?: string;
};

type CreateCoreCtx = {
	db: Parameters<typeof loadEffectiveSettings>[0]["db"] & {
		insert: (
			table: typeof TABLE.RESERVATIONS,
			doc: Omit<ReservationDoc, "_id" | "_creationTime">
		) => Promise<Id<typeof TABLE.RESERVATIONS>>;
	};
};

export const contactValidator = v.object({
	name: v.string(),
	phone: v.string(),
	email: v.optional(v.string()),
});

export const sourceValidator = v.union(
	v.literal(RESERVATION_SOURCE.UI),
	v.literal(RESERVATION_SOURCE.WHATSAPP),
	v.literal(RESERVATION_SOURCE.STAFF)
);

/**
 * Look 3 hours forward at 30-minute increments and return the first three
 * slots where capacity covers the party. Cheap heuristic; staff can override.
 */
export async function findSuggestedTimes(
	ctx: { db: Parameters<typeof loadEffectiveSettings>[0]["db"] },
	restaurantId: Id<typeof TABLE.RESTAURANTS>,
	partySize: number,
	startsAt: number,
	turnMinutes: number
): Promise<number[]> {
	const STEP_MS = 30 * 60_000;
	const HORIZON_STEPS = 6;
	const suggestions: number[] = [];
	for (let i = 1; i <= HORIZON_STEPS; i++) {
		const candidate = startsAt + i * STEP_MS;
		const candidateEnd = computeEndsAt(candidate, turnMinutes);
		const free = await findFreeTablesForParty(
			ctx,
			restaurantId,
			partySize,
			candidate,
			candidateEnd
		);
		if (free.length > 0) suggestions.push(candidate);
		if (suggestions.length >= 3) break;
	}
	return suggestions;
}

export function validateCreateInputs(
	args: CreateCoreArgs
): UserInputValidationErrorObject | null {
	if (args.partySize < 1) {
		return new UserInputValidationError({
			fields: [{ field: "partySize", message: "Must be at least 1" }],
		}).toObject();
	}
	if (!args.contact.name.trim() || !args.contact.phone.trim()) {
		return new UserInputValidationError({
			fields: [
				{ field: "contact.name", message: "Required" },
				{ field: "contact.phone", message: "Required" },
			],
		}).toObject();
	}
	return null;
}

export async function checkAvailabilityForCreate(
	ctx: CreateCoreCtx,
	restaurantId: Id<typeof TABLE.RESTAURANTS>,
	partySize: number,
	startsAt: number,
	endsAt: number
): Promise<ConflictErrorObject | null> {
	const free = await findFreeTablesForParty(ctx, restaurantId, partySize, startsAt, endsAt);
	if (free.length > 0) return null;

	// Multi-table feasibility fallback (party of 12 may need 6+6).
	const allTables = await ctx.db
		.query(TABLE.TABLES)
		.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	const freeMulti: typeof allTables = [];
	for (const t of allTables) {
		if (!t.isActive) continue;
		const conflicts = await findOverlappingReservations(ctx, t._id, startsAt, endsAt);
		if (conflicts.length > 0) continue;
		const locks = await findOverlappingLocks(ctx, t._id, startsAt, endsAt);
		if (locks.length > 0) continue;
		freeMulti.push(t);
	}
	if (!requiredCapacityCovered(freeMulti, partySize)) {
		return new ConflictError("ERROR_NO_TABLES_AVAILABLE").toObject();
	}
	return null;
}

/**
 * Shared create logic. Validates, runs all gates, then inserts a `pending`
 * row with no tableIds.
 */
export async function createReservationCore(
	ctx: CreateCoreCtx,
	args: CreateCoreArgs
): AsyncReturn<Id<typeof TABLE.RESERVATIONS>, CreateErrors> {
	const inputError = validateCreateInputs(args);
	if (inputError) return [null, inputError];

	const restaurant = await ctx.db.get(args.restaurantId);
	if (!restaurant) {
		return [null, new NotFoundError("Restaurant not found").toObject()];
	}

	if (args.idempotencyKey) {
		const existing = await ctx.db
			.query(TABLE.RESERVATIONS)
			.withIndex("by_idempotency", (q) => q.eq("idempotencyKey", args.idempotencyKey))
			.first();
		if (existing) return [existing._id, null];
	}

	const settings = await loadEffectiveSettings(ctx, args.restaurantId);
	if (!settings.acceptingReservations) {
		return [null, new ConflictError("ERROR_NOT_ACCEPTING_RESERVATIONS").toObject()];
	}

	const turnMinutes = computeTurnMinutes(settings, args.partySize);
	const endsAt = computeEndsAt(args.startsAt, turnMinutes);
	const now = Date.now();

	if (!isWithinHorizon(settings, args.startsAt, now)) {
		return [null, new ConflictError("ERROR_OUTSIDE_BOOKING_HORIZON").toObject()];
	}
	if (intersectsBlackout(settings, args.startsAt, endsAt)) {
		return [null, new ConflictError("ERROR_BLACKOUT_WINDOW").toObject()];
	}

	const availabilityError = await checkAvailabilityForCreate(
		ctx,
		args.restaurantId,
		args.partySize,
		args.startsAt,
		endsAt
	);
	if (availabilityError) return [null, availabilityError];

	const id = await ctx.db.insert(TABLE.RESERVATIONS, {
		restaurantId: args.restaurantId,
		partySize: args.partySize,
		startsAt: args.startsAt,
		endsAt,
		tableIds: [],
		status: RESERVATION_STATUS.PENDING,
		source: args.source,
		contact: args.contact,
		userId: args.userId,
		notes: args.notes,
		idempotencyKey: args.idempotencyKey,
		createdAt: now,
		updatedAt: now,
	});

	return [id, null];
}

export function ensureConfirmable(
	status: ReservationStatus
): UserInputValidationErrorObject | null {
	if (status === RESERVATION_STATUS.PENDING) return null;
	return new UserInputValidationError({
		fields: [{ field: "status", message: `Cannot confirm a reservation in status ${status}` }],
	}).toObject();
}

export function validateTableSelection(
	tableIds: Id<typeof TABLE.TABLES>[]
): UserInputValidationErrorObject | null {
	if (tableIds.length === 0) {
		return new UserInputValidationError({
			fields: [{ field: "tableIds", message: "Pick at least one table" }],
		}).toObject();
	}
	if (new Set(tableIds).size !== tableIds.length) {
		return new UserInputValidationError({
			fields: [{ field: "tableIds", message: "Duplicate tables in selection" }],
		}).toObject();
	}
	return null;
}

export async function loadAndValidateTables(
	ctx: { db: { get: (id: Id<typeof TABLE.TABLES>) => Promise<Doc<typeof TABLE.TABLES> | null> } },
	tableIds: Id<typeof TABLE.TABLES>[],
	restaurantId: Id<typeof TABLE.RESTAURANTS>
): Promise<[Doc<typeof TABLE.TABLES>[], null] | [null, UserInputValidationErrorObject]> {
	const loaded: Doc<typeof TABLE.TABLES>[] = [];
	for (let i = 0; i < tableIds.length; i++) {
		const t = await ctx.db.get(tableIds[i]);
		if (!t || !t.isActive || t.restaurantId !== restaurantId) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: `tableIds[${i}]`, message: "Invalid table" }],
				}).toObject(),
			];
		}
		loaded.push(t);
	}
	return [loaded, null];
}

export async function checkTablesFreeForReservation(
	ctx: Parameters<typeof findOverlappingReservations>[0],
	tables: Doc<typeof TABLE.TABLES>[],
	reservation: Pick<ReservationDoc, "_id" | "startsAt" | "endsAt">
): Promise<ConflictErrorObject | null> {
	for (const t of tables) {
		const conflicts = await findOverlappingReservations(
			ctx,
			t._id,
			reservation.startsAt,
			reservation.endsAt,
			{ excludeReservationId: reservation._id }
		);
		if (conflicts.length > 0) {
			return new ConflictError("ERROR_TABLE_UNAVAILABLE").toObject();
		}
		const locks = await findOverlappingLocks(ctx, t._id, reservation.startsAt, reservation.endsAt);
		if (locks.length > 0) {
			return new ConflictError("ERROR_TABLE_LOCKED").toObject();
		}
	}
	return null;
}
