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
 * - `reschedule`               : staff-only; moves time and/or tables (timeline DnD).
 * - `reconfirm`                : staff-only; reopens cancelled / no_show as confirmed.
 * - `cancel`                   : staff or contact owner.
 * - `markSeated` / markCompleted: staff-only state transitions.
 * - `listForRange` /
 *   `listRecentPending`        : staff-facing reads.
 * - `sweepNoShows`             : internalMutation called by the cron.
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
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
import { appendAuditEvent } from "./_util/audit";
import {
	getCurrentUserId,
	requireRestaurantManagerOrAbove,
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
	AUDIT_EVENT,
	AUDIT_SYSTEM_USER_ID,
	NO_SHOW_SWEEP_BATCH_SIZE,
	NO_SHOW_SWEEP_LOOKBACK_MS,
	RESERVATION_SOURCE,
	RESERVATION_STATUS,
	ReservationStatus,
	TABLE,
} from "./constants";
import {
	CreateErrors,
	applyPerBlockTableMove,
	buildReopenToConfirmedPatch,
	checkTablesFreeForReservation,
	contactValidator,
	createReservationCore,
	ensureConfirmable,
	ensureReschedulable,
	ensureTerminalRecoverable,
	findSuggestedTimes,
	isBookablePartySize,
	isPartyBookableAt,
	isTerminalRecoverable,
	loadAndValidateTables,
	resolveRescheduleWindow,
	sourceValidator,
	validateReservationWindow,
	validateTableSelection,
	windowIntersectsHorizon,
} from "./reservationHelpers";
import { createSessionForReservation } from "./sessions";

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
		const { minAdvanceMinutes, maxAdvanceDays, acceptingReservations } = settings;
		const turnMinutes = computeTurnMinutes(settings, args.partySize);
		const endsAt = computeEndsAt(args.startsAt, turnMinutes);
		const now = Date.now();

		if (!acceptingReservations) {
			return {
				available: false,
				reason: "ERROR_NOT_ACCEPTING_RESERVATIONS" as const,
				turnMinutes,
				endsAt,
				suggestedTimes: [] as number[],
			};
		}
		// Out-of-range party sizes can never be seated; short-circuit before the
		// table/reservation/lock scan rather than scanning to conclude the same.
		if (!isBookablePartySize(args.partySize)) {
			return {
				available: false,
				reason: "ERROR_NO_TABLES_AVAILABLE" as const,
				turnMinutes,
				endsAt,
				suggestedTimes: [] as number[],
			};
		}
		if (
			!isWithinHorizon({
				minAdvanceMinutes,
				maxAdvanceDays,
				startsAt: args.startsAt,
				now,
			})
		) {
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
			suggestedTimes: await findSuggestedTimes(
				ctx,
				args.restaurantId,
				args.partySize,
				args.startsAt,
				turnMinutes
			),
		};
	},
});

