/**
 * TasksService - Simple service for Tasks with Zod validation
 *
 * This service provides mutation operations for tasks.
 * Query/subscription logic is handled by useTasks hook with convexQuery
 * for real-time sync via TanStack Query.
 *
 * All inputs are validated using Zod before being sent to Convex.
 */
import { api } from "convex/_generated/api";
import type { TaskDoc, TaskId } from "convex/constants";
import type { ConvexReactClient } from "convex/react";
import { TasksError, TasksValidationError } from "./errors";
import { CreateTaskInputSchema, TaskIdSchema } from "./schemas";
// ============================================================================
// Domain Types - Derived from Convex schema (single source of truth)
// ============================================================================

/**
 * Task type derived from Convex schema.
 * The Convex schema in convex/schema.ts is the single source of truth.
 */
export type Task = TaskDoc;

/**
 * Transform raw Convex task to domain Task.
 * Currently an identity function, but provides a hook for
 * future domain transformations if needed.
 */
export const transformTask = (raw: TaskDoc): Task => raw;

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Create a new task
 * @param client - Convex client
 * @param text - The task text
 * @param idempotencyKey - Optional idempotency key to prevent duplicate creation
 * @returns The ID of the newly created task
 */
export async function addTask(
	client: ConvexReactClient,
	text: string,
	idempotencyKey?: string
): Promise<TaskId> {
	// Validate input using Zod
	const validationResult = CreateTaskInputSchema.safeParse({ text, idempotencyKey });
	if (!validationResult.success) {
		throw new TasksValidationError("create", validationResult.error);
	}

	try {
		return await client.mutation(api.tasks.create, validationResult.data);
	} catch (error) {
		throw new TasksError("create", error);
	}
}

/**
 * Delete a task by ID
 */
export async function deleteTask(client: ConvexReactClient, id: TaskId): Promise<void> {
	// Validate task ID
	const validationResult = TaskIdSchema.safeParse(id);
	if (!validationResult.success) {
		throw new TasksValidationError("delete", validationResult.error);
	}

	try {
		await client.mutation(api.tasks.remove, { id });
	} catch (error) {
		throw new TasksError("delete", error);
	}
}

/**
 * Toggle task completion status
 */
export async function toggleTask(client: ConvexReactClient, id: TaskId): Promise<void> {
	// Validate task ID
	const validationResult = TaskIdSchema.safeParse(id);
	if (!validationResult.success) {
		throw new TasksValidationError("toggle", validationResult.error);
	}

	try {
		await client.mutation(api.tasks.toggle, { id });
	} catch (error) {
		throw new TasksError("toggle", error);
	}
}
