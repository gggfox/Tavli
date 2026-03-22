import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUserId } from "./_util/auth";
import { TABLE } from "./constants";

/**
 * Get all tasks for the authenticated user.
 */
export const get = query({
	args: {},
	handler: async (ctx) => {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) {
			throw error;
		}
		return await ctx.db
			.query(TABLE.TASKS)
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.collect();
	},
});

/**
 * Create a new task for the authenticated user.
 * Supports idempotency: if an idempotencyKey is provided and a task with
 * the same userId and idempotencyKey exists, returns the existing task ID.
 */
export const create = mutation({
	args: {
		text: v.string(),
		idempotencyKey: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) {
			throw error;
		}

		// Check for existing task with same idempotency key if provided
		if (args.idempotencyKey) {
			const existing = await ctx.db
				.query(TABLE.TASKS)
				.withIndex("by_idempotency", (q) =>
					q.eq("userId", userId).eq("idempotencyKey", args.idempotencyKey)
				)
				.first();

			if (existing) {
				// Return existing task ID (idempotent behavior)
				return existing._id;
			}
		}

		// Create new task
		return await ctx.db.insert(TABLE.TASKS, {
			text: args.text,
			isCompleted: false,
			userId: userId,
			idempotencyKey: args.idempotencyKey,
		});
	},
});

/**
 * Remove a task owned by the authenticated user.
 */
export const remove = mutation({
	args: {
		id: v.id(TABLE.TASKS),
	},
	handler: async (ctx, args) => {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) {
			throw error;
		}
		const task = await ctx.db.get(args.id);
		if (!task) {
			throw new Error("Task not found");
		}
		if (task.userId !== userId) {
			throw new Error("Not authorized to delete this task");
		}
		await ctx.db.delete(args.id);
	},
});

/**
 * Toggle the completion status of a task owned by the authenticated user.
 */
export const toggle = mutation({
	args: {
		id: v.id(TABLE.TASKS),
	},
	handler: async (ctx, args) => {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) {
			throw error;
		}
		const task = await ctx.db.get(args.id);
		if (!task) {
			throw new Error("Task not found");
		}
		if (task.userId !== userId) {
			throw new Error("Not authorized to modify this task");
		}
		await ctx.db.patch(args.id, {
			isCompleted: !task.isCompleted,
		});
	},
});
