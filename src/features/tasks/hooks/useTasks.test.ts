import { act, renderHook } from "@testing-library/react";
import type { Id } from "convex/_generated/dataModel";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { addTask, deleteTask, toggleTask } from "../TasksService";
import { TasksError, TasksValidationError } from "../errors";
import { useTasks } from "./useTasks";

// Mock TasksService
vi.mock("../services/TasksService", async () => {
	const actual = await vi.importActual("../services/TasksService");
	return {
		...actual,
		addTask: vi.fn(),
		deleteTask: vi.fn(),
		toggleTask: vi.fn(),
		transformTask: vi.fn((task) => task),
	};
});

// Mock Convex client
const mockConvexClient = {
	mutation: vi.fn(),
	query: vi.fn(),
};

vi.mock("convex/react", () => ({
	useConvex: () => mockConvexClient,
}));

// Mock TanStack Query with Convex
const mockTasksData = [
	{
		_id: "task1",
		text: "Test task 1",
		isCompleted: false,
		userId: "user1",
		_creationTime: Date.now(),
	},
	{
		_id: "task2",
		text: "Test task 2",
		isCompleted: true,
		userId: "user1",
		_creationTime: Date.now(),
	},
	{
		_id: "task3",
		text: "Test task 3",
		isCompleted: false,
		userId: "user1",
		_creationTime: Date.now(),
	},
];

vi.mock("@tanstack/react-query", () => ({
	useSuspenseQuery: vi.fn(() => ({
		data: mockTasksData,
		isLoading: false,
		isError: false,
		error: null,
	})),
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: vi.fn((api, args) => ({ queryKey: ["convex", api, args] })),
}));

vi.mock("convex/_generated/api", () => ({
	api: {
		tasks: {
			get: "api.tasks.get",
			create: "api.tasks.create",
			remove: "api.tasks.remove",
			toggle: "api.tasks.toggle",
		},
	},
}));

