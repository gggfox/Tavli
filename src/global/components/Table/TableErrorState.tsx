interface TableErrorStateProps {
	readonly error: Error;
	readonly entityName?: string;
	readonly onRetry?: () => void;
	/**
	 * When true, the error card grows to fill the remaining vertical space of
	 * its parent. The parent must be a flex column with a defined or
	 * `min-h-full` height for this to take effect.
	 */
	readonly fill?: boolean;
}

export function TableErrorState({
	error,
	entityName = "data",
	onRetry,
	fill = false,
}: TableErrorStateProps) {
	const sizing = fill ? "flex-1 self-stretch min-h-0 py-12" : "py-12";
	return (
		<div
			className={`flex flex-col items-center justify-center rounded-lg ${sizing}`}
			style={{ backgroundColor: "var(--accent-danger-bg, rgba(239, 68, 68, 0.1))" }}
		>
			<p className="text-lg font-medium" style={{ color: "var(--accent-danger, #e53e3e)" }}>
				Error loading {entityName}
			</p>
			<p className="text-sm mt-1 text-center max-w-md" style={{ color: "var(--text-secondary)" }}>
				{error.message}
			</p>
			{onRetry && (
				<button
					onClick={onRetry}
					className="mt-4 px-4 py-2 rounded-lg text-sm transition-colors"
					style={{
						backgroundColor: "var(--bg-secondary)",
						color: "var(--text-primary)",
						border: "1px solid var(--border-default)",
					}}
				>
					Retry
				</button>
			)}
		</div>
	);
}
