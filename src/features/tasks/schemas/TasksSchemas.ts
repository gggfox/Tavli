/**
 * TasksSchemas - Zod validation for task operations
 *
 * Provides runtime validation for task inputs using Zod.
 * These schemas validate data before it's sent to Convex mutations.
 */
import { z } from "zod";

// ============================================================================
// Task Input Schemas
// ============================================================================

/**
 * Schema for creating a new task.
 * Validates that task text is:
 * - A non-empty string
 * - Between 1 and 500 characters
 * - Trimmed (whitespace-only strings are invalid)
 *
 * Optionally accepts an idempotencyKey to prevent duplicate task creation
 * from double-clicks or network retries.
 */
export const CreateTaskInputSchema = z.object({
	text: z
		.string()
		.min(1, "Task text cannot be empty")
		.max(500, "Task text cannot exceed 500 characters")
		.trim()
		.refine((val) => val.length > 0, "Task text cannot be only whitespace"),
	idempotencyKey: z.string().optional(),
});

/**
 * Schema for task ID validation.
 * Validates that the ID is a non-empty string (Convex ID format).
 */
export const TaskIdSchema = z.string().min(1, "Task ID cannot be empty");

// ============================================================================
// Type Inference
// ============================================================================

/**
 * Type for validated create task input
 */
export type CreateTaskInput = z.infer<typeof CreateTaskInputSchema>;
