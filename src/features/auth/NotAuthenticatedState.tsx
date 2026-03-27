import { ShieldAlert } from "lucide-react";

export function NotAuthenticatedState() {
	return (
		<div className="flex items-center justify-center p-8">
			<div className="text-center">
				<ShieldAlert size={48} className="mx-auto mb-3" style={{ color: "var(--text-muted)" }} />
				<h3 className="text-lg font-medium mb-1" style={{ color: "var(--text-primary)" }}>
					Authentication Required
				</h3>
				<p style={{ color: "var(--text-secondary)" }}>Please sign in to manage your restaurants.</p>
			</div>
		</div>
	);
}
