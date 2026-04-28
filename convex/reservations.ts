/**
 * Reservations: capacity-based table booking.
 *
 * Customers (UI now, WhatsApp bot later) submit `partySize + startsAt + contact`.
 * Staff confirm and assign one or more `tableIds`. The double-booking invariant
 * (one table can't be in two non-cancelled reservations whose windows overlap)
 * is enforced inside Convex transactions -- see `_util/availability.ts`.
 *
 * Module layout:
 * - `internalCreate`           : the real creation logic, callable by HTTP routes.
 * - `create`                   : public mutation (UI path).
 * - `getAvailability`          : public query (used by the customer form & bot).
 * - `confirm`                  : staff-only; assigns tableIds.
 * - `cancel`                   : staff or contact owner.
 * - `markSeated` / markCompleted: staff-only state transitions.
 * - `listForRange` /
 *   `listRecentPending`        : staff-facing reads.
 * - `sweepNoShows`             : internalMutation called by the cron.
 */
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
	ConflictError,
	ConflictErrorObject,
	NotAuthenticatedErrorObject,
	NotAuthorizedErrorObject,
	NotFoundError,
	NotFoundErrorObject,
	UserInputValidationError,
	UserInputValidationErrorObject,
} from "./_shared/errors";
import { AsyncReturn } from "./_shared/types";
import {
	getCurrentUserId,
	requireRestaurantStaffAccess,
	requireStaffRole,
} from "./_util/auth";
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
import { createSessionForReservation } from "./sessions";
import {
	ACTIVE_RESERVATION_STATUSES,
	RESERVATION_SOURCE,
	RESERVATION_STATUS,
	ReservationStatus,
	TABLE,
} from "./constants";

type ReservationDoc = Doc<typeof TABLE.RESERVATIONS>;

type StaffAuthErrors = NotAuthenticatedErrorObject | NotAuthorizedErrorObject;

const contactValidator = v.object({
	name: v.string(),
	phone: v.string(),
	email: v.optional(v.string()),
});

const sourceValidator = v.union(
	v.literal(RESERVATION_SOURCE.UI),
	v.literal(RESERVATION_SOURCE.WHATSAPP),
	v.literal(RESERVATION_SOURCE.STAFF)
);

// ============================================================================
// Public availability query
// ============================================================================

/**
 * Whether the restaurant has the capacity to seat `partySize` at `startsAt`.
 * Returns the computed window and a list of suggested alternatives if not.
 *
 * Public (anonymous) -- the bot and the customer form both call it. Hides
 * locked tables and respects blackout windows + booking horizon.
 */
