import { X } from "lucide-react";
import type { TaskOperationType } from "../stores/TasksDebugStore";

export interface TaskOperationError {
	message: string;
	operation?: TaskOperationType;
}

interface ErrorAlertProps {
	error: TaskOperationError | null;
	onDismiss: () => void;
}

/**
 * Inline error alert for displaying task operation errors
 */
export function ErrorAlert({ error, onDismiss }: Readonly<ErrorAlertProps>) {
	if (!error) return <div className="px-6 max-w-2xl mx-auto"></div>;
	return (
		<div className="px-6 max-w-2xl mx-auto">
			<div
				role="alert"
				className="flex items-center justify-between gap-3 px-4 py-3 mb-4 rounded-lg animate-in fade-in slide-in-from-top-1 duration-200"
				style={{
					backgroundColor: "var(--accent-danger-light)",
					border: "1px solid var(--accent-danger)",
					color: "var(--accent-danger)",
				}}
			>
				<div className="flex items-center gap-3">
					<svg
						className="w-5 h-5 shrink-0"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						aria-hidden="true"
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={2}
							d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
						/>
					</svg>
					<span className="text-sm">{error.message}</span>
				</div>
				<button
					type="button"
					onClick={onDismiss}
					className="p-1 focus:outline-none focus:ring-2 rounded hover-opacity"
					style={{ color: "var(--accent-danger)" }}
					aria-label="Dismiss error"
				>
					<X className="w-4 h-4" />
				</button>
			</div>
		</div>
	);
}
