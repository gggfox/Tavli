import { Trash2 } from "lucide-react";
import type { ClearResults } from "./types.ts";

export function ClearResultsDisplay({ results }: Readonly<{ results: ClearResults }>) {
	const totalDeleted = Object.values(results).reduce((sum, count) => sum + count, 0);

	return (
		<div
			className="mt-4 p-4 rounded-lg border"
			style={{
				backgroundColor: "rgba(239, 68, 68, 0.1)",
				borderColor: "rgb(239, 68, 68)",
			}}
		>
			<div className="flex items-center gap-2 mb-3">
				<Trash2 size={16} style={{ color: "rgb(239, 68, 68)" }} />
				<span className="font-medium text-sm" style={{ color: "var(--text-primary)" }}>
					Data Cleared
				</span>
			</div>
			<div className="grid grid-cols-2 gap-3">
				{Object.entries(results).map(([label, count]) => (
					<div
						key={label}
						className="p-2 rounded-md"
						style={{ backgroundColor: "var(--bg-primary)" }}
					>
						<div className="text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
							{label.charAt(0).toUpperCase() + label.slice(1)}
						</div>
						<span className="text-sm" style={{ color: "rgb(239, 68, 68)" }}>
							-{count} deleted
						</span>
					</div>
				))}
			</div>
			<div
				className="mt-3 pt-3 text-xs border-t"
				style={{ color: "var(--text-secondary)", borderColor: "var(--border-default)" }}
			>
				Total: {totalDeleted} records deleted
			</div>
		</div>
	);
}
