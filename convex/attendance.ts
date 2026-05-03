import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import {
	NotAuthenticatedErrorObject,
	NotAuthorizedErrorObject,
	NotFoundError,
	NotFoundErrorObject,
	UserInputValidationErrorObject,
} from "./_shared/errors";
import { AsyncReturn } from "./_shared/types";
import { stampUpdated } from "./_util/audit";
import {
	getCurrentUserId,
	getRestaurantMembership,
	requireRestaurantManagerOrAbove,
} from "./_util/auth";
import {
	ABSENCE_REQUEST_STATUS,
	ABSENCE_TYPE,
	ATTENDANCE_STATUS,
	CLOCK_EVENT_SOURCE,
	CLOCK_EVENT_TYPE,
	TABLE,
} from "./constants";

type AuthE = NotAuthenticatedErrorObject | NotAuthorizedErrorObject;

async function requireActiveMember(
	ctx: { db: import("./_generated/server").QueryCtx["db"] },
	userId: string,
	restaurantId: Id<"restaurants">
) {
	const m = await getRestaurantMembership(ctx, userId, restaurantId);
	if (!m?.isActive) return [null, new NotFoundError("Not a member of this restaurant").toObject()] as const;
	return [m, null] as const;
}

export const clockIn = mutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		shiftId: v.optional(v.id(TABLE.SHIFTS)),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<Id<"clockEvents">, AuthE | NotFoundErrorObject | UserInputValidationErrorObject> {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];
		const [member, merr] = await requireActiveMember(ctx, userId, args.restaurantId);
		if (merr) return [null, merr];

		const now = Date.now();
		const id = await ctx.db.insert(TABLE.CLOCK_EVENTS, {
			memberId: member._id,
			restaurantId: args.restaurantId,
			type: CLOCK_EVENT_TYPE.IN,
			at: now,
			shiftId: args.shiftId,
			source: CLOCK_EVENT_SOURCE.WEB,
			createdAt: now,
		});

		if (args.shiftId) {
			const existing = await ctx.db
				.query(TABLE.SHIFT_ATTENDANCE)
				.withIndex("by_shift", (q) => q.eq("shiftId", args.shiftId!))
				.first();
			const shift = await ctx.db.get(args.shiftId);
			if (shift) {
				const lateMinutes = Math.max(0, Math.round((now - shift.startsAt) / 60_000));
				const patch = {
					shiftId: args.shiftId,
					restaurantId: args.restaurantId,
					memberId: member._id,
					status: ATTENDANCE_STATUS.PRESENT,
					scheduledStart: shift.startsAt,
					scheduledEnd: shift.endsAt,
					actualStart: now,
					lateMinutes,
					earlyDepartureMinutes: 0,
					lastComputedAt: now,
				};
				if (existing) {
					await ctx.db.patch(existing._id, patch);
				} else {
					await ctx.db.insert(TABLE.SHIFT_ATTENDANCE, patch);
				}
			}
		}

		return [id, null];
	},
});

export const clockOut = mutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		shiftId: v.optional(v.id(TABLE.SHIFTS)),
		reason: v.optional(v.string()),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<Id<"clockEvents">, AuthE | NotFoundErrorObject | UserInputValidationErrorObject> {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];
		const [member, merr] = await requireActiveMember(ctx, userId, args.restaurantId);
		if (merr) return [null, merr];

		const now = Date.now();
		const id = await ctx.db.insert(TABLE.CLOCK_EVENTS, {
			memberId: member._id,
			restaurantId: args.restaurantId,
			type: CLOCK_EVENT_TYPE.OUT,
			at: now,
			shiftId: args.shiftId,
			source: CLOCK_EVENT_SOURCE.WEB,
			reason: args.reason,
			createdAt: now,
		});

		if (args.shiftId) {
			const row = await ctx.db
				.query(TABLE.SHIFT_ATTENDANCE)
				.withIndex("by_shift", (q) => q.eq("shiftId", args.shiftId!))
				.first();
			const shift = await ctx.db.get(args.shiftId);
			if (row && shift) {
				const earlyDepartureMinutes = Math.max(
					0,
					Math.round((shift.endsAt - now) / 60_000)
				);
				let status: (typeof ATTENDANCE_STATUS)[keyof typeof ATTENDANCE_STATUS] =
					ATTENDANCE_STATUS.PRESENT;
				if (earlyDepartureMinutes > 0 && args.reason) {
					status = ATTENDANCE_STATUS.EARLY_DEPARTURE;
				}
				await ctx.db.patch(row._id, {
					actualEnd: now,
					earlyDepartureMinutes,
					status,
					lastComputedAt: now,
				});
			}
		}

		return [id, null];
	},
});