const SLOT_STEP_MS = 15 * 60_000;
// A single local calendar day, with DST slack (a "fall back" day is 25h).
// Callers pass one day; anything wider is out of range and returns no slots.
const MAX_DAY_SPAN_MS = 26 * 60 * 60 * 1000;
const MAX_SLOTS_RETURNED = 64;
// Hard cap on availability probes per call. A real service day at 15-minute
// steps is well under 64 slots, so this bounds the worst-case table/reservation/
// lock scans regardless of how many slots turn out to be unavailable.
const MAX_SLOTS_EVALUATED = 64;

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
		const { minAdvanceMinutes, maxAdvanceDays, acceptingReservations } = settings;
		const now = Date.now();
		if (!acceptingReservations) {
			return { slots: [] as number[], turnMinutes };
		}
		// Out-of-range party sizes have no slots; skip the scan entirely.
		if (!isBookablePartySize(args.partySize)) {
			return { slots: [] as number[], turnMinutes };
		}
		// If no candidate slot in the window can fall inside the booking horizon
		// (fully past or fully beyond maxAdvance), skip the loop rather than
		// iterating the whole day only to reject every slot.
		if (
			!windowIntersectsHorizon({
				fromMs: args.fromMs,
				toMs: args.toMs,
				now,
				minAdvanceMinutes,
				maxAdvanceDays,
			})
		) {
			return { slots: [] as number[], turnMinutes };
		}
		const maxStart = args.toMs - turnMinutes * 60_000;
		const slots: number[] = [];
		let evaluated = 0;
		for (
			let t = args.fromMs;
			t <= maxStart && slots.length < MAX_SLOTS_RETURNED && evaluated < MAX_SLOTS_EVALUATED;
			t += SLOT_STEP_MS
		) {
			const endsAt = computeEndsAt(t, turnMinutes);
			if (endsAt > args.toMs) break;
			if (!isWithinHorizon({ minAdvanceMinutes, maxAdvanceDays, startsAt: t, now })) continue;
			if (intersectsBlackout(settings, t, endsAt)) continue;
			// Count each availability probe; this is the expensive per-slot work.
			evaluated++;
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
	handler: async function (ctx, args): AsyncReturn<Id<typeof TABLE.RESERVATIONS>, CreateErrors> {
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
	handler: async function (ctx, args): AsyncReturn<Id<typeof TABLE.RESERVATIONS>, CreateErrors> {
		const identity = await ctx.auth.getUserIdentity();
		return await createReservationCore(ctx, {
			...args,
			source: RESERVATION_SOURCE.UI,
			userId: identity?.subject,
		});
	},
});

/**
 * Staff-only create. Requires restaurant staff access and records the
 * reservation source as "staff" so it is distinguishable from customer-
 * initiated bookings.
 */
export const createAsStaff = mutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		partySize: v.number(),
		startsAt: v.number(),
		contact: contactValidator,
		notes: v.optional(v.string()),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<Id<typeof TABLE.RESERVATIONS>, StaffAuthErrors | CreateErrors> {
		const [userId, authError] = await getCurrentUserId(ctx);
		if (authError) return [null, authError];

		const [, accessError] = await requireRestaurantStaffAccess(ctx, userId, args.restaurantId);
		if (accessError) return [null, accessError];

		return await createReservationCore(ctx, {
			...args,
			source: RESERVATION_SOURCE.STAFF,
			userId,
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

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.RESERVATIONS,
			aggregateId: reservation._id,
			eventType: AUDIT_EVENT.RESERVATION_CONFIRMED,
			payload: {
				restaurantId: reservation.restaurantId,
				fromStatus: reservation.status,
				tableIds: args.tableIds,
				startsAt: reservation.startsAt,
				partySize: reservation.partySize,
			},
			userId,
		});

		return [reservation._id, null];
	},
});

// ============================================================================
// Reschedule: staff moves time and/or tables (timeline drag-and-drop)
// ============================================================================

type RescheduleErrors =
	| StaffAuthErrors
	| NotFoundErrorObject
	| UserInputValidationErrorObject
	| ConflictErrorObject;

/**
 * Staff reschedule: optional new `startsAt` / `endsAt`, full `tableIds`
 * replace (drawer), or per-block table move via `fromTableId` / `toTableId`
 * (timeline DnD). `toTableId: null` drops the dragged table onto the
 * unassigned row.
 */