export const getAvailability = query({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		partySize: v.number(),
		startsAt: v.number(),
	},
	handler: async (ctx, args) => {
		const settings = await loadEffectiveSettings(ctx, args.restaurantId);
		const turnMinutes = computeTurnMinutes(settings, args.partySize);
		const endsAt = computeEndsAt(args.startsAt, turnMinutes);
		const now = Date.now();

		if (!settings.acceptingReservations) {
			return {
				available: false,
				reason: "ERROR_NOT_ACCEPTING_RESERVATIONS" as const,
				turnMinutes,
				endsAt,
				suggestedTimes: [] as number[],
			};
		}
		if (!isWithinHorizon(settings, args.startsAt, now)) {
			return {
				available: false,
				reason: "ERROR_OUTSIDE_BOOKING_HORIZON" as const,
				turnMinutes,
				endsAt,
				suggestedTimes: [] as number[],
			};
		}
		if (intersectsBlackout(settings, args.startsAt, endsAt)) {
			return {
				available: false,
				reason: "ERROR_BLACKOUT_WINDOW" as const,
				turnMinutes,
				endsAt,
				suggestedTimes: [] as number[],
			};
		}

		const free = await findFreeTablesForParty(
			ctx,
			args.restaurantId,
			args.partySize,
			args.startsAt,
			endsAt
		);

		if (free.length > 0) {
			return {
				available: true,
				reason: null,
				turnMinutes,
				endsAt,
				suggestedTimes: [] as number[],
			};
		}

		// No single table covers the party? Try multi-table cover with the
		// active set of tables sorted by descending capacity (greedy).
		const allActive = await ctx.db
			.query(TABLE.TABLES)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();
		const candidates: typeof allActive = [];
		for (const t of allActive.filter((x) => x.isActive)) {
			const reservations = await findOverlappingReservations(
				ctx,
				t._id,
				args.startsAt,
				endsAt
			);
			if (reservations.length > 0) continue;
			const locks = await findOverlappingLocks(ctx, t._id, args.startsAt, endsAt);
			if (locks.length > 0) continue;
			candidates.push(t);
		}
		candidates.sort((a, b) => (b.capacity ?? 0) - (a.capacity ?? 0));

		// Could the staff cover the party using >1 free table?
		if (requiredCapacityCovered(candidates, args.partySize)) {
			return {
				available: true,
				reason: null,
				turnMinutes,
				endsAt,
				suggestedTimes: [] as number[],
			};
		}

		return {
			available: false,
			reason: "ERROR_NO_TABLES_AVAILABLE" as const,
			turnMinutes,
			endsAt,
			suggestedTimes: await findSuggestedTimes(ctx, args.restaurantId, args.partySize, args.startsAt, turnMinutes),
		};
	},
});

/**
 * Look 3 hours forward at 30-minute increments and return the first three
 * slots where capacity covers the party. Cheap heuristic; staff can override.
 */
async function findSuggestedTimes(
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

// ============================================================================
// Create
// ============================================================================

type CreateErrors =
	| NotFoundErrorObject
	| UserInputValidationErrorObject
	| ConflictErrorObject;

/**
 * Internal create. The HTTP bot route and the public UI mutation both delegate
 * here so we have one canonical creation path with one set of invariants.
 */
export const internalCreate = internalMutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		partySize: v.number(),
		startsAt: v.number(),
		contact: contactValidator,
		source: sourceValidator,
		userId: v.optional(v.string()),
		notes: v.optional(v.string()),
		idempotencyKey: v.optional(v.string()),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<Id<typeof TABLE.RESERVATIONS>, CreateErrors> {
		return await createReservationCore(ctx, args);
	},
});

/**
 * Public mutation. Identical args to `internalCreate` minus the `source`
 * (always "ui"). Anonymous-callable: customers don't need to be signed in.
 */
export const create = mutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		partySize: v.number(),
		startsAt: v.number(),
		contact: contactValidator,
		notes: v.optional(v.string()),
		idempotencyKey: v.optional(v.string()),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<Id<typeof TABLE.RESERVATIONS>, CreateErrors> {
		const identity = await ctx.auth.getUserIdentity();
		return await createReservationCore(ctx, {
			...args,
			source: RESERVATION_SOURCE.UI,
			userId: identity?.subject,
		});
	},
});

