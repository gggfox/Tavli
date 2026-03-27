import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { NotFoundError } from "./_shared/errors";
import { TABLE } from "./constants";

/**
 * Create a new session for a customer at a table.
 * Public -- no auth required. Validates restaurant and table exist.
 * Closes any existing active session for the same table.
 */
export const create = mutation({
	args: {
		restaurantSlug: v.string(),
		tableNumber: v.number(),
	},
	handler: async (ctx, args) => {
		const restaurant = await ctx.db
			.query(TABLE.RESTAURANTS)
			.withIndex("by_slug", (q) => q.eq("slug", args.restaurantSlug))
			.first();

		if (!restaurant || !restaurant.isActive) {
			throw new NotFoundError("Restaurant not found");
		}

		const table = await ctx.db
			.query(TABLE.TABLES)
			.withIndex("by_restaurant_number", (q) =>
				q.eq("restaurantId", restaurant._id).eq("tableNumber", args.tableNumber)
			)
			.first();

		if (!table || !table.isActive) {
			throw new NotFoundError("Table not found");
		}

		const activeSessions = await ctx.db
			.query(TABLE.SESSIONS)
			.withIndex("by_table_status", (q) => q.eq("tableId", table._id).eq("status", "active"))
			.collect();

		const now = Date.now();
		for (const session of activeSessions) {
			await ctx.db.patch(session._id, { status: "closed", closedAt: now });
		}

		const sessionId = await ctx.db.insert(TABLE.SESSIONS, {
			restaurantId: restaurant._id,
			tableId: table._id,
			status: "active",
			startedAt: now,
		});

		return { sessionId, restaurantId: restaurant._id, tableId: table._id };
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
