interface TableErrorStateProps {
	readonly error: Error;
	readonly entityName?: string;
	readonly onRetry?: () => void;
}

export function TableErrorState({ error, entityName = "data", onRetry }: TableErrorStateProps) {
	return (
		<div
			className="flex flex-col items-center justify-center py-12 rounded-lg"
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