type CreateCoreArgs = {
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

function validateCreateInputs(args: CreateCoreArgs): UserInputValidationErrorObject | null {
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

async function checkAvailabilityForCreate(
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
async function createReservationCore(
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

// ============================================================================
// Confirm: staff assigns tableIds
// ============================================================================

type ConfirmErrors =
	| StaffAuthErrors
	| NotFoundErrorObject
	| UserInputValidationErrorObject
	| ConflictErrorObject;

/**
 * Confirm a pending reservation by assigning one or more tables.
 * Re-runs the overlap and capacity checks at confirm time so that another
 * confirm racing with this one can't sneak through.
 */
export const confirm = mutation({
	args: {
		reservationId: v.id(TABLE.RESERVATIONS),
		tableIds: v.array(v.id(TABLE.TABLES)),
	},
	handler: async function (ctx, args): AsyncReturn<Id<typeof TABLE.RESERVATIONS>, ConfirmErrors> {
		const [userId, authError] = await getCurrentUserId(ctx);
		if (authError) return [null, authError];
		const [, staffError] = await requireStaffRole(ctx, userId);
		if (staffError) return [null, staffError];

		const reservation = await ctx.db.get(args.reservationId);
		if (!reservation) return [null, new NotFoundError("Reservation not found").toObject()];

		const [, restError] = await requireRestaurantStaffAccess(ctx, userId, reservation.restaurantId);
		if (restError) return [null, restError];

		const stateError = ensureConfirmable(reservation.status);
		if (stateError) return [null, stateError];

		const selectionError = validateTableSelection(args.tableIds);
		if (selectionError) return [null, selectionError];

		const [tables, validateError] = await loadAndValidateTables(
			ctx,
			args.tableIds,
			reservation.restaurantId
		);
		if (validateError) return [null, validateError];

		const conflictError = await checkTablesFreeForReservation(ctx, tables, reservation);
		if (conflictError) return [null, conflictError];

		if (!requiredCapacityCovered(tables, reservation.partySize)) {
			return [
				null,
				new UserInputValidationError({
					fields: [
						{
							field: "tableIds",
							message: "Selected tables do not cover the party size",
						},
					],
				}).toObject(),
			];
		}

		const now = Date.now();
		await ctx.db.patch(reservation._id, {
			tableIds: args.tableIds,
			status: RESERVATION_STATUS.CONFIRMED,
			confirmedAt: now,
			updatedAt: now,
		});

		return [reservation._id, null];
	},
});

function ensureConfirmable(status: ReservationStatus): UserInputValidationErrorObject | null {
	if (status === RESERVATION_STATUS.PENDING) return null;
	return new UserInputValidationError({
		fields: [{ field: "status", message: `Cannot confirm a reservation in status ${status}` }],
	}).toObject();
}

function validateTableSelection(
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

async function loadAndValidateTables(
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

async function checkTablesFreeForReservation(
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

// ============================================================================
// Cancel
// ============================================================================

type CancelErrors = StaffAuthErrors | NotFoundErrorObject | UserInputValidationErrorObject;

export const cancel = mutation({
	args: {
		reservationId: v.id(TABLE.RESERVATIONS),
		reason: v.optional(v.string()),
	},
	handler: async function (ctx, args): AsyncReturn<Id<typeof TABLE.RESERVATIONS>, CancelErrors> {
		const [userId, authError] = await getCurrentUserId(ctx);
		if (authError) return [null, authError];
		const [, staffError] = await requireStaffRole(ctx, userId);
		if (staffError) return [null, staffError];

		const reservation = await ctx.db.get(args.reservationId);
		if (!reservation) return [null, new NotFoundError("Reservation not found").toObject()];

		const [, restError] = await requireRestaurantStaffAccess(ctx, userId, reservation.restaurantId);
		if (restError) return [null, restError];

		const blocked: ReservationStatus[] = [
			RESERVATION_STATUS.CANCELLED,
			RESERVATION_STATUS.NO_SHOW,
			RESERVATION_STATUS.COMPLETED,
		];
		if (blocked.includes(reservation.status)) {
			return [
				null,
				new UserInputValidationError({
					fields: [
						{
							field: "status",
							message: `Cannot cancel a reservation in status ${reservation.status}`,
						},
					],
				}).toObject(),
			];
		}

		const now = Date.now();
		await ctx.db.patch(reservation._id, {
			status: RESERVATION_STATUS.CANCELLED,
			cancelledAt: now,
			cancelReason: args.reason,
			updatedAt: now,
		});
		return [reservation._id, null];
	},
});

// ============================================================================
// Mark seated / completed
// ============================================================================

type MarkSeatedErrors =
	| StaffAuthErrors
	| NotFoundErrorObject
	| UserInputValidationErrorObject;

export const markSeated = mutation({
	args: {
		reservationId: v.id(TABLE.RESERVATIONS),
		// Defaults to the first assigned table if not specified. The session
		// only links to one table; multi-table reservations carry the rest in
		// the reservation row itself.
		tableId: v.optional(v.id(TABLE.TABLES)),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<{ reservationId: Id<typeof TABLE.RESERVATIONS>; sessionId: Id<typeof TABLE.SESSIONS> }, MarkSeatedErrors> {
		const [userId, authError] = await getCurrentUserId(ctx);
		if (authError) return [null, authError];
		const [, staffError] = await requireStaffRole(ctx, userId);
		if (staffError) return [null, staffError];

		const reservation = await ctx.db.get(args.reservationId);
		if (!reservation) return [null, new NotFoundError("Reservation not found").toObject()];

		const [, restError] = await requireRestaurantStaffAccess(ctx, userId, reservation.restaurantId);
		if (restError) return [null, restError];

		if (reservation.status !== RESERVATION_STATUS.CONFIRMED) {
			return [
				null,
				new UserInputValidationError({
					fields: [
						{
							field: "status",
							message: `Cannot seat a reservation in status ${reservation.status}`,
						},
					],
				}).toObject(),
			];
		}
		if (reservation.tableIds.length === 0) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "tableIds", message: "No tables assigned" }],
				}).toObject(),
			];
		}

		const tableId = args.tableId ?? reservation.tableIds[0];
		if (!reservation.tableIds.includes(tableId)) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "tableId", message: "Table is not part of the reservation" }],
				}).toObject(),
			];
		}

		const sessionId = await createSessionForReservation(ctx, {
			restaurantId: reservation.restaurantId,
			tableId,
		});
		const now = Date.now();
		await ctx.db.patch(reservation._id, {
			status: RESERVATION_STATUS.SEATED,
			sessionId,
			seatedAt: now,
			updatedAt: now,
		});

		return [{ reservationId: reservation._id, sessionId }, null];
	},
});

