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
import { appendAuditEvent, stampUpdated } from "./_util/audit";
import { getCurrentUserId, requireRestaurantManagerOrAbove } from "./_util/auth";
import { getOrderServiceDateKey } from "./orderServiceDate";
import {
	AUDIT_SYSTEM_USER_ID,
	TABLE,
	TIP_DISTRIBUTION_RULE,
	TIP_ENTRY_SOURCE,
	TIP_POOL_STATUS,
} from "./constants";

type AuthE = NotAuthenticatedErrorObject | NotAuthorizedErrorObject | NotFoundErrorObject;

export const addTipEntry = mutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		businessDate: v.string(),
		amountCents: v.number(),
		source: v.union(v.literal(TIP_ENTRY_SOURCE.CASH), v.literal(TIP_ENTRY_SOURCE.OTHER)),
		memberId: v.optional(v.id(TABLE.RESTAURANT_MEMBERS)),
		shiftId: v.optional(v.id(TABLE.SHIFTS)),
		notes: v.optional(v.string()),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<Id<"tipEntries">, AuthE | UserInputValidationErrorObject> {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];
		const [, aerr] = await requireRestaurantManagerOrAbove(ctx, userId, args.restaurantId);
		if (aerr) return [null, aerr];
		if (args.amountCents <= 0) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "amountCents", message: "Must be positive" }],
				}).toObject(),
			];
		}

		const now = Date.now();
		const id = await ctx.db.insert(TABLE.TIP_ENTRIES, {
			restaurantId: args.restaurantId,
			memberId: args.memberId,
			shiftId: args.shiftId,
			source: args.source,
			amountCents: args.amountCents,
			enteredBy: userId,
			enteredAt: now,
			notes: args.notes,
			businessDate: args.businessDate,
			createdAt: now,
			updatedAt: now,
			updatedBy: userId,
		});

		await refreshPoolTotal(ctx, args.restaurantId, args.businessDate);

		return [id, null];
	},
});

async function refreshPoolTotal(
	ctx: { db: import("./_generated/server").MutationCtx["db"] },
	restaurantId: Id<"restaurants">,
	businessDate: string
) {
	const payments = await ctx.db
		.query(TABLE.PAYMENTS)
		.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
		.collect();

	let digitalTips = 0;
	for (const p of payments) {
		if ((p.gratuityAmount ?? 0) <= 0) continue;
		const order = await ctx.db.get(p.orderId);
		if (!order?.orderServiceDateKey || order.orderServiceDateKey !== businessDate) continue;
		digitalTips += p.gratuityAmount ?? 0;
	}

	const cashEntries = await ctx.db
		.query(TABLE.TIP_ENTRIES)
		.withIndex("by_restaurant_date", (q) =>
			q.eq("restaurantId", restaurantId).eq("businessDate", businessDate)
		)
		.collect();

	const cashTotal = cashEntries.reduce((s, e) => s + e.amountCents, 0);
	const totalAmountCents = digitalTips + cashTotal;

	const existing = await ctx.db
		.query(TABLE.TIP_POOLS)
		.withIndex("by_restaurant_date", (q) =>
			q.eq("restaurantId", restaurantId).eq("businessDate", businessDate)
		)
		.first();

	const now = Date.now();
	if (existing) {
		await ctx.db.patch(existing._id, {
			totalAmountCents,
			...stampUpdated(AUDIT_SYSTEM_USER_ID),
		});
	} else {
		await ctx.db.insert(TABLE.TIP_POOLS, {
			restaurantId,
			businessDate,
			totalAmountCents,
			distributionRule: TIP_DISTRIBUTION_RULE.EQUAL_BY_HOURS,
			status: TIP_POOL_STATUS.OPEN,
			createdBy: AUDIT_SYSTEM_USER_ID,
			createdAt: now,
			updatedAt: now,
			updatedBy: AUDIT_SYSTEM_USER_ID,
		});
	}
}

