import { SpendAllowlistTable } from "@/features";
import { AdminPageLayout } from "@/global/components";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/whatsapp-allowlist")({
	component: AdminWhatsappAllowlistPage,
});

function AdminWhatsappAllowlistPage() {
	return (
		<AdminPageLayout>
			<SpendAllowlistTable />
		</AdminPageLayout>
	);
}