export const markCompleted = mutation({
	args: { reservationId: v.id(TABLE.RESERVATIONS) },
	handler: async function (
		ctx,
		args
	): AsyncReturn<Id<typeof TABLE.RESERVATIONS>, MarkSeatedErrors> {
		const [userId, authError] = await getCurrentUserId(ctx);
		if (authError) return [null, authError];
		const [, staffError] = await requireStaffRole(ctx, userId);
		if (staffError) return [null, staffError];

		const reservation = await ctx.db.get(args.reservationId);
		if (!reservation) return [null, new NotFoundError("Reservation not found").toObject()];

		const [, restError] = await requireRestaurantStaffAccess(ctx, userId, reservation.restaurantId);
		if (restError) return [null, restError];

		if (reservation.status !== RESERVATION_STATUS.SEATED) {
			return [
				null,
				new UserInputValidationError({
					fields: [
						{
							field: "status",
							message: `Cannot complete a reservation in status ${reservation.status}`,
						},
					],
				}).toObject(),
			];
		}

		const now = Date.now();
		await ctx.db.patch(reservation._id, {
			status: RESERVATION_STATUS.COMPLETED,
			completedAt: now,
			updatedAt: now,
		});
		return [reservation._id, null];
	},
});

// ============================================================================
// Listings
// ============================================================================

/**
 * Range read used by the staff dashboard tabs. `[fromMs, toMs)` matches
 * reservations whose `startsAt` falls in the range.
 */
