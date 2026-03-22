import { Clock } from "lucide-react";

export function EmptyState() {
	return (
		<div className="flex items-center justify-center p-12">
			<div className="text-center">
				<Clock size={48} className="mx-auto mb-3" style={{ color: "var(--text-muted)" }} />
				<h3 className="text-lg font-medium mb-1" style={{ color: "var(--text-primary)" }}>
					No Pending Materials
				</h3>
				<p style={{ color: "var(--text-secondary)" }}>
					You don't have any materials waiting for approval.
				</p>
			</div>
		</div>
	);
}




