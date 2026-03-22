import { Loader2 } from "lucide-react";

export function AuthLoadingState() {
	return (
		<div
			className="flex flex-col items-center justify-center py-12 rounded-lg"
			style={{ backgroundColor: "var(--bg-secondary)" }}
		>
			<Loader2 size={32} className="animate-spin mb-4" style={{ color: "var(--text-muted)" }} />
			<p className="text-lg font-medium" style={{ color: "var(--text-primary)" }}>
				Verifying authentication...
			</p>
		</div>
	);
}
