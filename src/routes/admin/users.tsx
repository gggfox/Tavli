import { UsersTable } from "@/features";
import { AdminPageLayout } from "@/global/components";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/users")({
	component: AdminUsersPage,
});

function AdminUsersPage() {
	return (
		<AdminPageLayout
			title="User Management"
			description="View and manage all users and their roles."
		>
			<UsersTable />
		</AdminPageLayout>
	);
}
