import { AlertCircle, RefreshCw } from "lucide-react";

interface ErrorStateProps {
	readonly error: Error;
	readonly onRetry: () => void;
}

export function ErrorState({ error, onRetry }: ErrorStateProps) {
	return (
		<div className="flex items-center justify-center p-8">
			<div className="text-center">
				<AlertCircle
					size={48}
					className="mx-auto mb-3"
					style={{ color: "rgb(239, 68, 68)" }}
				/>
				<h3
					className="text-lg font-medium mb-1"
					style={{ color: "var(--text-primary)" }}
				>
					Error Loading Materials
				</h3>
				<p className="mb-4" style={{ color: "var(--text-secondary)" }}>
					{error.message}
				</p>
				<button
					onClick={onRetry}
					className="inline-flex items-center gap-2 px-4 py-2 rounded-lg transition-colors"
					style={{
						backgroundColor: "var(--accent-primary)",
						color: "white",
					}}
				>
					<RefreshCw size={16} />
					Try Again
				</button>
			</div>
		</div>
	);
}




