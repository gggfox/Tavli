import { EmptyState, LoadingState } from "@/global/components";
import { unwrapQuery } from "@/global/utils";
import { convexQuery, useConvexAuth } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet, useMatches } from "@tanstack/react-router";
import { api } from "convex/_generated/api";
import { useMemo } from "react";

const STAFF_ROLES = new Set(["admin", "owner", "manager", "employee"]);

export const Route = createFileRoute("/admin")({
	component: AdminLayout,
});

function AdminLayout() {
	const matches = useMatches();
	const isExactAdminRoute = matches.length > 0 && matches.at(-1)?.pathname === "/admin";
	const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();

	const { data: rawUserRoles, isLoading: isRolesLoading } = useQuery({
		...convexQuery(api.admin.getCurrentUserRoles, {}),
		enabled: isAuthenticated,
	});
	const userRoles: string[] = useMemo(() => unwrapQuery(rawUserRoles).data ?? [], [rawUserRoles]);
	const isStaff = useMemo(() => userRoles.some((role) => STAFF_ROLES.has(role)), [userRoles]);

	if (isAuthLoading || (isAuthenticated && isRolesLoading)) {
		return <LoadingState />;
	}

	if (!isAuthenticated || !isStaff) {
		return (
			<div className="p-6 flex items-center justify-center h-full">
				<EmptyState
					variant="inline"
					title="Access Denied"
					description="You do not have permission to view this page."
				/>
			</div>
		);
	}

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
