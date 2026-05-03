import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
	NotAuthenticatedErrorObject,
	NotAuthorizedError,
	NotAuthorizedErrorObject,
	NotFoundError,
	NotFoundErrorObject,
	UserInputValidationError,
	UserInputValidationErrorObject,
} from "./_shared/errors";
import { AsyncReturn } from "./_shared/types";
import { getCurrentUserId, isAdmin, requireOwnerRole, RoleErrorMessages } from "./_util/auth";
import { FALLBACK_TABLE_CAPACITY, TABLE } from "./constants";

type AuthErrors = NotAuthenticatedErrorObject | NotAuthorizedErrorObject;

export const create = mutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		tableNumber: v.number(),
		label: v.optional(v.string()),
		capacity: v.optional(v.number()),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<string, AuthErrors | UserInputValidationErrorObject | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [, error2] = await requireOwnerRole(ctx, userId);
		if (error2) return [null, error2];

		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant) return [null, new NotFoundError("Restaurant not found").toObject()];
		const userIsAdmin = await isAdmin(ctx, userId);
		if (!userIsAdmin && restaurant.ownerId !== userId) {
			return [null, new NotAuthorizedError(RoleErrorMessages.INSUFFICIENT_PERMISSIONS).toObject()];
		}

		if (args.capacity !== undefined && args.capacity < 1) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "capacity", message: "Must be at least 1" }],
				}).toObject(),
			];
		}

		const existing = await ctx.db
			.query(TABLE.TABLES)
			.withIndex("by_restaurant_number", (q) =>
				q.eq("restaurantId", args.restaurantId).eq("tableNumber", args.tableNumber)
			)
			.first();

		if (existing) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "tableNumber", message: "Table number already exists" }],
				}).toObject(),
			];
		}

		const id = await ctx.db.insert(TABLE.TABLES, {
			restaurantId: args.restaurantId,
			tableNumber: args.tableNumber,
			label: args.label,
			capacity: args.capacity,
			isActive: true,
			createdAt: Date.now(),
		});

		return [id, null];
	},
});

export const update = mutation({
	args: {
		tableId: v.id(TABLE.TABLES),
		label: v.optional(v.string()),
		tableNumber: v.optional(v.number()),
		capacity: v.optional(v.number()),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<string, AuthErrors | NotFoundErrorObject | UserInputValidationErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [, error2] = await requireOwnerRole(ctx, userId);
		if (error2) return [null, error2];

		const table = await ctx.db.get(args.tableId);
		if (!table) return [null, new NotFoundError("Table not found").toObject()];

		const restaurant = await ctx.db.get(table.restaurantId);
		const userIsAdmin = await isAdmin(ctx, userId);
		if (!userIsAdmin && restaurant?.ownerId !== userId) {
			return [null, new NotAuthorizedError(RoleErrorMessages.INSUFFICIENT_PERMISSIONS).toObject()];
		}

		if (args.capacity !== undefined && args.capacity < 1) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "capacity", message: "Must be at least 1" }],
				}).toObject(),
			];
		}

		if (args.tableNumber !== undefined && args.tableNumber !== table.tableNumber) {
			const existing = await ctx.db
				.query(TABLE.TABLES)
				.withIndex("by_restaurant_number", (q) =>
					q.eq("restaurantId", table.restaurantId).eq("tableNumber", args.tableNumber!)
				)
				.first();
			if (existing) {
				return [
					null,
					new UserInputValidationError({
						fields: [{ field: "tableNumber", message: "Table number already exists" }],
					}).toObject(),
				];
			}
		}

		await ctx.db.patch(args.tableId, {
			...(args.label !== undefined && { label: args.label }),
			...(args.tableNumber !== undefined && { tableNumber: args.tableNumber }),
			...(args.capacity !== undefined && { capacity: args.capacity }),
		});

		return [args.tableId, null];
	},
});

/**
 * One-shot admin-only backfill for the `capacity` field. Sets `capacity` on
 * any row where it's missing to the provided default. Owners can run this
 * once after the rollout; safe to re-run (no-op for rows that already have
 * a capacity).
 */
export const backfillCapacity = mutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		defaultCapacity: v.optional(v.number()),
	},
	handler: async function (ctx, args): AsyncReturn<{ updated: number }, AuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [, error2] = await requireOwnerRole(ctx, userId);
		if (error2) return [null, error2];

		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant) return [null, new NotFoundError("Restaurant not found").toObject()];

		const userIsAdmin = await isAdmin(ctx, userId);
		if (!userIsAdmin && restaurant.ownerId !== userId) {
			return [null, new NotAuthorizedError(RoleErrorMessages.INSUFFICIENT_PERMISSIONS).toObject()];
		}

		const tables = await ctx.db
			.query(TABLE.TABLES)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();
		const fillTo = args.defaultCapacity ?? FALLBACK_TABLE_CAPACITY;
		let updated = 0;
		for (const t of tables) {
			if (t.capacity === undefined) {
				await ctx.db.patch(t._id, { capacity: fillTo });
				updated++;
			}
		}
		return [{ updated }, null];
	},
});

export const remove = mutation({
	args: { tableId: v.id(TABLE.TABLES) },
	handler: async function (ctx, args): AsyncReturn<null, AuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [, error2] = await requireOwnerRole(ctx, userId);
		if (error2) return [null, error2];

		const table = await ctx.db.get(args.tableId);
		if (!table) return [null, new NotFoundError("Table not found").toObject()];

		const restaurant = await ctx.db.get(table.restaurantId);
		const userIsAdmin = await isAdmin(ctx, userId);
		if (!userIsAdmin && restaurant?.ownerId !== userId) {
			return [null, new NotAuthorizedError(RoleErrorMessages.INSUFFICIENT_PERMISSIONS).toObject()];
		}

		await ctx.db.delete(args.tableId);
		return [null, null];
	},
});

export const toggleActive = mutation({
	args: { tableId: v.id(TABLE.TABLES) },
	handler: async function (ctx, args): AsyncReturn<boolean, AuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [, error2] = await requireOwnerRole(ctx, userId);
		if (error2) return [null, error2];

		const table = await ctx.db.get(args.tableId);
		if (!table) return [null, new NotFoundError("Table not found").toObject()];

		const restaurant = await ctx.db.get(table.restaurantId);
		const userIsAdmin = await isAdmin(ctx, userId);
		if (!userIsAdmin && restaurant?.ownerId !== userId) {
			return [null, new NotAuthorizedError(RoleErrorMessages.INSUFFICIENT_PERMISSIONS).toObject()];
		}

		const newState = !table.isActive;
		await ctx.db.patch(args.tableId, { isActive: newState });
		return [newState, null];
	},
});

export const getByRestaurant = query({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async (ctx, args) => {
		return await ctx.db
			.query(TABLE.TABLES)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();
	},
});

export const getActiveByRestaurant = query({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async (ctx, args) => {
		const tables = await ctx.db
			.query(TABLE.TABLES)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();
		return tables.filter((t) => t.isActive);
	},
});
