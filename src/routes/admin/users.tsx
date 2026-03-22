import { UsersTable } from "@/features";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/users")({
	component: AdminUsersPage,
});

function AdminUsersPage() {
	return (
		<div className="p-6 flex flex-col h-full">
			<div className="mb-6 flex items-start justify-between">
				<div>
					<h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
						User Management
					</h1>
					<p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
						View and manage all users and their roles.
					</p>
				</div>
			</div>
			<div className="flex-1">
				<UsersTable />
			</div>
		</div>
	);
}
