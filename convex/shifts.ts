import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalQuery, mutation, query } from "./_generated/server";
import {
	NotAuthenticatedErrorObject,
	NotAuthorizedErrorObject,
	NotFoundError,
	NotFoundErrorObject,
	UserInputValidationError,
	UserInputValidationErrorObject,
} from "./_shared/errors";
import { AsyncReturn } from "./_shared/types";
import { appendAuditEvent } from "./_util/audit";
import { getCurrentUserId, requireRestaurantManagerOrAbove } from "./_util/auth";
import { SHIFT_STATUS, TABLE } from "./constants";

type AuthE = NotAuthenticatedErrorObject | NotAuthorizedErrorObject;

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
	return aStart < bEnd && bStart < aEnd;
}

export const listForRestaurant = query({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		fromMs: v.number(),
		toMs: v.number(),
	},
	handler: async (ctx, args) => {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];
		const [, aerr] = await requireRestaurantManagerOrAbove(ctx, userId, args.restaurantId);
		if (aerr) return [null, aerr];

		const shifts = await ctx.db
			.query(TABLE.SHIFTS)
			.withIndex("by_restaurant_time", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();
		const filtered = shifts.filter(
			(s) => rangesOverlap(s.startsAt, s.endsAt, args.fromMs, args.toMs)
		);
		return [filtered, null];
	},
});

export const createShift = mutation({
	args: {
		memberId: v.id(TABLE.RESTAURANT_MEMBERS),
		restaurantId: v.id(TABLE.RESTAURANTS),
		startsAt: v.number(),
		endsAt: v.number(),
		shiftRole: v.optional(v.string()),
		notes: v.optional(v.string()),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<Id<"shifts">, AuthE | NotFoundErrorObject | UserInputValidationErrorObject> {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];
		const [, aerr] = await requireRestaurantManagerOrAbove(ctx, userId, args.restaurantId);
		if (aerr) return [null, aerr];

		if (args.endsAt <= args.startsAt) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "endsAt", message: "Must be after startsAt" }],
				}).toObject(),
			];
		}

		const member = await ctx.db.get(args.memberId);
		if (!member || member.restaurantId !== args.restaurantId) {
			return [null, new NotFoundError("Team member not found for restaurant").toObject()];
		}

		const existingMemberShifts = await ctx.db
			.query(TABLE.SHIFTS)
			.withIndex("by_member_time", (q) => q.eq("memberId", args.memberId))
			.collect();
		for (const s of existingMemberShifts) {
			if (s.status === SHIFT_STATUS.CANCELLED) continue;
			if (rangesOverlap(s.startsAt, s.endsAt, args.startsAt, args.endsAt)) {
				return [
					null,
					new UserInputValidationError({
						fields: [{ field: "startsAt", message: "Overlaps another shift for this member" }],
					}).toObject(),
				];
			}
		}

		const now = Date.now();
		const id = await ctx.db.insert(TABLE.SHIFTS, {
			memberId: args.memberId,
			restaurantId: args.restaurantId,
			startsAt: args.startsAt,
			endsAt: args.endsAt,
			shiftRole: args.shiftRole,
			status: SHIFT_STATUS.SCHEDULED,
			notes: args.notes,
			createdBy: userId,
			createdAt: now,
			updatedAt: now,
			updatedBy: userId,
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.SHIFTS,
			aggregateId: id,
			eventType: "shifts.created",
			payload: args,
			userId,
		});

		return [id, null];
	},
});

export const upsertTableAssignment = mutation({
	args: {
		shiftId: v.id(TABLE.SHIFTS),
		tableId: v.id(TABLE.TABLES),
		startsAt: v.number(),
		endsAt: v.number(),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<Id<"shiftTableAssignments">, AuthE | NotFoundErrorObject | UserInputValidationErrorObject> {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];

		const shift = await ctx.db.get(args.shiftId);
		if (!shift) return [null, new NotFoundError("Shift not found").toObject()];
		const [, aerr] = await requireRestaurantManagerOrAbove(ctx, userId, shift.restaurantId);
		if (aerr) return [null, aerr];

		if (args.endsAt <= args.startsAt) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "endsAt", message: "Must be after startsAt" }],
				}).toObject(),
			];
		}

		const table = await ctx.db.get(args.tableId);
		if (!table || table.restaurantId !== shift.restaurantId) {
			return [null, new NotFoundError("Table not found").toObject()];
		}

		const windowStart = Math.max(args.startsAt, shift.startsAt);
		const windowEnd = Math.min(args.endsAt, shift.endsAt);
		if (windowEnd <= windowStart) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "startsAt", message: "Assignment must overlap the shift window" }],
				}).toObject(),
			];
		}

		const others = await ctx.db
			.query(TABLE.SHIFT_TABLE_ASSIGNMENTS)
			.withIndex("by_table_time", (q) => q.eq("tableId", args.tableId))
			.collect();
		for (const o of others) {
			if (o.shiftId === args.shiftId) continue;
			if (rangesOverlap(o.startsAt, o.endsAt, windowStart, windowEnd)) {
				return [
					null,
					new UserInputValidationError({
						fields: [{ field: "tableId", message: "Table already covered in this window" }],
					}).toObject(),
				];
			}
		}

		const now = Date.now();
		const id = await ctx.db.insert(TABLE.SHIFT_TABLE_ASSIGNMENTS, {
			shiftId: args.shiftId,
			restaurantId: shift.restaurantId,
			tableId: args.tableId,
			startsAt: windowStart,
			endsAt: windowEnd,
			createdBy: userId,
			createdAt: now,
			updatedAt: now,
			updatedBy: userId,
		});

		return [id, null];
	},
});

/** For CSV export actions — caller must pass an authenticated acting user id. */
export const internalListShiftsForExport = internalQuery({
	args: {
		actingUserId: v.string(),
		restaurantId: v.id(TABLE.RESTAURANTS),
		fromMs: v.number(),
		toMs: v.number(),
	},
	handler: async (ctx, args) => {
		const [, aerr] = await requireRestaurantManagerOrAbove(ctx, args.actingUserId, args.restaurantId);
		if (aerr) throw new Error("Unauthorized");

		const shifts = await ctx.db
			.query(TABLE.SHIFTS)
			.withIndex("by_restaurant_time", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();
		return shifts.filter((s) => rangesOverlap(s.startsAt, s.endsAt, args.fromMs, args.toMs));
	},
});
