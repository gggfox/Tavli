import { FeatureFlagsTable } from "@/features";
import { AdminPageLayout } from "@/global/components";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/feature-flags")({
	component: AdminFeatureFlagsPage,
});

function AdminFeatureFlagsPage() {
	return (
		<AdminPageLayout
			title="Feature flags"
			description="Toggle global feature flags. Keys are defined in convex/featureFlags.ts."
		>
			<FeatureFlagsTable />
		</AdminPageLayout>
	);
}