export const listForRange = query({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		fromMs: v.number(),
		toMs: v.number(),
		statuses: v.optional(
			v.array(
				v.union(
					v.literal(RESERVATION_STATUS.PENDING),
					v.literal(RESERVATION_STATUS.CONFIRMED),
					v.literal(RESERVATION_STATUS.SEATED),
					v.literal(RESERVATION_STATUS.COMPLETED),
					v.literal(RESERVATION_STATUS.CANCELLED),
					v.literal(RESERVATION_STATUS.NO_SHOW)
				)
			)
		),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<ReservationDoc[], StaffAuthErrors | NotFoundErrorObject> {
		const [userId, authError] = await getCurrentUserId(ctx);
		if (authError) return [null, authError];
		const [, staffError] = await requireStaffRole(ctx, userId);
		if (staffError) return [null, staffError];
		const [, restError] = await requireRestaurantStaffAccess(ctx, userId, args.restaurantId);
		if (restError) return [null, restError];

		const rows = await ctx.db
			.query(TABLE.RESERVATIONS)
			.withIndex("by_restaurant_time", (q) =>
				q.eq("restaurantId", args.restaurantId).gte("startsAt", args.fromMs).lt("startsAt", args.toMs)
			)
			.order("asc")
			.collect();

		if (!args.statuses) return [rows, null];
		const allow = new Set(args.statuses);
		return [rows.filter((r) => allow.has(r.status)), null];
	},
});

/**
 * Drives the staff "new reservation" toast. Subscribers get push updates via
 * Convex reactivity; the client tracks IDs it has already shown.
 */
export const listRecentPending = query({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		sinceMs: v.number(),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<ReservationDoc[], StaffAuthErrors | NotFoundErrorObject> {
		const [userId, authError] = await getCurrentUserId(ctx);
		if (authError) return [null, authError];
		const [, staffError] = await requireStaffRole(ctx, userId);
		if (staffError) return [null, staffError];
		const [, restError] = await requireRestaurantStaffAccess(ctx, userId, args.restaurantId);
		if (restError) return [null, restError];

		const rows = await ctx.db
			.query(TABLE.RESERVATIONS)
			.withIndex("by_restaurant_status_time", (q) =>
				q.eq("restaurantId", args.restaurantId).eq("status", RESERVATION_STATUS.PENDING)
			)
			.collect();

		// Filter to those created since `sinceMs`.
		return [rows.filter((r) => r.createdAt >= args.sinceMs), null];
	},
});

/** Single-row read for the detail drawer. */
export const get = query({
	args: { reservationId: v.id(TABLE.RESERVATIONS) },
	handler: async function (
		ctx,
		args
	): AsyncReturn<ReservationDoc | null, StaffAuthErrors | NotFoundErrorObject> {
		const [userId, authError] = await getCurrentUserId(ctx);
		if (authError) return [null, authError];

		const reservation = await ctx.db.get(args.reservationId);
		if (!reservation) return [null, new NotFoundError("Reservation not found").toObject()];

		const [, restError] = await requireRestaurantStaffAccess(ctx, userId, reservation.restaurantId);
		if (restError) return [null, restError];

		return [reservation, null];
	},
});

// ============================================================================
// No-show sweep
// ============================================================================

/**
 * Cron-triggered. Flips any pending/confirmed reservation that's past
 * `startsAt + noShowGraceMinutes` to `no_show`. Idempotent: rows that have
 * already moved on are left alone.
 */
export const sweepNoShows = internalMutation({
	args: {},
	handler: async (ctx) => {
		const now = Date.now();

		// Pull all restaurants once so we can apply each restaurant's grace.
		const restaurants = await ctx.db.query(TABLE.RESTAURANTS).collect();
		let flipped = 0;

		for (const restaurant of restaurants) {
			const settings = await loadEffectiveSettings(ctx, restaurant._id);
			const cutoff = now - settings.noShowGraceMinutes * 60_000;

			const candidates = await ctx.db
				.query(TABLE.RESERVATIONS)
				.withIndex("by_restaurant_time", (q) =>
					q.eq("restaurantId", restaurant._id).lt("startsAt", cutoff)
				)
				.collect();

			for (const r of candidates) {
				if (
					r.status !== RESERVATION_STATUS.PENDING &&
					r.status !== RESERVATION_STATUS.CONFIRMED
				) {
					continue;
				}
				if (!ACTIVE_RESERVATION_STATUSES.includes(r.status)) continue;
				await ctx.db.patch(r._id, {
					status: RESERVATION_STATUS.NO_SHOW,
					updatedAt: now,
				});
				flipped++;
			}
		}

		return { flipped };
	},
});
