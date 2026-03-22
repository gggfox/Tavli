import { CheckCircle } from "lucide-react";

export function EmptyState() {
	return (
		<div className="flex items-center justify-center p-12">
			<div className="text-center">
				<CheckCircle size={48} className="mx-auto mb-3" style={{ color: "rgb(34, 197, 94)" }} />
				<h3 className="text-lg font-medium mb-1" style={{ color: "var(--text-primary)" }}>
					All Caught Up!
				</h3>
				<p style={{ color: "var(--text-secondary)" }}>There are no materials pending approval.</p>
			</div>
		</div>
	);
}
