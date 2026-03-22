import type { UseTasksReturn } from "@/features/tasks/hooks/useTasks";

export function TaskSummary({ counts }: Readonly<Pick<UseTasksReturn, "counts">>) {
	const completionPercent =
		counts.total > 0 ? Math.round((counts.completed / counts.total) * 100) : 0;

	return (
		<div className="px-6 py-6">
			<div className="max-w-2xl mx-auto">
				<div className="flex items-center justify-between mb-2">
					<h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
						Tasks
					</h1>
					<div className="flex items-center gap-4 text-sm">
						<span style={{ color: "var(--text-tertiary)" }}>
							<span className="font-medium" style={{ color: "var(--accent-success)" }}>
								{counts.completed}
							</span>
							/{counts.total}
						</span>
						<span style={{ color: "var(--text-tertiary)" }}>{completionPercent}%</span>
					</div>
				</div>
				{counts.total > 0 && (
					<div
						className="h-1 rounded-full overflow-hidden"
						style={{ backgroundColor: "var(--bg-tertiary)" }}
					>
						<div
							className="h-full transition-all duration-300"
							style={{
								width: `${completionPercent}%`,
								backgroundColor: "var(--accent-success)",
							}}
						/>
					</div>
				)}
			</div>
		</div>
	);
}
