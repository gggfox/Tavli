/**
 * Shared employee session queries and PIN step-up mutations.
 * See ADR 006 for the authentication model.
 *
 * All queries/mutations in this module are gated by
 * `requireSharedEmployeeSession` — only the per-restaurant shared Clerk
 * identity can call them. PIN-gated reads use mutations so failed attempts
 * persist lockout state via `verifyEmployeePin`.
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import {
	NotAuthenticatedErrorObject,
	NotAuthorizedErrorObject,
	NotFoundError,
	NotFoundErrorObject,
} from "./_shared/errors";
import { AsyncReturn } from "./_shared/types";
import { requireSharedEmployeeSession, verifyEmployeePin } from "./_util/auth";
import { ATTENDANCE_STATUS, CLOCK_EVENT_SOURCE, CLOCK_EVENT_TYPE, TABLE } from "./constants";

type SharedErrors = NotAuthenticatedErrorObject | NotAuthorizedErrorObject | NotFoundErrorObject;

type PinVerifiedEmployee = {
	account: Doc<"employeeAccounts">;
	memberId: Id<"restaurantMembers">;
};

async function verifySharedEmployeePinStepUp(
	ctx: MutationCtx,
	restaurantId: Id<"restaurants">,
	employeeAccountId: Id<"employeeAccounts">,
	pin: string
): AsyncReturn<PinVerifiedEmployee, SharedErrors> {
	const [, sessErr] = await requireSharedEmployeeSession(ctx, restaurantId);
	if (sessErr) return [null, sessErr];

	const [account, pinErr] = await verifyEmployeePin(ctx, employeeAccountId, pin);
	if (pinErr) return [null, pinErr];

	if (account.restaurantId !== restaurantId) {
		return [null, new NotFoundError("Employee account not found").toObject()];
	}

	const memberRow = await ctx.db
		.query(TABLE.RESTAURANT_MEMBERS)
		.withIndex("by_employee_account", (q) => q.eq("employeeAccountId", employeeAccountId))
		.first();
	if (!memberRow) {
		return [null, new NotFoundError("Membership not found").toObject()];
	}

	return [{ account, memberId: memberRow._id }, null];
}

export const listDirectoryForSharedSession = query({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async (ctx, args) => {
		const [, err] = await requireSharedEmployeeSession(ctx, args.restaurantId);
		if (err) return [null, err];

		const members = await ctx.db
			.query(TABLE.RESTAURANT_MEMBERS)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();

		const directory: Array<{
			employeeAccountId: Id<"employeeAccounts"> | null;
			memberId: Id<"restaurantMembers">;
			firstName: string | null;
			paternalLastname: string | null;
			maternalLastname: string | null;
			photoUrl: string | null;
			role: string;
		}> = [];

		for (const m of members) {
			if (!m.isActive || m.removedAt != null) continue;

			if (m.employeeAccountId) {
				const account = await ctx.db.get(m.employeeAccountId);
				if (!account || account.removedAt != null) continue;

				let photoUrl: string | null = null;
				if (account.photoStorageId) {
					photoUrl = await ctx.storage.getUrl(account.photoStorageId);
				}

				directory.push({
					employeeAccountId: m.employeeAccountId,
					memberId: m._id,
					firstName: account.firstName,
					paternalLastname: account.paternalLastname,
					maternalLastname: account.maternalLastname,
					photoUrl,
					role: m.role,
				});
			} else {
				directory.push({
					employeeAccountId: null,
					memberId: m._id,
					firstName: null,
					paternalLastname: null,
					maternalLastname: null,
					photoUrl: null,
					role: m.role,
				});
			}
		}

		directory.sort((a, b) => {
			const aKey = a.paternalLastname ?? "";
			const bKey = b.paternalLastname ?? "";
			return aKey.localeCompare(bKey, undefined, { sensitivity: "base" });
		});

		return [directory, null];
	},
});

export const getOwnTipsWithPin = mutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		employeeAccountId: v.id(TABLE.EMPLOYEE_ACCOUNTS),
		pin: v.string(),
		fromBusinessDate: v.string(),
		toBusinessDate: v.string(),
	},
	handler: async (ctx, args) => {
		const [verified, verifyErr] = await verifySharedEmployeePinStepUp(
			ctx,
			args.restaurantId,
			args.employeeAccountId,
			args.pin
		);
		if (verifyErr) return [null, verifyErr];
		const { memberId } = verified;

		const pools = await ctx.db
			.query(TABLE.TIP_POOLS)
			.withIndex("by_restaurant_date", (q) =>
				q
					.eq("restaurantId", args.restaurantId)
					.gte("businessDate", args.fromBusinessDate)
					.lte("businessDate", args.toBusinessDate)
			)
			.collect();

		const perDay: Array<{
			businessDate: string;
			amountCents: number;
			sharePercent: number;
			poolStatus: string;
		}> = [];
		let totalCents = 0;

		for (const pool of pools) {
			const share = await ctx.db
				.query(TABLE.TIP_POOL_SHARES)
				.withIndex("by_pool", (q) => q.eq("poolId", pool._id))
				.filter((q) => q.eq(q.field("memberId"), memberId))
				.first();
			if (!share) continue;
			totalCents += share.amountCents;
			perDay.push({
				businessDate: pool.businessDate,
				amountCents: share.amountCents,
				sharePercent: share.sharePercent,
				poolStatus: pool.status,
			});
		}

		perDay.sort((a, b) => (a.businessDate < b.businessDate ? 1 : -1));

		return [{ totalCents, perDay }, null];
	},
});

export const getOwnAttendanceWithPin = mutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		employeeAccountId: v.id(TABLE.EMPLOYEE_ACCOUNTS),
		pin: v.string(),
		fromMs: v.number(),
		toMs: v.number(),
	},
	handler: async (ctx, args) => {
		const [verified, verifyErr] = await verifySharedEmployeePinStepUp(
			ctx,
			args.restaurantId,
			args.employeeAccountId,
			args.pin
		);
		if (verifyErr) return [null, verifyErr];
		const { memberId } = verified;

		const clockEvents = await ctx.db
			.query(TABLE.CLOCK_EVENTS)
			.withIndex("by_member_time", (q) =>
				q.eq("memberId", memberId).gte("at", args.fromMs).lte("at", args.toMs)
			)
			.collect();

		let totalHours = 0;
		for (let i = 0; i < clockEvents.length; i++) {
			const ev = clockEvents[i];
			if (ev.type === CLOCK_EVENT_TYPE.IN) {
				const nextOut = clockEvents.slice(i + 1).find((e) => e.type === CLOCK_EVENT_TYPE.OUT);
				if (nextOut) {
					totalHours += (nextOut.at - ev.at) / 3_600_000;
				}
			}
		}

		return [
			{
				clockEvents: clockEvents.map((e) => ({
					type: e.type,
					at: e.at,
					source: e.source,
				})),
				totalHours: Math.round(totalHours * 100) / 100,
			},
			null,
		];
	},
});

export const getOwnScheduleWithPin = mutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		employeeAccountId: v.id(TABLE.EMPLOYEE_ACCOUNTS),
		pin: v.string(),
		fromMs: v.number(),
		toMs: v.number(),
	},
	handler: async (ctx, args) => {
		const [verified, verifyErr] = await verifySharedEmployeePinStepUp(
			ctx,
			args.restaurantId,
			args.employeeAccountId,
			args.pin
		);
		if (verifyErr) return [null, verifyErr];
		const { memberId } = verified;

		const shifts = await ctx.db
			.query(TABLE.SHIFTS)
			.withIndex("by_member_time", (q) => q.eq("memberId", memberId).gte("startsAt", args.fromMs))
			.filter((q) => q.lte(q.field("startsAt"), args.toMs))
			.collect();

		return [
			shifts.map((s) => ({
				startsAt: s.startsAt,
				endsAt: s.endsAt,
				shiftRole: s.shiftRole ?? null,
				status: s.status,
			})),
			null,
		];
	},
});

export const selfClockInWithPin = mutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		employeeAccountId: v.id(TABLE.EMPLOYEE_ACCOUNTS),
		pin: v.string(),
		shiftId: v.optional(v.id(TABLE.SHIFTS)),
	},
	handler: async function (ctx, args): AsyncReturn<Id<"clockEvents">, SharedErrors> {
		const [verified, verifyErr] = await verifySharedEmployeePinStepUp(
			ctx,
			args.restaurantId,
			args.employeeAccountId,
			args.pin
		);
		if (verifyErr) return [null, verifyErr];

		const memberRow = await ctx.db.get(verified.memberId);
		if (!memberRow?.isActive) {
			return [null, new NotFoundError("Membership not found").toObject()];
		}

		const now = Date.now();
		const id = await ctx.db.insert(TABLE.CLOCK_EVENTS, {
			memberId: memberRow._id,
			restaurantId: args.restaurantId,
			type: CLOCK_EVENT_TYPE.IN,
			at: now,
			shiftId: args.shiftId,
			source: CLOCK_EVENT_SOURCE.KIOSK,
			createdAt: now,
		});

		if (args.shiftId) {
			const shift = await ctx.db.get(args.shiftId);
			if (shift) {
				const shiftId = args.shiftId;
				const lateMinutes = Math.max(0, Math.round((now - shift.startsAt) / 60_000));
				const existing = await ctx.db
					.query(TABLE.SHIFT_ATTENDANCE)
					.withIndex("by_shift", (q) => q.eq("shiftId", shiftId))
					.first();
				const patch = {
					shiftId: args.shiftId,
					restaurantId: args.restaurantId,
					memberId: memberRow._id,
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

export const selfClockOutWithPin = mutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		employeeAccountId: v.id(TABLE.EMPLOYEE_ACCOUNTS),
		pin: v.string(),
		shiftId: v.optional(v.id(TABLE.SHIFTS)),
		reason: v.optional(v.string()),
	},
	handler: async function (ctx, args): AsyncReturn<Id<"clockEvents">, SharedErrors> {
		const [verified, verifyErr] = await verifySharedEmployeePinStepUp(
			ctx,
			args.restaurantId,
			args.employeeAccountId,
			args.pin
		);
		if (verifyErr) return [null, verifyErr];

		const memberRow = await ctx.db.get(verified.memberId);
		if (!memberRow?.isActive) {
			return [null, new NotFoundError("Membership not found").toObject()];
		}

		const now = Date.now();
		const id = await ctx.db.insert(TABLE.CLOCK_EVENTS, {
			memberId: memberRow._id,
			restaurantId: args.restaurantId,
			type: CLOCK_EVENT_TYPE.OUT,
			at: now,
			shiftId: args.shiftId,
			source: CLOCK_EVENT_SOURCE.KIOSK,
			reason: args.reason,
			createdAt: now,
		});

		if (args.shiftId) {
			const shiftId = args.shiftId;
			const attendance = await ctx.db
				.query(TABLE.SHIFT_ATTENDANCE)
				.withIndex("by_shift", (q) => q.eq("shiftId", shiftId))
				.first();
			if (attendance?.memberId === memberRow._id) {
				const earlyDepartureMinutes = Math.max(
					0,
					Math.round((attendance.scheduledEnd - now) / 60_000)
				);
				await ctx.db.patch(attendance._id, {
					actualEnd: now,
					earlyDepartureMinutes,
					status:
						earlyDepartureMinutes > 0
							? ATTENDANCE_STATUS.EARLY_DEPARTURE
							: ATTENDANCE_STATUS.PRESENT,
					lastComputedAt: now,
				});
			}
		}

		return [id, null];
	},
});
