import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/live-rfqs/create")({
	component: CreateRFQ,
});

function CreateRFQ() {
	return (
		<div
			className="h-full flex flex-col overflow-hidden"
			style={{ backgroundColor: "var(--bg-primary)" }}
		>
			<div className="p-6">
				<h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
					Create RFQ
				</h1>
			</div>
		</div>
	);
}