export const correctClockEvent = mutation({
	args: {
		eventId: v.id(TABLE.CLOCK_EVENTS),
		newAt: v.number(),
		reason: v.string(),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<null, AuthE | NotFoundErrorObject> {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];

		const ev = await ctx.db.get(args.eventId);
		if (!ev) return [null, new NotFoundError("Clock event not found").toObject()];

		const [, aerr] = await requireRestaurantManagerOrAbove(ctx, userId, ev.restaurantId);
		if (aerr) return [null, aerr];

		await ctx.db.insert(TABLE.CLOCK_EVENTS, {
			memberId: ev.memberId,
			restaurantId: ev.restaurantId,
			type: ev.type,
			at: args.newAt,
			shiftId: ev.shiftId,
			source: CLOCK_EVENT_SOURCE.WEB,
			reason: args.reason,
			correctedBy: userId,
			originalAt: ev.at,
			createdAt: Date.now(),
		});

		return [null, null];
	},
});

export const requestAbsence = mutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		date: v.string(),
		type: v.union(
			v.literal(ABSENCE_TYPE.VACATION),
			v.literal(ABSENCE_TYPE.SICK),
			v.literal(ABSENCE_TYPE.UNEXCUSED),
			v.literal(ABSENCE_TYPE.OTHER)
		),
		reason: v.optional(v.string()),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<Id<"absences">, AuthE | NotFoundErrorObject> {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];
		const [member, merr] = await requireActiveMember(ctx, userId, args.restaurantId);
		if (merr) return [null, merr];

		const now = Date.now();
		const id = await ctx.db.insert(TABLE.ABSENCES, {
			memberId: member._id,
			restaurantId: args.restaurantId,
			date: args.date,
			type: args.type,
			reason: args.reason,
			status: ABSENCE_REQUEST_STATUS.PENDING,
			requestedAt: now,
			createdBy: userId,
			createdAt: now,
			updatedAt: now,
			updatedBy: userId,
		});

		return [id, null];
	},
});

export const decideAbsence = mutation({
	args: {
		absenceId: v.id(TABLE.ABSENCES),
		status: v.union(
			v.literal(ABSENCE_REQUEST_STATUS.APPROVED),
			v.literal(ABSENCE_REQUEST_STATUS.DENIED)
		),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<null, AuthE | NotFoundErrorObject> {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];

		const row = await ctx.db.get(args.absenceId);
		if (!row) return [null, new NotFoundError("Absence not found").toObject()];

		const [, aerr] = await requireRestaurantManagerOrAbove(ctx, userId, row.restaurantId);
		if (aerr) return [null, aerr];

		const now = Date.now();
		await ctx.db.patch(args.absenceId, {
			status: args.status,
			decidedBy: userId,
			decidedAt: now,
			...stampUpdated(userId),
		});

		return [null, null];
	},
});

export const listClockEventsForRestaurant = query({
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

		const rows = await ctx.db
			.query(TABLE.CLOCK_EVENTS)
			.withIndex("by_restaurant_time", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();
		const filtered = rows.filter((r) => r.at >= args.fromMs && r.at <= args.toMs);
		return [filtered, null];
	},
});

