import { createFileRoute, Outlet, useMatches } from "@tanstack/react-router";

export const Route = createFileRoute("/admin")({
	component: AdminLayout,
});

function AdminLayout() {
	const matches = useMatches();
	const isExactAdminRoute = matches.length > 0 && matches.at(-1)?.pathname === "/admin";

	return (
		<div
			className="h-full flex flex-col overflow-hidden"
			style={{ backgroundColor: "var(--bg-primary)" }}
		>
			{isExactAdminRoute ? (
				<div className="p-6 flex flex-col h-full overflow-hidden">
					<div className="mb-6">
						<h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
							Admin Dashboard
						</h1>
						<p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
							Manage users and system settings.
						</p>
					</div>
				</div>
			) : (
				<Outlet />
			)}
		</div>
	);
}