export const reschedule = mutation({
	args: {
		reservationId: v.id(TABLE.RESERVATIONS),
		startsAt: v.optional(v.number()),
		endsAt: v.optional(v.number()),
		tableIds: v.optional(v.array(v.id(TABLE.TABLES))),
		fromTableId: v.optional(v.id(TABLE.TABLES)),
		toTableId: v.optional(v.union(v.id(TABLE.TABLES), v.null())),
		/** When true, cancelled / no_show rows reopen as confirmed before applying the move. */
		reopen: v.optional(v.literal(true)),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<Id<typeof TABLE.RESERVATIONS>, RescheduleErrors> {
		const [userId, authError] = await getCurrentUserId(ctx);
		if (authError) return [null, authError];
		const reservation = await ctx.db.get(args.reservationId);
		if (!reservation) return [null, new NotFoundError("Reservation not found").toObject()];

		const [, restError] = await requireRestaurantStaffAccess(ctx, userId, reservation.restaurantId);
		if (restError) return [null, restError];

		const reopening = args.reopen === true;
		if (reopening) {
			const recoverError = ensureTerminalRecoverable(reservation.status);
			if (recoverError) return [null, recoverError];
		} else {
			const stateError = ensureReschedulable(reservation.status);
			if (stateError) return [null, stateError];
		}

		const hasTimeChange = args.startsAt !== undefined || args.endsAt !== undefined;
		const hasTableReplace = args.tableIds !== undefined;
		const hasPerBlockMove = args.fromTableId !== undefined || args.toTableId !== undefined;
		const hasTableChange = hasTableReplace || hasPerBlockMove;
		if (!hasTimeChange && !hasTableChange) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "startsAt", message: "No reschedule changes provided" }],
				}).toObject(),
			];
		}

		let startsAt = reservation.startsAt;
		let endsAt = reservation.endsAt;

		if (hasTimeChange) {
			const resolved = resolveRescheduleWindow(reservation, args);
			startsAt = resolved.startsAt;
			endsAt = resolved.endsAt;

			const windowError = validateReservationWindow(startsAt, endsAt);
			if (windowError) return [null, windowError];

			const settings = await loadEffectiveSettings(ctx, reservation.restaurantId);
			const { maxAdvanceDays } = settings;
			const now = Date.now();
			if (!isWithinHorizon({ minAdvanceMinutes: 0, maxAdvanceDays, startsAt, now })) {
				return [null, new ConflictError("ERROR_OUTSIDE_BOOKING_HORIZON").toObject()];
			}
			if (intersectsBlackout(settings, startsAt, endsAt)) {
				return [null, new ConflictError("ERROR_BLACKOUT_WINDOW").toObject()];
			}
		}

		let newTableIds = reservation.tableIds;
		if (hasTableReplace) {
			newTableIds = args.tableIds!;
		} else if (hasPerBlockMove) {
			if (args.fromTableId !== undefined && !reservation.tableIds.includes(args.fromTableId)) {
				return [
					null,
					new UserInputValidationError({
						fields: [{ field: "fromTableId", message: "Table is not part of the reservation" }],
					}).toObject(),
				];
			}
			newTableIds = applyPerBlockTableMove(reservation.tableIds, args.fromTableId, args.toTableId);
		}

		const effectiveStatus = reopening ? RESERVATION_STATUS.CONFIRMED : reservation.status;
		if (effectiveStatus === RESERVATION_STATUS.SEATED && newTableIds.length === 0) {
			return [
				null,
				new UserInputValidationError({
					fields: [
						{
							field: "tableIds",
							message: "Seated reservations must keep at least one table",
						},
					],
				}).toObject(),
			];
		}

		let loadedTables: Doc<typeof TABLE.TABLES>[] = [];
		if (newTableIds.length > 0) {
			const selectionError = validateTableSelection(newTableIds);
			if (selectionError) return [null, selectionError];

			const [tables, validateError] = await loadAndValidateTables(
				ctx,
				newTableIds,
				reservation.restaurantId
			);
			if (validateError) return [null, validateError];
			loadedTables = tables;

			if (!requiredCapacityCovered(loadedTables, reservation.partySize)) {
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
		}

		const conflictError = await checkTablesFreeForReservation(ctx, loadedTables, {
			_id: reservation._id,
			startsAt,
			endsAt,
		});
		if (conflictError) return [null, conflictError];

		const now = Date.now();
		await ctx.db.patch(reservation._id, {
			...(hasTimeChange && { startsAt, endsAt }),
			...(hasTableChange && { tableIds: newTableIds }),
			...(reopening && buildReopenToConfirmedPatch(reservation, now)),
			updatedAt: now,
		});

		// Both before and after: a reschedule is the transition a guest is most
		// likely to dispute ("nobody told me you moved us to 9pm").
		await appendAuditEvent(ctx, {
			aggregateType: TABLE.RESERVATIONS,
			aggregateId: reservation._id,
			eventType: AUDIT_EVENT.RESERVATION_RESCHEDULED,
			payload: {
				restaurantId: reservation.restaurantId,
				fromStatus: reservation.status,
				fromStartsAt: reservation.startsAt,
				fromEndsAt: reservation.endsAt,
				fromTableIds: reservation.tableIds,
				toStartsAt: startsAt,
				toEndsAt: endsAt,
				toTableIds: newTableIds,
				reopened: reopening,
			},
			userId,
		});

		if (reservation.sessionId && hasTableChange) {
			const session = await ctx.db.get(reservation.sessionId);
			if (session && newTableIds.length > 0) {
				let nextSessionTableId: Id<typeof TABLE.TABLES> | undefined;
				if (hasTableReplace) {
					nextSessionTableId =
						session.tableId && newTableIds.includes(session.tableId)
							? session.tableId
							: newTableIds[0];
				} else {
					const sessionTableMoved =
						args.fromTableId !== undefined && session.tableId === args.fromTableId;
					if (sessionTableMoved) {
						nextSessionTableId =
							args.toTableId !== undefined &&
							args.toTableId !== null &&
							newTableIds.includes(args.toTableId)
								? args.toTableId
								: newTableIds[0];
					}
				}
				if (nextSessionTableId) {
					await ctx.db.patch(session._id, { tableId: nextSessionTableId });
				}
			}
		}

		return [reservation._id, null];
	},
});

