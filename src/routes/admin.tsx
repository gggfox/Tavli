import { StartAuctionSection } from "@/features";
import { SeedDataSection } from "@/features/materials/components";
import { createFileRoute, Outlet, useMatches } from "@tanstack/react-router";

export const Route = createFileRoute("/admin")({
	component: AdminLayout,
});

function AdminLayout() {
	const matches = useMatches();
	// Check if we're on the exact /admin route (not a child like /admin/users)
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
							Manage users, auctions, and system settings.
						</p>
					</div>
					<div className="flex-1 overflow-y-auto space-y-8">
						<SeedDataSection />
						<StartAuctionSection />
					</div>
				</div>
			) : (
				<Outlet />
			)}
		</div>
	);
}
