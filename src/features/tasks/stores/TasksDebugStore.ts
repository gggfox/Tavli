/**
 * Simple store for tasks debug functionality
 *
 * This uses a pub/sub pattern to allow the debug panel to trigger
 * simulated errors in the AuthenticatedTasks component.
 */

// Re-export for backward compatibility
export type TaskOperationType = "create" | "delete" | "toggle";

interface SimulatedError {
	operation: TaskOperationType;
	message: string;
}

type ErrorSubscriber = (error: SimulatedError) => void;

let subscriber: ErrorSubscriber | null = null;

/**
 * Subscribe to simulated errors from the debug panel
 * Only one subscriber is allowed (the AuthenticatedTasks component)
 */
export function subscribeToSimulatedErrors(callback: ErrorSubscriber): () => void {
	subscriber = callback;
	return () => {
		subscriber = null;
	};
}

/**
 * Trigger a simulated error (called from debug panel)
 */
export function simulateTaskError(operation: TaskOperationType, message?: string): void {
	const errorMessage = message ?? getDefaultErrorMessage(operation);
	subscriber?.({ operation, message: errorMessage });
}

function getDefaultErrorMessage(operation: TaskOperationType): string {
	const messages: Record<TaskOperationType, string> = {
		create: "Failed to create task (simulated)",
		delete: "Failed to delete task (simulated)",
		toggle: "Failed to update task (simulated)",
	};
	return messages[operation];
}
