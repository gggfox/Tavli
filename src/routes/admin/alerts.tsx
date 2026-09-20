import { OperatorAlertsTable } from "@/features/alerts";
import { AdminPageLayout } from "@/global/components";
import { createFileRoute } from "@tanstack/react-router";

/**
 * `/admin/alerts` — operator alerts (TAVLI-109).
 *
 * Thin by design, like `/admin/feature-flags` and `/admin/whatsapp-allowlist`:
 * the platform-admin gate that matters is on the backend
 * (`api.operatorAlerts.list` and `.acknowledge` both require the admin role),
 * and the sidebar entry lives in the ADMIN group, which `useSidebarItems`
 * already filters to platform admins.
 */
export const Route = createFileRoute("/admin/alerts")({
	component: AdminAlertsPage,
});

function AdminAlertsPage() {
	return (
		<AdminPageLayout>
			<OperatorAlertsTable />
		</AdminPageLayout>
	);
}
