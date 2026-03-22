import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/alerts/create-material")({
	component: CreateMaterialAlert,
});

function CreateMaterialAlert() {
	return (
		<div className="h-full flex flex-col overflow-hidden" style={{ backgroundColor: "var(--bg-primary)" }}>
			<div className="p-6">
				<h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
					Create Material Alert
				</h1>
			</div>
		</div>
	);
}





