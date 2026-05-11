import { DashboardPage } from "@/features/dashboard";
import { useCurrentUserRoles } from "@/features/users/hooks";
import { EmptyState, LoadingState } from "@/global/components";
import { createFileRoute } from "@tanstack/react-router";
import { STAFF_ROLES } from "convex/constants";
import { useMemo } from "react";

const STAFF_ROLE_SET = new Set<string>(STAFF_ROLES);

export const Route = createFileRoute("/dashboard")({
	component: DashboardRoute,
});

function DashboardRoute() {
	const { roles, isLoading, isAuthenticated } = useCurrentUserRoles();
	const isStaff = useMemo(
		() => roles.some((role) => STAFF_ROLE_SET.has(role)),
		[roles]
	);

	if (isLoading) return <LoadingState />;

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
		<div className="h-full flex flex-col overflow-hidden bg-background">
			<DashboardPage userRoles={roles} />
		</div>
	);
}
