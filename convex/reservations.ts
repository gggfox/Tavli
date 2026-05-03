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
} from "./_util/auth";
import {
	computeEndsAt,
	computeTurnMinutes,
	intersectsBlackout,
	isWithinHorizon,
	requiredCapacityCovered,
} from "./_util/availability";
import { loadEffectiveSettings } from "./_util/reservationSettings";
import {
	checkTablesFreeForReservation,
	contactValidator,
	createReservationCore,
	CreateErrors,
	ensureConfirmable,
	findSuggestedTimes,
	isPartyBookableAt,
	loadAndValidateTables,
	sourceValidator,
	validateTableSelection,
} from "./reservationHelpers";
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

		const bookable = await isPartyBookableAt(
			ctx,
			args.restaurantId,
			args.partySize,
			args.startsAt,
			endsAt
		);

		if (bookable) {
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

const SLOT_STEP_MS = 15 * 60_000;
const MAX_DAY_SPAN_MS = 28 * 60 * 60 * 1000;
const MAX_SLOTS_RETURNED = 64;

/**
 * Public: bookable start times for a local calendar window (typically one day).
 * Uses the same capacity rules as `getAvailability`, at 15-minute steps.
 */
export const listReservationSlotsForDay = query({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		partySize: v.number(),
		fromMs: v.number(),
		toMs: v.number(),
	},
	handler: async (ctx, args) => {
		const span = args.toMs - args.fromMs;
		if (span <= 0 || span > MAX_DAY_SPAN_MS) {
			return { slots: [] as number[], turnMinutes: 0 };
		}
		const settings = await loadEffectiveSettings(ctx, args.restaurantId);
		const turnMinutes = computeTurnMinutes(settings, args.partySize);
		const now = Date.now();
		if (!settings.acceptingReservations) {
			return { slots: [] as number[], turnMinutes };
		}
		const maxStart = args.toMs - turnMinutes * 60_000;
		const slots: number[] = [];
		for (
			let t = args.fromMs;
			t <= maxStart && slots.length < MAX_SLOTS_RETURNED;
			t += SLOT_STEP_MS
		) {
			const endsAt = computeEndsAt(t, turnMinutes);
			if (endsAt > args.toMs) break;
			if (!isWithinHorizon(settings, t, now)) continue;
			if (intersectsBlackout(settings, t, endsAt)) continue;
			const ok = await isPartyBookableAt(ctx, args.restaurantId, args.partySize, t, endsAt);
			if (ok) slots.push(t);
		}
		return { slots, turnMinutes };
	},
});

// ============================================================================
// Create
// ============================================================================

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
		serverMemberId: v.optional(v.id(TABLE.RESTAURANT_MEMBERS)),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<{ reservationId: Id<typeof TABLE.RESERVATIONS>; sessionId: Id<typeof TABLE.SESSIONS> }, MarkSeatedErrors> {
		const [userId, authError] = await getCurrentUserId(ctx);
		if (authError) return [null, authError];
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
			...(args.serverMemberId !== undefined && { serverMemberId: args.serverMemberId }),
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
const reservationStatusesOptionalValidator = v.optional(
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
);

export const listForRange = query({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		fromMs: v.number(),
		toMs: v.number(),
		statuses: reservationStatusesOptionalValidator,
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<ReservationDoc[], StaffAuthErrors | NotFoundErrorObject> {
		const [userId, authError] = await getCurrentUserId(ctx);
		if (authError) return [null, authError];
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
 * Same as {@link listForRange} but across multiple restaurants. Staff must
 * have access to every `restaurantId`. Results are merged and sorted by
 * `startsAt` ascending.
 */
export const listForRangeMulti = query({
	args: {
		restaurantIds: v.array(v.id(TABLE.RESTAURANTS)),
		fromMs: v.number(),
		toMs: v.number(),
		statuses: reservationStatusesOptionalValidator,
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<ReservationDoc[], StaffAuthErrors | NotFoundErrorObject> {
		const [userId, authError] = await getCurrentUserId(ctx);
		if (authError) return [null, authError];

		const uniqueIds = [...new Set(args.restaurantIds)];
		if (uniqueIds.length === 0) return [[], null];

		for (const rid of uniqueIds) {
			const [, restError] = await requireRestaurantStaffAccess(ctx, userId, rid);
			if (restError) return [null, restError];
		}

		const batches = await Promise.all(
			uniqueIds.map((restaurantId) =>
				ctx.db
					.query(TABLE.RESERVATIONS)
					.withIndex("by_restaurant_time", (q) =>
						q.eq("restaurantId", restaurantId).gte("startsAt", args.fromMs).lt("startsAt", args.toMs)
					)
					.order("asc")
					.collect()
			)
		);

		const merged = batches.flat().sort((a, b) => a.startsAt - b.startsAt);

		if (!args.statuses) return [merged, null];
		const allow = new Set(args.statuses);
		return [merged.filter((r) => allow.has(r.status)), null];
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
