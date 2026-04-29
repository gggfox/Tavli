import { useCurrentUserRoles } from "@/features/users/hooks";
import { EmptyState, LoadingState } from "@/global/components";
import { createFileRoute, Outlet, useMatches } from "@tanstack/react-router";
import { STAFF_ROLES } from "convex/constants";
import { useMemo } from "react";

const STAFF_ROLE_SET = new Set<string>(STAFF_ROLES);

export const Route = createFileRoute("/admin")({
	component: AdminLayout,
});

function AdminLayout() {
	const matches = useMatches();
	const isExactAdminRoute = matches.length > 0 && matches.at(-1)?.pathname === "/admin";
	const { roles: userRoles, isLoading, isAuthenticated } = useCurrentUserRoles();
	const isStaff = useMemo(() => userRoles.some((role) => STAFF_ROLE_SET.has(role)), [userRoles]);

	if (isLoading) {
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
			className="h-full flex flex-col overflow-hidden bg-background"
			
		>
			{isExactAdminRoute ? (
				<div className="p-6 flex flex-col h-full overflow-hidden">
					<div className="mb-6">
						<h1 className="text-2xl font-semibold text-foreground" >
							Admin Dashboard
						</h1>
						<p className="mt-2 text-sm text-muted-foreground" >
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
