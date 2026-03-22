/**
 * useTasks - Hook for tasks with Convex real-time sync
 *
 * This hook combines:
 * - Convex's real-time sync engine (via convexQuery) for queries
 * - Direct Convex mutations with Zod validation
 * - TanStack Query's caching and suspense
 * - Local computed values (counts, filters) derived from real-time data
 */
import { convexQuery } from "@convex-dev/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { TaskId } from "convex/constants";
import { useConvex } from "convex/react";
import { useCallback, useMemo } from "react";
import { addTask, deleteTask, toggleTask, transformTask, type Task } from "../TasksService";
import { TasksError } from "../errors";

// ============================================================================
// Types
// ============================================================================

/**
 * Result type for task operations
 */
export type TaskResult<T> =
	| { success: true; value: T }
	| { success: false; error: TasksError | Error };

export type UseTasksReturn = {
	tasks: readonly Task[];
	rawTasks: readonly Task[];
	getFilteredTasks: (completed: boolean) => readonly Task[];
	addTask: (text: string, idempotencyKey?: string) => Promise<TaskResult<TaskId>>;
	deleteTask: (id: TaskId) => Promise<TaskResult<void>>;
	toggleTask: (id: TaskId) => Promise<TaskResult<void>>;
	counts: {
		total: number;
		completed: number;
		pending: number;
	};
};

// Re-export TasksError for consumers
export { TasksError } from "../errors";

// ============================================================================
// useTasks Hook
// ============================================================================

/**
 * Main hook for accessing tasks
 *
 * Features:
 * - Real-time updates via Convex sync engine
 * - Type-safe mutations with Zod validation
 * - Computed values (counts, filters) derived from real-time data
 *
 * @example
 * ```tsx
 * function TaskList() {
 *   const { tasks, counts, addTask } = useTasks()
 *
 *   const handleAdd = async (text: string) => {
 *     const result = await addTask(text)
 *     if (result.success) {
 *       console.log('Created task:', result.value)
 *     } else {
 *       console.error('Failed:', result.error)
 *     }
 *   }
 *
 *   return (...)
 * }
 * ```
 */
export function useTasks(): UseTasksReturn {
	const client = useConvex();

	// Use convexQuery for real-time subscriptions
	// This maintains Convex's sync engine for live updates
	const { data: rawTasks, ...queryMeta } = useSuspenseQuery(convexQuery(api.tasks.get, {}));

	// Transform raw data to domain model
	const tasks = useMemo<readonly Task[]>(() => rawTasks.map(transformTask), [rawTasks]);

	// Computed: task counts
	const counts = useMemo(() => {
		const completed = tasks.filter((t) => t.isCompleted ?? false).length;
		return {
			total: tasks.length,
			completed,
			pending: tasks.length - completed,
		};
	}, [tasks]);

	// Filter tasks by completion status
	const getFilteredTasks = useCallback(
		(completed: boolean) => tasks.filter((t) => (t.isCompleted ?? false) === completed),
		[tasks]
	);

	// Add a new task
	const handleAddTask = useCallback(
		async (text: string, idempotencyKey?: string): Promise<TaskResult<TaskId>> => {
			try {
				const value = await addTask(client, text, idempotencyKey);
				return { success: true, value };
			} catch (error) {
				return { success: false, error: error instanceof Error ? error : new Error(String(error)) };
			}
		},
		[client]
	);

	// Delete a task
	const handleDeleteTask = useCallback(
		async (id: TaskId): Promise<TaskResult<void>> => {
			try {
				await deleteTask(client, id);
				return { success: true, value: undefined };
			} catch (error) {
				return { success: false, error: error instanceof Error ? error : new Error(String(error)) };
			}
		},
		[client]
	);

	// Toggle task completion
	const handleToggleTask = useCallback(
		async (id: TaskId): Promise<TaskResult<void>> => {
			try {
				await toggleTask(client, id);
				return { success: true, value: undefined };
			} catch (error) {
				return { success: false, error: error instanceof Error ? error : new Error(String(error)) };
			}
		},
		[client]
	);

	return {
		// Query metadata first (so our properties override)
		...queryMeta,

		// Real-time data
		tasks,
		rawTasks,

		// Computed values
		counts,

		// Helpers
		getFilteredTasks,

		// Mutations
		addTask: handleAddTask,
		deleteTask: handleDeleteTask,
		toggleTask: handleToggleTask,
	};
}
