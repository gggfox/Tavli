import type { Task } from "@/features/tasks/TasksService";
import { CheckCircle2, Circle, Trash2 } from "lucide-react";

interface TaskItemProps {
	task: Task;
	onToggle: () => void;
	onDelete: () => void;
}

export function TaskItem({ task, onToggle, onDelete }: Readonly<TaskItemProps>) {
	return (
		<article
			className="group px-3 py-2.5 rounded-lg flex items-center justify-between transition-all hover:bg-(--bg-hover)"
			style={{
				color: "var(--text-primary)",
				opacity: task.isCompleted ? 0.5 : 1,
			}}
		>
			<button type="button" onClick={onToggle} className="flex items-center gap-3 flex-1 text-left">
				{task.isCompleted ? (
					<CheckCircle2 size={20} className="shrink-0" style={{ color: "var(--accent-success)" }} />
				) : (
					<Circle size={20} className="shrink-0" style={{ color: "var(--text-muted)" }} />
				)}
				<span
					className={task.isCompleted ? "line-through" : ""}
					style={{ color: task.isCompleted ? "var(--text-muted)" : "var(--text-primary)" }}
				>
					{task.text}
				</span>
			</button>
			<button
				onClick={onDelete}
				className="p-1.5 opacity-0 group-hover:opacity-100 transition-all rounded-md hover-danger"
				aria-label="Delete task"
			>
				<Trash2 size={16} />
			</button>
		</article>
	);
}
