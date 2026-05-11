import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
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
import { getCurrentUserId, requireOwnerOrManager } from "./_util/auth";
import { FALLBACK_TABLE_CAPACITY, TABLE } from "./constants";
import { ensureDefaultSection } from "./sections";

type AuthErrors = NotAuthenticatedErrorObject | NotAuthorizedErrorObject;

export const create = mutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		tableNumber: v.number(),
		label: v.optional(v.string()),
		capacity: v.optional(v.number()),
		sectionId: v.optional(v.id(TABLE.SECTIONS)),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<string, AuthErrors | UserInputValidationErrorObject | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const [, permErr] = await requireOwnerOrManager(ctx, userId, args.restaurantId);
		if (permErr) return [null, permErr];

		if (args.capacity !== undefined && args.capacity < 1) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "capacity", message: "Must be at least 1" }],
				}).toObject(),
			];
		}

		let sectionId: Id<"sections"> | undefined = args.sectionId;
		if (sectionId === undefined) {
			sectionId = await ensureDefaultSection(ctx, {
				restaurantId: args.restaurantId,
				userId,
			});
		} else {
			const section = await ctx.db.get(sectionId);
			if (section?.restaurantId !== args.restaurantId) {
				return [null, new NotFoundError("Section not found").toObject()];
			}
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
			sectionId,
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

		const table = await ctx.db.get(args.tableId);
		if (!table) return [null, new NotFoundError("Table not found").toObject()];

		const [, permErr] = await requireOwnerOrManager(ctx, userId, table.restaurantId);
		if (permErr) return [null, permErr];

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

		const [, permErr] = await requireOwnerOrManager(ctx, userId, args.restaurantId);
		if (permErr) return [null, permErr];

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

		const table = await ctx.db.get(args.tableId);
		if (!table) return [null, new NotFoundError("Table not found").toObject()];

		const [, permErr] = await requireOwnerOrManager(ctx, userId, table.restaurantId);
		if (permErr) return [null, permErr];

		await ctx.db.delete(args.tableId);
		return [null, null];
	},
});

export const toggleActive = mutation({
	args: { tableId: v.id(TABLE.TABLES) },
	handler: async function (ctx, args): AsyncReturn<boolean, AuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const table = await ctx.db.get(args.tableId);
		if (!table) return [null, new NotFoundError("Table not found").toObject()];

		const [, permErr] = await requireOwnerOrManager(ctx, userId, table.restaurantId);
		if (permErr) return [null, permErr];

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
