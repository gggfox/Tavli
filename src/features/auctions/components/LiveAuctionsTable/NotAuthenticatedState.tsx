import { Search } from "lucide-react";

export function NotAuthenticatedState() {
	return (
		<div
			className="flex flex-col items-center justify-center py-12 rounded-lg"
			style={{ backgroundColor: "var(--bg-secondary)" }}
		>
			<div
				className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
				style={{ backgroundColor: "var(--bg-hover)" }}
			>
				<Search size={24} style={{ color: "var(--text-muted)" }} />
			</div>
			<p className="text-lg font-medium" style={{ color: "var(--text-primary)" }}>
				Authentication required
			</p>
			<p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
				Please sign in to view live auction materials.
			</p>
		</div>
	);
}
