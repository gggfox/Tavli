import { AuthLoadingState, NotAuthenticatedState } from "@/features";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "convex/_generated/api";
import { useConvexAuth } from "convex/react";
import { useMemo } from "react";

export const Route = createFileRoute("/sales-history")({
	component: SalesHistory,
});

function SalesHistory() {
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
					Sales History
				</h1>
			</div>
		</div>
	);
}

function InsufficientPermissionsState() {
	return (
		<div className="flex items-center justify-center p-8">
			<div className="text-center">
				<div
					className="w-16 h-16 mx-auto mb-3 rounded-full flex items-center justify-center"
					style={{ backgroundColor: "rgba(239, 68, 68, 0.15)" }}
				>
					<svg
						className="w-8 h-8"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						style={{ color: "rgb(239, 68, 68)" }}
						aria-hidden="true"
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={2}
							d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
						/>
					</svg>
				</div>
				<h3 className="text-lg font-medium mb-1" style={{ color: "var(--text-primary)" }}>
					Access Restricted
				</h3>
				<p style={{ color: "var(--text-secondary)" }}>
					You need admin or seller role to view sales history.
				</p>
			</div>
		</div>
	);
}
