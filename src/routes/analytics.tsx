import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/analytics")({
	component: Analytics,
});

function Analytics() {
	return (
		<div className="h-full flex flex-col overflow-hidden" style={{ backgroundColor: "var(--bg-primary)" }}>
			<div className="p-6">
				<h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
					Analytics
				</h1>
			</div>
		</div>
	);
}
