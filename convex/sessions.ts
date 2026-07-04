import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { DatabaseWriter } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { NotFoundError } from "./_shared/errors";
import { SESSION_STATUS, TABLE } from "./constants";
import { requireAuthenticatedDiner, requireOwnedActiveSession } from "./_util/dinerSession";

/**
 * Create a new session for a signed-in customer.
 * Requires Clerk authentication; binds the session to the current user.
 */
export const create = mutation({
	args: {
		restaurantSlug: v.string(),
	},
	handler: async (ctx, args) => {
		const userId = await requireAuthenticatedDiner(ctx);

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
			userId,
			status: "active",
			startedAt: now,
		});

		return { sessionId, restaurantId: restaurant._id };
	},
});

export const getActive = query({
	args: { sessionId: v.id(TABLE.SESSIONS) },
	handler: async (ctx, args) => {
		try {
			return await requireOwnedActiveSession(ctx, args.sessionId);
		} catch {
			return null;
		}
	},
});

export const close = mutation({
	args: { sessionId: v.id(TABLE.SESSIONS) },
	handler: async (ctx, args) => {
		await requireOwnedActiveSession(ctx, args.sessionId);

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
		serverMemberId?: Id<"restaurantMembers">;
		/** Set when the reservation was made by a signed-in user. */
		userId?: string;
	}
): Promise<Id<typeof TABLE.SESSIONS>> {
	return await ctx.db.insert(TABLE.SESSIONS, {
		restaurantId: args.restaurantId,
		tableId: args.tableId,
		status: SESSION_STATUS.ACTIVE,
		startedAt: Date.now(),
		...(args.serverMemberId !== undefined && { serverMemberId: args.serverMemberId }),
		...(args.userId !== undefined && { userId: args.userId }),
	});
}