describe("useTasks", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(addTask).mockReset();
		vi.mocked(deleteTask).mockReset();
		vi.mocked(toggleTask).mockReset();
	});

	describe("initial state", () => {
		it("returns tasks transformed from raw data", () => {
			const { result } = renderHook(() => useTasks());

			expect(result.current.tasks).toHaveLength(3);
			expect(result.current.tasks[0]).toMatchObject({
				_id: "task1",
				text: "Test task 1",
				isCompleted: false,
			});
		});

		it("computes task counts correctly", () => {
			const { result } = renderHook(() => useTasks());

			expect(result.current.counts).toEqual({
				total: 3,
				completed: 1,
				pending: 2,
			});
		});
	});

	describe("addTask mutation (Result-based)", () => {
		it("returns success result with task id on successful creation", async () => {
			vi.mocked(addTask).mockResolvedValue("new-task-id" as Id<"tasks">);

			const { result } = renderHook(() => useTasks());

			let taskResult;
			await act(async () => {
				taskResult = await result.current.addTask("New task");
			});

			expect(taskResult!.success).toBe(true);
			if (taskResult!.success) {
				expect(taskResult!.value).toBe("new-task-id");
			}
		});

		it("returns failure result with TasksError on create failure", async () => {
			const cause = new Error("Network error");
			vi.mocked(addTask).mockRejectedValue(new TasksError("create", cause));

			const { result } = renderHook(() => useTasks());

			let taskResult;
			await act(async () => {
				taskResult = await result.current.addTask("New task");
			});

			expect(taskResult!.success).toBe(false);
			if (!taskResult!.success) {
				expect(taskResult!.error).toBeInstanceOf(TasksError);
				if (taskResult!.error instanceof TasksError) {
					expect(taskResult!.error.operation).toBe("create");
					expect(taskResult!.error.cause).toBe(cause);
				}
			}
		});

		it("returns failure result with TasksValidationError on validation failure", async () => {
			const zodError = new z.ZodError([]);
			vi.mocked(addTask).mockRejectedValue(new TasksValidationError("create", zodError));

			const { result } = renderHook(() => useTasks());

			let taskResult;
			await act(async () => {
				taskResult = await result.current.addTask("New task");
			});

			expect(taskResult!.success).toBe(false);
			if (!taskResult!.success) {
				expect(taskResult!.error).toBeInstanceOf(TasksValidationError);
				if (taskResult!.error instanceof TasksValidationError) {
					expect(taskResult!.error.operation).toBe("create");
				}
			}
		});

		it("preserves auth error cause for consumer handling", async () => {
			const authError = new Error("Not authenticated");
			vi.mocked(addTask).mockRejectedValue(new TasksError("create", authError));

			const { result } = renderHook(() => useTasks());

			let taskResult;
			await act(async () => {
				taskResult = await result.current.addTask("New task");
			});

			expect(taskResult!.success).toBe(false);
			if (!taskResult!.success) {
				expect(taskResult!.error).toBeInstanceOf(TasksError);
				if (taskResult!.error instanceof TasksError) {
					expect((taskResult!.error.cause as Error).message).toBe("Not authenticated");
				}
			}
		});
	});

	describe("deleteTask mutation (Result-based)", () => {
		it("returns success result on successful deletion", async () => {
			vi.mocked(deleteTask).mockResolvedValue(undefined);

			const { result } = renderHook(() => useTasks());

			let taskResult;
			await act(async () => {
				taskResult = await result.current.deleteTask("task1" as Id<"tasks">);
			});

			expect(taskResult!.success).toBe(true);
		});

		it("returns failure result with TasksError on delete failure", async () => {
			vi.mocked(deleteTask).mockRejectedValue(new TasksError("delete", new Error("Delete failed")));

			const { result } = renderHook(() => useTasks());

			let taskResult;
			await act(async () => {
				taskResult = await result.current.deleteTask("task1" as Id<"tasks">);
			});

			expect(taskResult!.success).toBe(false);
			if (!taskResult!.success) {
				expect(taskResult!.error).toBeInstanceOf(TasksError);
				if (taskResult!.error instanceof TasksError) {
					expect(taskResult!.error.operation).toBe("delete");
				}
			}
		});

		it("preserves not found error cause for consumer handling", async () => {
			const notFoundError = new Error("Task not found");
			vi.mocked(deleteTask).mockRejectedValue(new TasksError("delete", notFoundError));

			const { result } = renderHook(() => useTasks());

			let taskResult;
			await act(async () => {
				taskResult = await result.current.deleteTask("missing-task" as Id<"tasks">);
			});

			expect(taskResult!.success).toBe(false);
			if (!taskResult!.success) {
				expect(taskResult!.error).toBeInstanceOf(TasksError);
				if (taskResult!.error instanceof TasksError) {
					expect((taskResult!.error.cause as Error).message).toBe("Task not found");
				}
			}
		});
	});

	describe("toggleTask mutation (Result-based)", () => {
		it("returns success result on successful toggle", async () => {
			vi.mocked(toggleTask).mockResolvedValue(undefined);

			const { result } = renderHook(() => useTasks());

			let taskResult;
			await act(async () => {
				taskResult = await result.current.toggleTask("task1" as Id<"tasks">);
			});

			expect(taskResult!.success).toBe(true);
		});

		it("returns failure result with TasksError on toggle failure", async () => {
			vi.mocked(toggleTask).mockRejectedValue(new TasksError("toggle", new Error("Toggle failed")));

			const { result } = renderHook(() => useTasks());

			let taskResult;
			await act(async () => {
				taskResult = await result.current.toggleTask("task1" as Id<"tasks">);
			});

			expect(taskResult!.success).toBe(false);
			if (!taskResult!.success) {
				expect(taskResult!.error).toBeInstanceOf(TasksError);
				if (taskResult!.error instanceof TasksError) {
					expect(taskResult!.error.operation).toBe("toggle");
				}
			}
		});

		it("preserves unauthorized error cause for consumer handling", async () => {
			const authError = new Error("Unauthorized");
			vi.mocked(toggleTask).mockRejectedValue(new TasksError("toggle", authError));

			const { result } = renderHook(() => useTasks());

			let taskResult;
			await act(async () => {
				taskResult = await result.current.toggleTask("task1" as Id<"tasks">);
			});

			expect(taskResult!.success).toBe(false);
			if (!taskResult!.success) {
				expect(taskResult!.error).toBeInstanceOf(TasksError);
				if (taskResult!.error instanceof TasksError) {
					expect((taskResult!.error.cause as Error).message).toBe("Unauthorized");
				}
			}
		});
	});

	describe("getFilteredTasks", () => {
		it("filters completed tasks", () => {
			const { result } = renderHook(() => useTasks());

			const completedTasks = result.current.getFilteredTasks(true);

			expect(completedTasks).toHaveLength(1);
			expect(completedTasks[0].isCompleted).toBe(true);
		});

		it("filters pending tasks", () => {
			const { result } = renderHook(() => useTasks());

			const pendingTasks = result.current.getFilteredTasks(false);

			expect(pendingTasks).toHaveLength(2);
			expect(pendingTasks.every((t) => t.isCompleted === false)).toBe(true);
		});
	});
});
