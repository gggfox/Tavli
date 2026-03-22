import { CheckCircle2 } from "lucide-react";
import type { SeedResults } from "./types.ts";

export function ResultsDisplay({ results }: Readonly<{ results: SeedResults }>) {
	const items = [
		{ label: "Categories", ...results.categories },
		{ label: "Forms", ...results.forms },
		{ label: "Finishes", ...results.finishes },
		{ label: "Choices", ...results.choices },
	];

	const totalInserted = items.reduce((sum, item) => sum + item.inserted, 0);
	const totalSkipped = items.reduce((sum, item) => sum + item.skipped, 0);

	return (
		<div
			className="mt-4 p-4 rounded-lg border"
			style={{
				backgroundColor: "var(--bg-secondary)",
				borderColor: "var(--border-default)",
			}}
		>
			<div className="flex items-center gap-2 mb-3">
				<CheckCircle2 size={16} style={{ color: "rgb(34, 197, 94)" }} />
				<span className="font-medium text-sm" style={{ color: "var(--text-primary)" }}>
					Seed Complete
				</span>
			</div>
			<div className="grid grid-cols-2 gap-3">
				{items.map((item) => (
					<div
						key={item.label}
						className="p-2 rounded-md"
						style={{ backgroundColor: "var(--bg-primary)" }}
					>
						<div className="text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
							{item.label}
						</div>
						<div className="flex items-center gap-3">
							<span className="text-sm" style={{ color: "rgb(34, 197, 94)" }}>
								+{item.inserted} new
							</span>
							<span className="text-sm" style={{ color: "var(--text-secondary)" }}>
								{item.skipped} existing
							</span>
						</div>
					</div>
				))}
			</div>
			<div
				className="mt-3 pt-3 text-xs border-t"
				style={{ color: "var(--text-secondary)", borderColor: "var(--border-default)" }}
			>
				Total: {totalInserted} records inserted, {totalSkipped} already existed
			</div>
		</div>
	);
}
