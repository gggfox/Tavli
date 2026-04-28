import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { DatabaseWriter } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { NotFoundError } from "./_shared/errors";
import { SESSION_STATUS, TABLE } from "./constants";

/**
 * Create a new session for a customer.
 * Public -- no auth required. Validates restaurant exists.
 * Table is assigned later at order creation time.
 */
export const create = mutation({
	args: {
		restaurantSlug: v.string(),
	},
	handler: async (ctx, args) => {
		const restaurant = await ctx.db
			.query(TABLE.RESTAURANTS)
			.withIndex("by_slug", (q) => q.eq("slug", args.restaurantSlug))
			.first();

		if (!restaurant || !restaurant.isActive) {
			throw new NotFoundError("Restaurant not found");
		}

		const now = Date.now();

		const sessionId = await ctx.db.insert(TABLE.SESSIONS, {
			restaurantId: restaurant._id,
			status: "active",
			startedAt: now,
		});

		return { sessionId, restaurantId: restaurant._id };
	},
});

export const getActive = query({
	args: { sessionId: v.id(TABLE.SESSIONS) },
	handler: async (ctx, args) => {
		const session = await ctx.db.get(args.sessionId);
		if (!session || session.status !== "active") return null;
		return session;
	},
});

export const close = mutation({
	args: { sessionId: v.id(TABLE.SESSIONS) },
	handler: async (ctx, args) => {
		const session = await ctx.db.get(args.sessionId);
		if (!session) throw new NotFoundError("Session not found");

		await ctx.db.patch(args.sessionId, {
			status: "closed",
			closedAt: Date.now(),
		});
	},
});

/**
 * Helper used by `reservations.markSeated`. Creates an active session pinned
 * to a table at "now", in the same Convex transaction as the reservation
 * status flip, so the existing ordering flow is reachable the moment the
 * guest sits down. Not exposed as a public mutation -- callers must already
 * have authorized the staff action.
 */
export async function createSessionForReservation(
	ctx: { db: DatabaseWriter },
	args: {
		restaurantId: Id<typeof TABLE.RESTAURANTS>;
		tableId: Id<typeof TABLE.TABLES>;
	}
): Promise<Id<typeof TABLE.SESSIONS>> {
	return await ctx.db.insert(TABLE.SESSIONS, {
		restaurantId: args.restaurantId,
		tableId: args.tableId,
		status: SESSION_STATUS.ACTIVE,
		startedAt: Date.now(),
	});
}
