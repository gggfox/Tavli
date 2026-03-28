import type { LucideIcon } from "lucide-react";
import { ShieldAlert } from "lucide-react";

interface NotAuthenticatedStateProps {
	readonly icon?: LucideIcon;
	readonly message?: string;
}

export function NotAuthenticatedState({
	icon: Icon = ShieldAlert,
	message = "Please sign in to manage your restaurants.",
}: NotAuthenticatedStateProps = {}) {
	return (
		<div
			className="flex flex-col items-center justify-center py-12 rounded-lg"
			style={{ backgroundColor: "var(--bg-secondary)" }}
		>
			<div
				className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
				style={{ backgroundColor: "var(--bg-hover)" }}
			>
				<Icon size={24} style={{ color: "var(--text-muted)" }} />
			</div>
			<p className="text-lg font-medium" style={{ color: "var(--text-primary)" }}>
				Authentication required
			</p>
			<p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
				{message}
			</p>
		</div>
	);
}
