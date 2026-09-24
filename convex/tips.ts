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
import { tipFromPayment } from "./paymentMoneyHelpers";
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

		if (args.memberId) {
			const member = await ctx.db.get(args.memberId);
			if (!member || member.restaurantId !== args.restaurantId || !member.isActive) {
				return [null, new NotFoundError("Team member not found for restaurant").toObject()];
			}
		}

		if (args.shiftId) {
			const shift = await ctx.db.get(args.shiftId);
			if (!shift || shift.restaurantId !== args.restaurantId) {
				return [null, new NotFoundError("Shift not found").toObject()];
			}
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

/**
 * Card tips that were actually collected for one business date.
 *
 * **Only settled money counts**, by the same rule the tips analytics widget
 * uses (`tipFromPayment`), so the pool a manager splits and the tips total
 * they see on the dashboard agree. Every checkout attempt writes a row that
 * carries the tip while it is still pending (TAVLI-99), so a diner who moves
 * the slider and retries a declined card leaves superseded, failed and
 * cancelled rows behind, each carrying a tip nobody paid. Summing
 * `gratuityAmount` over every row put that phantom money into the pool and
 * `finalizeTipPool` then split it among staff.
 *
 * A fully refunded row contributes nothing; a partially refunded one keeps its
 * whole tip — `tipFromPayment` reports gross money in and only a FULL refund
 * disqualifies a row (see `paymentMoneyHelpers.ts`).
 *
 * Which business date a payment belongs to is unchanged:
 * - an order payment belongs to its order's `orderServiceDateKey`;
 * - a session-level row with no `orderId` (a legacy tab settlement, or an
 *   ADR 008 `kind: "tip"` row) is counted when any order in its session
 *   carries the date — once, however many of those orders match.
 *
 * **Reads only that day.** One indexed range over the day's orders, one
 * `by_order` read per order and one `by_session` read per distinct session —
 * never the restaurant's whole payment history, which grows without bound and
 * would eventually trip Convex's per-function read cap.
 */
async function sumCollectedCardTipsForDate(
	ctx: { db: import("./_generated/server").MutationCtx["db"] },
	restaurantId: Id<"restaurants">,
	businessDate: string
): Promise<number> {
	const orders = await ctx.db
		.query(TABLE.ORDERS)
		.withIndex("by_restaurant_service_date", (q) =>
			q.eq("restaurantId", restaurantId).eq("orderServiceDateKey", businessDate)
		)
		.collect();

	let total = 0;
	const sessionIds = new Set<Id<"sessions">>();
	for (const order of orders) {
		sessionIds.add(order.sessionId);
		const orderPayments = await ctx.db
			.query(TABLE.PAYMENTS)
			.withIndex("by_order", (q) => q.eq("orderId", order._id))
			.collect();
		for (const p of orderPayments) {
			if (p.restaurantId !== restaurantId) continue;
			total += tipFromPayment(p);
		}
	}

	for (const sessionId of sessionIds) {
		const sessionPayments = await ctx.db
			.query(TABLE.PAYMENTS)
			.withIndex("by_session", (q) => q.eq("sessionId", sessionId))
			.collect();
		for (const p of sessionPayments) {
			if (p.restaurantId !== restaurantId) continue;
			// A row tied to an order belongs to THAT order's date and was counted
			// (or deliberately not) above.
			if (p.orderId) continue;
			total += tipFromPayment(p);
		}
	}

	return total;
}

async function refreshPoolTotal(
	ctx: { db: import("./_generated/server").MutationCtx["db"] },
	restaurantId: Id<"restaurants">,
	businessDate: string
) {
	const digitalTips = await sumCollectedCardTipsForDate(ctx, restaurantId, businessDate);

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
	handler: async function (ctx, args): AsyncReturn<null, AuthE | UserInputValidationErrorObject> {
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
			hoursByMember.set(a.memberId, (hoursByMember.get(a.memberId) ?? 0) + hrs);
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
			restaurantId: pool.restaurantId,
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

/**
 * Aggregate tip-pool shares for a single member across a business-date range.
 *
 * Returns the per-day shares (one row per business date that has a pool and
 * a finalized share for the given member) plus the total amount in cents.
 * Drives the per-user `Propinas` section of the team-member drawer.
 *
 * Both bounds are inclusive YYYY-MM-DD strings; ordering uses lexical compare
 * (safe for the ISO date format).
 */
export const getTipSharesForMemberRange = query({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		memberId: v.id(TABLE.RESTAURANT_MEMBERS),
		fromBusinessDate: v.string(),
		toBusinessDate: v.string(),
	},
	handler: async (ctx, args) => {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];
		const [, aerr] = await requireRestaurantManagerOrAbove(ctx, userId, args.restaurantId);
		if (aerr) return [null, aerr];

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
			hoursWorked: number;
			poolStatus: string;
		}> = [];
		let totalCents = 0;

		for (const pool of pools) {
			const share = await ctx.db
				.query(TABLE.TIP_POOL_SHARES)
				.withIndex("by_pool", (q) => q.eq("poolId", pool._id))
				.filter((q) => q.eq(q.field("memberId"), args.memberId))
				.first();
			if (!share) continue;
			totalCents += share.amountCents;
			perDay.push({
				businessDate: pool.businessDate,
				amountCents: share.amountCents,
				sharePercent: share.sharePercent,
				hoursWorked: share.hoursWorked,
				poolStatus: pool.status,
			});
		}

		perDay.sort((a, b) => (a.businessDate < b.businessDate ? 1 : -1));

		return [{ totalCents, perDay }, null];
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
		const [, aerr] = await requireRestaurantManagerOrAbove(
			ctx,
			args.actingUserId,
			args.restaurantId
		);
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
