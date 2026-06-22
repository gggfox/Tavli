import { FeatureFlagsTable } from "@/features";
import { AdminPageLayout } from "@/global/components";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/feature-flags")({
	component: AdminFeatureFlagsPage,
});

function AdminFeatureFlagsPage() {
	return (
		<AdminPageLayout>
			<FeatureFlagsTable />
		</AdminPageLayout>
	);
}
