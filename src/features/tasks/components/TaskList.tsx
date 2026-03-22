import type { Task } from "@/features/tasks/TasksService";
import type { TaskId } from "convex/constants";
import { ClipboardList } from "lucide-react";
import { TaskItem } from "./TaskItem";

interface TaskListProps {
	tasks: readonly Task[];
	onToggle: (id: TaskId) => void;
	onDelete: (id: TaskId) => void;
}

export function TaskList({ tasks, onToggle, onDelete }: Readonly<TaskListProps>) {
	return (
		<div className="flex-1 overflow-hidden">
			<div className="h-full overflow-y-auto px-6 py-2">
				<div className="max-w-2xl mx-auto">
					{tasks.length === 0 ? (
						<div className="text-center py-12">
							<ClipboardList
								size={48}
								className="mx-auto mb-4"
								style={{ color: "var(--text-muted)" }}
							/>
							<p style={{ color: "var(--text-tertiary)" }}>No tasks yet. Add one above!</p>
						</div>
					) : (
						<div className="space-y-1">
							{tasks.map((task) => (
								<TaskItem
									key={task._id}
									task={task}
									onToggle={() => onToggle(task._id)}
									onDelete={() => onDelete(task._id)}
								/>
							))}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
