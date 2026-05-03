/**
 * Time-windowed table locks.
 *
 * Owners and managers create locks to take a table out of service for a
 * window (maintenance, private event, broken AC, etc.). Locks are read by
 * `_util/availability.ts` so reserved-out tables disappear from public
 * availability and the staff table picker.
 *
 * Conflict policy:
 * - Locking a window that already has an active reservation is rejected with
 *   ERROR_TABLE_HAS_RESERVATIONS. Staff can cancel the reservation first.
 * - Reservation overlap reads union locks via `findOverlappingLocks`, so the
 *   reverse case (book over a lock) is rejected by the create/confirm paths.
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
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
	requireRestaurantManagerOrAbove,
	requireRestaurantStaffAccess,
} from "./_util/auth";
import { findOverlappingReservations } from "./_util/availability";
import { TABLE } from "./constants";

type TableLockDoc = Doc<typeof TABLE.TABLE_LOCKS>;
type StaffAuthErrors = NotAuthenticatedErrorObject | NotAuthorizedErrorObject;

type CreateErrors =
	| StaffAuthErrors
	| NotFoundErrorObject
	| UserInputValidationErrorObject
	| ConflictErrorObject;

export const create = mutation({
	args: {
		tableId: v.id(TABLE.TABLES),
		startsAt: v.number(),
		endsAt: v.number(),
		reason: v.optional(v.string()),
	},
	handler: async function (ctx, args): AsyncReturn<Id<typeof TABLE.TABLE_LOCKS>, CreateErrors> {
		const [userId, authError] = await getCurrentUserId(ctx);
		if (authError) return [null, authError];
		const tablePreview = await ctx.db.get(args.tableId);
		if (!tablePreview) return [null, new NotFoundError("Table not found").toObject()];
		const [, managerError] = await requireRestaurantManagerOrAbove(
			ctx,
			userId,
			tablePreview.restaurantId
		);
		if (managerError) return [null, managerError];

		if (args.endsAt <= args.startsAt) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "endsAt", message: "Must be after startsAt" }],
				}).toObject(),
			];
		}

		const table = tablePreview;

		const [, restError] = await requireRestaurantStaffAccess(ctx, userId, table.restaurantId);
		if (restError) return [null, restError];

		// Reject if the window overlaps an existing active reservation. Staff
		// must cancel the reservation first so we never silently strand a
		// guest.
		const conflicting = await findOverlappingReservations(
			ctx,
			args.tableId,
			args.startsAt,
			args.endsAt
		);
		if (conflicting.length > 0) {
			return [null, new ConflictError("ERROR_TABLE_HAS_RESERVATIONS").toObject()];
		}

		const id = await ctx.db.insert(TABLE.TABLE_LOCKS, {
			restaurantId: table.restaurantId,
			tableId: args.tableId,
			startsAt: args.startsAt,
			endsAt: args.endsAt,
			reason: args.reason,
			lockedBy: userId,
			createdAt: Date.now(),
		});
		return [id, null];
	},
});

type RemoveErrors = StaffAuthErrors | NotFoundErrorObject;

export const remove = mutation({
	args: { lockId: v.id(TABLE.TABLE_LOCKS) },
	handler: async function (ctx, args): AsyncReturn<null, RemoveErrors> {
		const [userId, authError] = await getCurrentUserId(ctx);
		if (authError) return [null, authError];
		const lockPreview = await ctx.db.get(args.lockId);
		if (!lockPreview) return [null, new NotFoundError("Lock not found").toObject()];
		const [, managerError] = await requireRestaurantManagerOrAbove(
			ctx,
			userId,
			lockPreview.restaurantId
		);
		if (managerError) return [null, managerError];

		const lock = lockPreview;

		const [, restError] = await requireRestaurantStaffAccess(ctx, userId, lock.restaurantId);
		if (restError) return [null, restError];

		await ctx.db.delete(lock._id);
		return [null, null];
	},
});

type ListErrors = StaffAuthErrors | NotFoundErrorObject;

/** Locks for a single table (e.g. when surfaced in the table picker). */
export const listForTable = query({
	args: {
		tableId: v.id(TABLE.TABLES),
		fromMs: v.optional(v.number()),
		toMs: v.optional(v.number()),
	},
	handler: async function (ctx, args): AsyncReturn<TableLockDoc[], ListErrors> {
		const [userId, authError] = await getCurrentUserId(ctx);
		if (authError) return [null, authError];

		const table = await ctx.db.get(args.tableId);
		if (!table) return [null, new NotFoundError("Table not found").toObject()];

		const [, restError] = await requireRestaurantStaffAccess(ctx, userId, table.restaurantId);
		if (restError) return [null, restError];

		const rows = await ctx.db
			.query(TABLE.TABLE_LOCKS)
			.withIndex("by_table_time", (q) => q.eq("tableId", args.tableId))
			.collect();
		const filtered = rows.filter((r) => {
			if (args.fromMs !== undefined && r.endsAt <= args.fromMs) return false;
			if (args.toMs !== undefined && r.startsAt >= args.toMs) return false;
			return true;
		});
		return [filtered, null];
	},
});

/** Locks across the whole restaurant (e.g. on the locks manager panel). */
export const listForRestaurant = query({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		fromMs: v.optional(v.number()),
		toMs: v.optional(v.number()),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<TableLockDoc[], StaffAuthErrors | NotFoundErrorObject> {
		const [userId, authError] = await getCurrentUserId(ctx);
		if (authError) return [null, authError];
		const [, restError] = await requireRestaurantStaffAccess(ctx, userId, args.restaurantId);
		if (restError) return [null, restError];

		const rows = await ctx.db
			.query(TABLE.TABLE_LOCKS)
			.withIndex("by_restaurant_time", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();
		const filtered = rows.filter((r) => {
			if (args.fromMs !== undefined && r.endsAt <= args.fromMs) return false;
			if (args.toMs !== undefined && r.startsAt >= args.toMs) return false;
			return true;
		});
		return [filtered, null];
	},
});
