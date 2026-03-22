import { ErrorAlert, type TaskOperationError } from "@/features/tasks/components/ErrorAlert.tsx";
import { TaskForm } from "@/features/tasks/components/TaskForm.tsx";
import { TaskList } from "@/features/tasks/components/TaskList.tsx";
import { TaskSummary } from "@/features/tasks/components/TaskSummary.tsx";
import { useTasks } from "@/features/tasks/hooks";
import { subscribeToSimulatedErrors } from "@/features/tasks/stores";
import { extractError } from "@/global/utils/extractError";
import type { TaskId } from "convex/constants";
import { useCallback, useEffect, useState } from "react";

/**
 * Authenticated tasks section - only rendered when user is logged in.
 * Manages error state from result types.
 */
export function AuthenticatedTasks() {
	const { tasks, counts, addTask, deleteTask, toggleTask } = useTasks();
	const [error, setError] = useState<TaskOperationError | null>(null);

	const clearError = useCallback(() => setError(null), []);

	// Subscribe to simulated errors from debug panel
	useEffect(() => {
		return subscribeToSimulatedErrors((simulatedError) => {
			setError({
				message: simulatedError.message,
				operation: simulatedError.operation,
			});
		});
	}, []);

	// Handle errors from result failures using shared utility
	const handleResultError = useCallback(
		<T,>(result: { success: true; value: T } | { success: false; error: unknown }): boolean => {
			if (result.success) return true;

			const extracted = extractError(result);
			if (extracted) {
				setError({
					message: extracted.message,
					operation: extracted.operation,
				});
			}
			return false;
		},
		[]
	);

	// Wrapped handlers that process result and set error state
	const handleDelete = useCallback(
		async (id: TaskId) => {
			setError(null);
			const result = await deleteTask(id);
			handleResultError(result);
		},
		[deleteTask, handleResultError]
	);

	const handleToggle = useCallback(
		async (id: TaskId) => {
			setError(null);
			const result = await toggleTask(id);
			handleResultError(result);
		},
		[toggleTask, handleResultError]
	);

	const handleAddError = useCallback((message: string) => {
		setError({ message, operation: "create" });
	}, []);

	return (
		<div className="h-full flex flex-col overflow-hidden">
			<div className="shrink-0">
				<TaskSummary counts={counts} />
				<ErrorAlert error={error} onDismiss={clearError} />
				<TaskForm onAddTask={addTask} onError={handleAddError} />
			</div>
			<TaskList tasks={tasks} onToggle={handleToggle} onDelete={handleDelete} />
		</div>
	);
}
