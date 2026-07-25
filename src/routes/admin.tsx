import { useCurrentUserRoles } from "@/features/users/hooks";
import { EmptyState, LoadingState, RouteErrorComponent } from "@/global/components";
import {
	createFileRoute,
	Link,
	Outlet,
	useMatches,
	type ErrorComponentProps,
} from "@tanstack/react-router";
import { SidebarKeys } from "@/global/i18n";
import { STAFF_ROLES } from "convex/constants";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

const STAFF_ROLE_SET = new Set<string>(STAFF_ROLES);

export const Route = createFileRoute("/admin")({
	component: AdminLayout,
	errorComponent: AdminErrorComponent,
});

/**
 * Admin recovery differs from the app default: a staff member whose admin
 * sub-page failed is almost always better served by stepping back into the
 * admin dashboard than by reloading a page that will fail again. Reload is
 * still offered by the shared panel.
 */
function AdminErrorComponent(props: Readonly<ErrorComponentProps>) {
	const { t } = useTranslation();
	return (
		<RouteErrorComponent
			{...props}
			actions={
				<Link
					to="/admin"
					className="px-6 py-2.5 font-medium rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-offset-2 hover-btn-secondary"
				>
					{t(SidebarKeys.ADMIN)}
				</Link>
			}
		/>
	);
}

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
		<div className="h-full flex flex-col overflow-hidden bg-background">
			{isExactAdminRoute ? (
				<div className="p-6 flex flex-col h-full overflow-hidden">
					<div className="mb-6">
						<h1 className="text-2xl font-semibold text-foreground">Admin Dashboard</h1>
						<p className="mt-2 text-sm text-muted-foreground">Manage users and system settings.</p>
					</div>
				</div>
			) : (
				<Outlet />
			)}
		</div>
	);
}