export const finalizeTipPool = mutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		businessDate: v.string(),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<null, AuthE | UserInputValidationErrorObject> {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];
		const [, aerr] = await requireRestaurantManagerOrAbove(ctx, userId, args.restaurantId);
		if (aerr) return [null, aerr];

		await refreshPoolTotal(ctx, args.restaurantId, args.businessDate);

		const pool = await ctx.db
			.query(TABLE.TIP_POOLS)
			.withIndex("by_restaurant_date", (q) =>
				q.eq("restaurantId", args.restaurantId).eq("businessDate", args.businessDate)
			)
			.first();
		if (!pool) return [null, new NotFoundError("Tip pool not found").toObject()];

		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant) return [null, new NotFoundError("Restaurant not found").toObject()];

		const attendanceRows = await ctx.db
			.query(TABLE.SHIFT_ATTENDANCE)
			.withIndex("by_restaurant_member_time", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();

		const dayAttendance = attendanceRows.filter((a) => {
			const key = getOrderServiceDateKey(
				a.scheduledStart,
				restaurant.timezone,
				restaurant.orderDayStartMinutesFromMidnight
			);
			return key === args.businessDate;
		});

		const hoursByMember = new Map<Id<"restaurantMembers">, number>();
		for (const a of dayAttendance) {
			if (!a.actualStart || !a.actualEnd) continue;
			const hrs = (a.actualEnd - a.actualStart) / 3_600_000;
			hoursByMember.set(
				a.memberId,
				(hoursByMember.get(a.memberId) ?? 0) + hrs
			);
		}

		const totalHours = [...hoursByMember.values()].reduce((s, h) => s + h, 0);
		if (totalHours <= 0) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "businessDate", message: "No recorded hours for this day" }],
				}).toObject(),
			];
		}

		const existingShares = await ctx.db
			.query(TABLE.TIP_POOL_SHARES)
			.withIndex("by_pool", (q) => q.eq("poolId", pool._id))
			.collect();
		for (const s of existingShares) await ctx.db.delete(s._id);

		const now = Date.now();
		for (const [memberId, hrs] of hoursByMember) {
			const sharePercent = hrs / totalHours;
			const amountCents = Math.round(pool.totalAmountCents * sharePercent);
			await ctx.db.insert(TABLE.TIP_POOL_SHARES, {
				poolId: pool._id,
				memberId,
				hoursWorked: hrs,
				points: 0,
				sharePercent,
				amountCents,
				createdAt: now,
				updatedAt: now,
			});
		}

		await ctx.db.patch(pool._id, {
			status: TIP_POOL_STATUS.FINALIZED,
			finalizedBy: userId,
			finalizedAt: now,
			...stampUpdated(userId),
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.TIP_POOLS,
			aggregateId: pool._id,
			eventType: "tipPools.finalized",
			payload: { businessDate: args.businessDate },
			userId,
		});

		return [null, null];
	},
});

export const getTipPoolForDate = query({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		businessDate: v.string(),
	},
	handler: async (ctx, args) => {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];
		const [, aerr] = await requireRestaurantManagerOrAbove(ctx, userId, args.restaurantId);
		if (aerr) return [null, aerr];

		const pool = await ctx.db
			.query(TABLE.TIP_POOLS)
			.withIndex("by_restaurant_date", (q) =>
				q.eq("restaurantId", args.restaurantId).eq("businessDate", args.businessDate)
			)
			.first();

		const shares = pool
			? await ctx.db
					.query(TABLE.TIP_POOL_SHARES)
					.withIndex("by_pool", (q) => q.eq("poolId", pool._id))
					.collect()
			: [];

		return [{ pool, shares }, null];
	},
});

export const internalListTipEntriesForExport = internalQuery({
	args: {
		actingUserId: v.string(),
		restaurantId: v.id(TABLE.RESTAURANTS),
		fromBusinessDate: v.optional(v.string()),
		toBusinessDate: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const [, aerr] = await requireRestaurantManagerOrAbove(ctx, args.actingUserId, args.restaurantId);
		if (aerr) throw new Error("Unauthorized");

		const rows = await ctx.db
			.query(TABLE.TIP_ENTRIES)
			.withIndex("by_restaurant_date", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();

		return rows.filter((r) => {
			if (args.fromBusinessDate && r.businessDate < args.fromBusinessDate) return false;
			if (args.toBusinessDate && r.businessDate > args.toBusinessDate) return false;
			return true;
		});
	},
});
