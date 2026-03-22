import { z } from "zod";
// ============================================================================
// Error Types
// ============================================================================

export class TasksError {
	constructor(
		readonly operation: "create" | "delete" | "toggle",
		readonly cause: unknown
	) {}
}

/**
 * Validation error for task operations.
 * Wraps Zod validation errors.
 */
export class TasksValidationError {
	constructor(
		readonly operation: "create" | "delete" | "toggle",
		readonly errors: z.ZodError
	) {}
}
