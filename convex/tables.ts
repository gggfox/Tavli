import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
	NotAuthenticatedErrorObject,
	NotAuthorizedErrorObject,
	NotFoundError,
	NotFoundErrorObject,
	UserInputValidationError,
	UserInputValidationErrorObject,
} from "./_shared/errors";
import { AsyncReturn } from "./_shared/types";
import { getCurrentUserId, requireOwnerRole } from "./_util/auth";
import { TABLE } from "./constants";

type AuthErrors = NotAuthenticatedErrorObject | NotAuthorizedErrorObject;

export const create = mutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		tableNumber: v.number(),
		label: v.optional(v.string()),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<string, AuthErrors | UserInputValidationErrorObject | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [, error2] = await requireOwnerRole(ctx, userId);
		if (error2) return [null, error2];

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
		});

		return [args.tableId, null];
	},
});

export const remove = mutation({
	args: { tableId: v.id(TABLE.TABLES) },
	handler: async function (ctx, args): AsyncReturn<void, AuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [, error2] = await requireOwnerRole(ctx, userId);
		if (error2) return [null, error2];

		const table = await ctx.db.get(args.tableId);
		if (!table) return [null, new NotFoundError("Table not found").toObject()];

		await ctx.db.delete(args.tableId);
		return [undefined, null];
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
