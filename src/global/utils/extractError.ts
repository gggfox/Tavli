/**
 * Extract error message and operation from result objects.
 * Handles TasksError (with operation and cause) and regular Error objects.
 */

type TaskOperationType = "create" | "delete" | "toggle";

export interface ExtractedError {
	message: string;
	operation?: TaskOperationType;
}

/**
 * Check if an error is a TasksError-like object (has operation and cause properties).
 */
function isTasksError(error: unknown): error is { operation: TaskOperationType; cause: unknown } {
	return (
		error !== null &&
		typeof error === "object" &&
		"operation" in error &&
		"cause" in error &&
		typeof (error as { operation: unknown }).operation === "string"
	);
}

/**
 * Extract error message from various error formats.
 */
function getErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	if (typeof error === "string") {
		return error;
	}
	if (error && typeof error === "object" && "message" in error) {
		return String((error as { message: unknown }).message);
	}
	return "An unknown error occurred";
}

/**
 * Extract error from a result object.
 * Returns null if the result is successful or if no error can be extracted.
 */
export function extractError(result: {
	success: boolean;
	value?: unknown;
	error?: unknown;
}): ExtractedError | null {
	if (result.success) {
		return null;
	}

	// Handle error property
	if ("error" in result && result.error !== undefined) {
		const error = result.error;

		// Handle TasksError (has operation and cause)
		if (isTasksError(error)) {
			return {
				message: getErrorMessage(error.cause),
				operation: error.operation,
			};
		}

		// Handle regular Error objects
		const message = getErrorMessage(error);
		if (message) {
			return { message };
		}
	}

	return null;
}