export const listAbsencesForRestaurant = query({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		fromDate: v.optional(v.string()),
		toDate: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];
		const [, aerr] = await requireRestaurantManagerOrAbove(ctx, userId, args.restaurantId);
		if (aerr) return [null, aerr];

		const rows = await ctx.db
			.query(TABLE.ABSENCES)
			.withIndex("by_restaurant_date_status", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();

		const filtered = rows.filter((r) => {
			if (args.fromDate && r.date < args.fromDate) return false;
			if (args.toDate && r.date > args.toDate) return false;
			return true;
		});
		return [filtered, null];
	},
});

export const listMyClockEventsForRestaurant = query({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		limit: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];
		const [member, merr] = await requireActiveMember(ctx, userId, args.restaurantId);
		if (merr) return [null, merr];

		const rows = await ctx.db
			.query(TABLE.CLOCK_EVENTS)
			.withIndex("by_member_time", (q) => q.eq("memberId", member._id))
			.order("desc")
			.take(args.limit ?? 30);

		return [rows, null];
	},
});

export const listMyAbsencesForRestaurant = query({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		fromDate: v.optional(v.string()),
		toDate: v.optional(v.string()),
		limit: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];
		const [member, merr] = await requireActiveMember(ctx, userId, args.restaurantId);
		if (merr) return [null, merr];

		const rows = await ctx.db
			.query(TABLE.ABSENCES)
			.withIndex("by_member_date", (q) => q.eq("memberId", member._id))
			.order("desc")
			.collect();

		const filtered = rows.filter((r) => {
			if (r.restaurantId !== args.restaurantId) return false;
			if (args.fromDate && r.date < args.fromDate) return false;
			if (args.toDate && r.date > args.toDate) return false;
			return true;
		});

		const lim = args.limit ?? 60;
		return [filtered.slice(0, lim), null];
	},
});

export const internalListClockEventsForExport = internalQuery({
	args: {
		actingUserId: v.string(),
		restaurantId: v.id(TABLE.RESTAURANTS),
		fromMs: v.number(),
		toMs: v.number(),
	},
	handler: async (ctx, args) => {
		const [, aerr] = await requireRestaurantManagerOrAbove(ctx, args.actingUserId, args.restaurantId);
		if (aerr) throw new Error("Unauthorized");

		const rows = await ctx.db
			.query(TABLE.CLOCK_EVENTS)
			.withIndex("by_restaurant_time", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();
		return rows.filter((r) => r.at >= args.fromMs && r.at <= args.toMs);
	},
});

export const internalListAbsencesForExport = internalQuery({
	args: {
		actingUserId: v.string(),
		restaurantId: v.id(TABLE.RESTAURANTS),
		fromDate: v.optional(v.string()),
		toDate: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const [, aerr] = await requireRestaurantManagerOrAbove(ctx, args.actingUserId, args.restaurantId);
		if (aerr) throw new Error("Unauthorized");

		const rows = await ctx.db
			.query(TABLE.ABSENCES)
			.withIndex("by_restaurant_date_status", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();
		return rows.filter((r) => {
			if (args.fromDate && r.date < args.fromDate) return false;
			if (args.toDate && r.date > args.toDate) return false;
			return true;
		});
	},
});

export const sweepStaleShiftAttendance = internalMutation({
	args: {},
	handler: async (ctx) => {
		const now = Date.now();
		const rows = await ctx.db.query(TABLE.SHIFT_ATTENDANCE).collect();
		let patched = 0;
		for (const row of rows) {
			if (row.actualEnd !== undefined) continue;
			if (row.actualStart === undefined) continue;
			if (row.scheduledEnd >= now) continue;
			if (row.status === ATTENDANCE_STATUS.NO_CLOCKOUT) continue;

			await ctx.db.patch(row._id, {
				status: ATTENDANCE_STATUS.NO_CLOCKOUT,
				lastComputedAt: now,
			});
			patched++;
		}
		return { patched };
	},
});