// ============================================================================
// Reconfirm: reopen cancelled / no_show (drawer)
// ============================================================================

type ReconfirmErrors =
	| StaffAuthErrors
	| NotFoundErrorObject
	| UserInputValidationErrorObject
	| ConflictErrorObject;

/**
 * Reopens a terminal reservation as confirmed. Optionally assigns tables
 * (same validation as confirm) when `tableIds` is provided.
 */
export const reconfirm = mutation({
	args: {
		reservationId: v.id(TABLE.RESERVATIONS),
		tableIds: v.optional(v.array(v.id(TABLE.TABLES))),
	},
	handler: async function (ctx, args): AsyncReturn<Id<typeof TABLE.RESERVATIONS>, ReconfirmErrors> {
		const [userId, authError] = await getCurrentUserId(ctx);
		if (authError) return [null, authError];
		const reservation = await ctx.db.get(args.reservationId);
		if (!reservation) return [null, new NotFoundError("Reservation not found").toObject()];

		const [, restError] = await requireRestaurantStaffAccess(ctx, userId, reservation.restaurantId);
		if (restError) return [null, restError];

		const recoverError = ensureTerminalRecoverable(reservation.status);
		if (recoverError) return [null, recoverError];

		let tableIds = reservation.tableIds;
		if (args.tableIds !== undefined) {
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
			tableIds = args.tableIds;
		}

		const now = Date.now();
		await ctx.db.patch(reservation._id, {
			...buildReopenToConfirmedPatch(reservation, now),
			...(args.tableIds !== undefined && { tableIds }),
		});

		// Reopening a cancelled / no-show row. Worth its own name: it is the only
		// path that walks a reservation back out of a terminal status.
		await appendAuditEvent(ctx, {
			aggregateType: TABLE.RESERVATIONS,
			aggregateId: reservation._id,
			eventType: AUDIT_EVENT.RESERVATION_RECONFIRMED,
			payload: {
				restaurantId: reservation.restaurantId,
				fromStatus: reservation.status,
				tableIds,
				startsAt: reservation.startsAt,
			},
			userId,
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

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.RESERVATIONS,
			aggregateId: reservation._id,
			eventType: AUDIT_EVENT.RESERVATION_CANCELLED,
			payload: {
				restaurantId: reservation.restaurantId,
				fromStatus: reservation.status,
				startsAt: reservation.startsAt,
				partySize: reservation.partySize,
				reason: args.reason,
			},
			userId,
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
	| UserInputValidationErrorObject
	| ConflictErrorObject;

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
	): AsyncReturn<
		{ reservationId: Id<typeof TABLE.RESERVATIONS>; sessionId: Id<typeof TABLE.SESSIONS> },
		MarkSeatedErrors
	> {
		const [userId, authError] = await getCurrentUserId(ctx);
		if (authError) return [null, authError];
		const reservation = await ctx.db.get(args.reservationId);
		if (!reservation) return [null, new NotFoundError("Reservation not found").toObject()];

		const [, restError] = await requireRestaurantStaffAccess(ctx, userId, reservation.restaurantId);
		if (restError) return [null, restError];

		const seatableStatuses: ReservationStatus[] = [
			RESERVATION_STATUS.CONFIRMED,
			RESERVATION_STATUS.CANCELLED,
			RESERVATION_STATUS.NO_SHOW,
		];
		if (!seatableStatuses.includes(reservation.status)) {
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

		const [seatedTable, tableLoadError] = await loadAndValidateTables(
			ctx,
			[tableId],
			reservation.restaurantId
		);
		if (tableLoadError) return [null, tableLoadError];

		const conflictError = await checkTablesFreeForReservation(ctx, seatedTable, reservation);
		if (conflictError) return [null, conflictError];

		const sessionId = await createSessionForReservation(ctx, {
			restaurantId: reservation.restaurantId,
			tableId,
			...(args.serverMemberId !== undefined && { serverMemberId: args.serverMemberId }),
			...(reservation.userId !== undefined && { userId: reservation.userId }),
		});
		const now = Date.now();
		const fromTerminal = isTerminalRecoverable(reservation.status);
		await ctx.db.patch(reservation._id, {
			status: RESERVATION_STATUS.SEATED,
			sessionId,
			seatedAt: now,
			updatedAt: now,
			...(fromTerminal && {
				confirmedAt: reservation.confirmedAt ?? now,
				cancelledAt: undefined,
				cancelReason: undefined,
			}),
		});

		// Seating opens a session, which is where money starts accruing -- so this
		// event is the join between the reservation and the tab.
		await appendAuditEvent(ctx, {
			aggregateType: TABLE.RESERVATIONS,
			aggregateId: reservation._id,
			eventType: AUDIT_EVENT.RESERVATION_SEATED,
			payload: {
				restaurantId: reservation.restaurantId,
				fromStatus: reservation.status,
				sessionId,
				tableId,
				partySize: reservation.partySize,
				fromTerminal,
			},
			userId,
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

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.RESERVATIONS,
			aggregateId: reservation._id,
			eventType: AUDIT_EVENT.RESERVATION_COMPLETED,
			payload: {
				restaurantId: reservation.restaurantId,
				fromStatus: reservation.status,
				sessionId: reservation.sessionId,
				seatedAt: reservation.seatedAt,
			},
			userId,
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
				q
					.eq("restaurantId", args.restaurantId)
					.gte("startsAt", args.fromMs)
					.lt("startsAt", args.toMs)
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
						q
							.eq("restaurantId", restaurantId)
							.gte("startsAt", args.fromMs)
							.lt("startsAt", args.toMs)
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

/** The only statuses the no-show sweep can flip. Each gets its own index pass. */
const NO_SHOW_SWEEPABLE_STATUSES = [
	RESERVATION_STATUS.PENDING,
	RESERVATION_STATUS.CONFIRMED,
] as const;

/**
 * Cron-triggered. Flips any pending/confirmed reservation that's past
 * `startsAt + noShowGraceMinutes` to `no_show`. Idempotent: rows that have
 * already moved on are left alone.
 *
 * Bounded on both ends. The previous version queried `by_restaurant_time` with
 * only an upper bound, so every 15-minute run re-read each restaurant's entire
 * reservation history and filtered status in JS. Now each restaurant gets one
 * `by_restaurant_status_time` pass per sweepable status, windowed to
 * `(now - NO_SHOW_SWEEP_LOOKBACK_MS, cutoff)` and capped at
 * NO_SHOW_SWEEP_BATCH_SIZE. A flipped row leaves the pending/confirmed ranges,
 * so a backlog drains across runs instead of being skipped.
 */
export const sweepNoShows = internalMutation({
	args: {},
	handler: async (ctx) => {
		const now = Date.now();
		const lookbackFloor = now - NO_SHOW_SWEEP_LOOKBACK_MS;

		// Restaurants are read in full because the grace period is per-restaurant
		// and there is no index for "not soft-deleted". This table is bounded by
		// tenant count, not by traffic, so it is not the scan that mattered here.
		const restaurants = await ctx.db.query(TABLE.RESTAURANTS).collect();
		let flipped = 0;

		for (const restaurant of restaurants) {
			if (restaurant.deletedAt !== undefined) continue;

			const settings = await loadEffectiveSettings(ctx, restaurant._id);
			const cutoff = now - settings.noShowGraceMinutes * 60_000;
			if (cutoff <= lookbackFloor) continue;

			for (const status of NO_SHOW_SWEEPABLE_STATUSES) {
				const candidates = await ctx.db
					.query(TABLE.RESERVATIONS)
					.withIndex("by_restaurant_status_time", (q) =>
						q
							.eq("restaurantId", restaurant._id)
							.eq("status", status)
							.gt("startsAt", lookbackFloor)
							.lt("startsAt", cutoff)
					)
					.take(NO_SHOW_SWEEP_BATCH_SIZE);

				for (const r of candidates) {
					await ctx.db.patch(r._id, {
						status: RESERVATION_STATUS.NO_SHOW,
						updatedAt: now,
					});
					flipped++;

					// System-flipped, not staff-flipped. Guests dispute no-shows, and
					// without this the row's only trace is a status with no actor and
					// no reason.
					await appendAuditEvent(ctx, {
						aggregateType: TABLE.RESERVATIONS,
						aggregateId: r._id,
						eventType: AUDIT_EVENT.RESERVATION_NO_SHOW,
						payload: {
							restaurantId: restaurant._id,
							fromStatus: status,
							startsAt: r.startsAt,
							partySize: r.partySize,
							graceMinutes: settings.noShowGraceMinutes,
						},
						userId: AUDIT_SYSTEM_USER_ID,
					});
				}
			}
		}

		return { flipped };
	},
});

/**
 * Internal export query: returns denormalized reservation rows whose
 * `startsAt` falls in the given window. The caller (an action) is responsible
 * for translating timestamps into the restaurant's local month index.
 */
export const internalListReservationsForExportYear = internalQuery({
	args: {
		actingUserId: v.string(),
		restaurantId: v.id(TABLE.RESTAURANTS),
		fromMs: v.number(),
		toMs: v.number(),
	},
	handler: async (ctx, args) => {
		const [, aerr] = await requireRestaurantManagerOrAbove(
			ctx,
			args.actingUserId,
			args.restaurantId
		);
		if (aerr) throw new Error("Unauthorized");

		const reservations = await ctx.db
			.query(TABLE.RESERVATIONS)
			.withIndex("by_restaurant_time", (q) =>
				q
					.eq("restaurantId", args.restaurantId)
					.gte("startsAt", args.fromMs)
					.lte("startsAt", args.toMs)
			)
			.collect();

		const tableNumberCache = new Map<Id<"tables">, number>();

		const denormRows = await Promise.all(
			reservations.map(async (r) => {
				const tableNumbers: number[] = [];
				for (const tableId of r.tableIds) {
					let n: number | null = null;
					if (tableNumberCache.has(tableId)) {
						n = tableNumberCache.get(tableId) ?? null;
					} else {
						const table = await ctx.db.get(tableId);
						if (table) {
							n = table.tableNumber;
							tableNumberCache.set(tableId, table.tableNumber);
						}
					}
					if (n !== null) tableNumbers.push(n);
				}
				tableNumbers.sort((a, b) => a - b);
				const tablesText = tableNumbers.join(", ");

				return {
					id: r._id as string,
					startsAt: r.startsAt,
					endsAt: r.endsAt,
					partySize: r.partySize,
					status: r.status,
					source: r.source,
					guestName: r.contact.name,
					guestPhone: r.contact.phone,
					guestEmail: r.contact.email ?? "",
					tablesText,
					notes: r.notes ?? "",
					confirmedAt: r.confirmedAt ?? null,
					seatedAt: r.seatedAt ?? null,
					completedAt: r.completedAt ?? null,
					cancelledAt: r.cancelledAt ?? null,
					cancelReason: r.cancelReason ?? "",
					createdAt: r.createdAt,
				};
			})
		);

		return denormRows;
	},
});
