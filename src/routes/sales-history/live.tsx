import { AuthLoadingState, InsufficientPermissionsState, NotAuthenticatedState } from "@/features";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "convex/_generated/api";
import { useConvexAuth } from "convex/react";
import { useMemo } from "react";
export const Route = createFileRoute("/sales-history/live")({
	component: LiveSales,
});

function LiveSales() {
	const { isLoading: isAuthLoading, isAuthenticated } = useConvexAuth();

	// Get user roles to check if admin or seller
	// Extract the first element from the tuple [data, error] returned by AsyncReturn
	const { data: rawUserRoles, isLoading: isLoadingRoles } = useQuery({
		...convexQuery(api.admin.getCurrentUserRoles, {}),
		enabled: isAuthenticated,
	});
	const userRoles: string[] = useMemo(
		() => (Array.isArray(rawUserRoles) && rawUserRoles[0] !== null ? rawUserRoles[0] : []),
		[rawUserRoles]
	);

	const isAdmin = useMemo(() => userRoles.includes("admin"), [userRoles]);
	const isSeller = useMemo(() => userRoles.includes("seller"), [userRoles]);
	const hasAccess = useMemo(() => isAdmin || isSeller, [isAdmin, isSeller]);

	// Check authentication state first
	if (isAuthLoading || isLoadingRoles) {
		return <AuthLoadingState />;
	}

	if (!isAuthenticated) {
		return <NotAuthenticatedState />;
	}

	// Check if user has required role (admin or seller)
	if (!hasAccess) {
		return <InsufficientPermissionsState />;
	}

	return (
		<div
			className="h-full flex flex-col overflow-hidden"
			style={{ backgroundColor: "var(--bg-primary)" }}
		>
			<div className="p-6">
				<h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
					Live Sales
				</h1>
			</div>
		</div>
	);
}
