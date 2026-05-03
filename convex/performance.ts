import { v } from "convex/values";
import { query } from "./_generated/server";
import { getCurrentUserId, requireRestaurantManagerOrAbove } from "./_util/auth";
import { ORDER_PAYMENT_STATE, TABLE } from "./constants";

/**
 * Aggregates attributed orders + shift attendance hours for a restaurant window (manager dashboard).
 */
export const getRestaurantPerformance = query({
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

		const orders = await ctx.db
			.query(TABLE.ORDERS)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();

		const attendance = await ctx.db
			.query(TABLE.SHIFT_ATTENDANCE)
			.withIndex("by_restaurant_member_time", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();

		const paidOrders = orders.filter((o) => {
			const t = o.paidAt ?? o.submittedAt ?? o.createdAt;
			if (t < args.fromMs || t > args.toMs) return false;
			return o.paymentState === ORDER_PAYMENT_STATE.PAID;
		});

		const revenueByMember = new Map<string, { orders: number; revenue: number }>();
		for (const o of paidOrders) {
			if (!o.attributedMemberId) continue;
			const cur = revenueByMember.get(o.attributedMemberId) ?? { orders: 0, revenue: 0 };
			cur.orders += 1;
			cur.revenue += o.totalAmount;
			revenueByMember.set(o.attributedMemberId, cur);
		}

		const hoursByMember = new Map<string, number>();
		const attendanceSlice = attendance.filter(
			(a) => a.scheduledStart >= args.fromMs && a.scheduledStart <= args.toMs
		);
		for (const a of attendanceSlice) {
			if (!a.actualStart || !a.actualEnd) continue;
			const hrs = (a.actualEnd - a.actualStart) / 3_600_000;
			hoursByMember.set(a.memberId, (hoursByMember.get(a.memberId) ?? 0) + hrs);
		}

		const memberIds = new Set<string>([...revenueByMember.keys(), ...hoursByMember.keys()]);
		const rows = [...memberIds].map((mid) => ({
			memberId: mid,
			paidOrders: revenueByMember.get(mid)?.orders ?? 0,
			attributedRevenue: revenueByMember.get(mid)?.revenue ?? 0,
			hoursWorked: hoursByMember.get(mid) ?? 0,
		}));

		return [{ rows }, null];
	},
});
