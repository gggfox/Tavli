import { extractError } from "@/global/utils/extractError";
import { Plus } from "lucide-react";
import { useState } from "react";

interface TaskFormProps {
	onAddTask: (
		text: string,
		idempotencyKey?: string
	) => Promise<{ success: boolean; value?: unknown; error?: unknown }>;
	onError: (message: string) => void;
}

export function TaskForm({ onAddTask, onError }: Readonly<TaskFormProps>) {
	const [newTaskText, setNewTaskText] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!newTaskText.trim() || isSubmitting) return;

		// Generate idempotency key to prevent duplicate task creation
		const idempotencyKey = crypto.randomUUID();
		setIsSubmitting(true);

		try {
			const result = await onAddTask(newTaskText.trim(), idempotencyKey);

			if (result.success) {
				// Clear input on success
				setNewTaskText("");
			} else {
				// Extract error message from result
				const extracted = extractError(result);
				onError(extracted?.message ?? "Failed to create task");
			}
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<form onSubmit={handleSubmit} className="px-6 pb-4 max-w-2xl mx-auto">
			<div className="flex gap-2">
				<input
					type="text"
					value={newTaskText}
					onChange={(e) => setNewTaskText(e.target.value)}
					placeholder="Add a new task..."
					className="flex-1 px-4 py-2.5 rounded-lg transition-all outline-none focus:outline-none focus-visible:outline-none"
					style={{
						backgroundColor: "var(--input-bg)",
						border: "1px solid var(--input-border)",
						color: "var(--text-primary)",
					}}
					onFocus={(e) => {
						e.currentTarget.style.borderColor = "var(--input-border)";
					}}
					onBlur={(e) => {
						e.currentTarget.style.borderColor = "var(--input-border)";
					}}
				/>
				<button
					type="submit"
					disabled={!newTaskText.trim() || isSubmitting}
					className={`px-4 py-2.5 rounded-lg transition-colors flex items-center gap-2 font-medium ${
						newTaskText.trim() && !isSubmitting
							? "hover-btn-primary cursor-pointer"
							: "cursor-not-allowed opacity-60"
					}`}
					style={{
						backgroundColor:
							newTaskText.trim() && !isSubmitting ? undefined : "var(--btn-disabled-bg)",
						color: newTaskText.trim() && !isSubmitting ? undefined : "var(--btn-disabled-text)",
					}}
				>
					<Plus size={18} />
					<span className="hidden sm:inline">Add</span>
				</button>
			</div>
		</form>
	);
}
