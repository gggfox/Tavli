/**
 * `serverPerformance` widget query: ranks Servers by attributed **sales** over
 * the window, with order count and average check as secondary stats —
 * answering "who is selling the most?".
 *
 * Sales are credited via `orders.attributedMemberId` (the Server credited at
 * payment confirmation; see `CONTEXT.md` — the ticket's "waiter" is canonically
 * a **Server**). Cancelled and unattributed orders are skipped. A Server's
 * display name is resolved from the `RestaurantMember`'s backing identity —
 * either a `User` (`userRoles`) or an `EmployeeAccount` (XOR, ADR 006).
 *
 * Single-restaurant; **manager-or-above** (staff-performance data).
 */
import { v } from "convex/values";
import { query } from "../_generated/server";
import { AsyncReturn } from "../_shared/types";
import { UserInputValidationErrorObject } from "../_shared/errors";
import { ORDER_STATUS, TABLE } from "../constants";
import type { Id } from "../_generated/dataModel";
import {
	buildWindow,
	loadOrdersInRange,
	resolveRestaurantIds,
	type AnalyticsAccessErrors,
	type AnalyticsCtx,
} from "./_shared";

const SERVER_PERFORMANCE_MAX_RANGE_DAYS = 366;

export type ServerPerformanceRow = {
	memberId: string;
	name: string;
	sales: number;
	orders: number;
	avgCheck: number;
};

type Errors = AnalyticsAccessErrors | UserInputValidationErrorObject;

export const compute = query({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		range: v.object({ from: v.number(), to: v.number() }),
	},
	handler: async function (ctx, args): AsyncReturn<ServerPerformanceRow[], Errors> {
		const [restaurantIds, accessErr] = await resolveRestaurantIds(ctx, {
			scopeKind: "restaurant",
			restaurantId: args.restaurantId,
			requireManagerOrAbove: true,
		});
		if (accessErr) return [null, accessErr];

		const [windowResult, rangeErr] = buildWindow(
			args.range,
			false,
			SERVER_PERFORMANCE_MAX_RANGE_DAYS
		);
		if (rangeErr) return [null, rangeErr];

		const orders = await loadOrdersInRange(ctx, restaurantIds, windowResult.current);

		const tally = new Map<string, { sales: number; orders: number }>();
		for (const o of orders) {
			if (o.status === ORDER_STATUS.CANCELLED) continue;
			if (!o.attributedMemberId) continue;
			const key = o.attributedMemberId as string;
			const cur = tally.get(key) ?? { sales: 0, orders: 0 };
			cur.sales += o.totalAmount;
			cur.orders += 1;
			tally.set(key, cur);
		}

		const rows: ServerPerformanceRow[] = [];
		for (const [memberId, agg] of tally) {
			const name = await resolveMemberName(ctx, memberId as Id<"restaurantMembers">);
			rows.push({
				memberId,
				name,
				sales: agg.sales,
				orders: agg.orders,
				avgCheck: agg.orders > 0 ? agg.sales / agg.orders : 0,
			});
		}
		rows.sort((a, b) => b.sales - a.sales);

		return [rows, null];
	},
});

/** Resolves a `RestaurantMember`'s display name from its backing identity. */
async function resolveMemberName(
	ctx: AnalyticsCtx,
	memberId: Id<"restaurantMembers">
): Promise<string> {
	const member = await ctx.db.get(memberId);
	if (!member) return "—";

	if (member.userId) {
		const userId = member.userId;
		const userRole = await ctx.db
			.query(TABLE.USER_ROLES)
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.first();
		return formatName(userRole?.firstName, userRole?.paternalLastname);
	}

	if (member.employeeAccountId) {
		const account = await ctx.db.get(member.employeeAccountId);
		return formatName(account?.firstName, account?.paternalLastname);
	}

	return "—";
}

function formatName(first: string | undefined, paternal: string | undefined): string {
	const parts = [first, paternal].filter((p): p is string => Boolean(p));
	return parts.length > 0 ? parts.join(" ") : "—";
}
