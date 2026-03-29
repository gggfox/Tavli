import { OrganizationsTable } from "@/features";
import { AdminPageLayout } from "@/global/components";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/organizations")({
	component: AdminOrganizationsPage,
});

function AdminOrganizationsPage() {
	return (
		<AdminPageLayout
			title="Organizations"
			description="Manage organizations for restaurant owners."
		>
			<OrganizationsTable />
		</AdminPageLayout>
	);
}
