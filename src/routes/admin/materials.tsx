import { MaterialsApprovalTable } from "@/features";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/materials")({
	component: AdminMaterialsPage,
});

function AdminMaterialsPage() {
	return (
		<div className="p-6 flex flex-col h-full">
			<div className="mb-6 flex items-start justify-between">
				<div>
					<h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
						Material Approval
					</h1>
					<p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
						Review and approve pending materials submitted by sellers.
					</p>
				</div>
			</div>
			<div className="flex-1">
				<MaterialsApprovalTable />
			</div>
		</div>
	);
}
