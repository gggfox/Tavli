import { convexQuery, useConvexAuth } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import { useMemo } from "react";
import { sidebarItems } from "../constants";

export function useSidebarItems({ isMounted }: { isMounted: boolean }) {
	const { isAuthenticated } = useConvexAuth();

	// Get current user's roles to filter sidebar items
	// Only run query when mounted (client-side) and authenticated
	// Extract the first element from the tuple [data, error] returned by AsyncReturn
	const { data: rawUserRoles } = useQuery({
		...convexQuery(api.admin.getCurrentUserRoles, {}),
		enabled: isMounted && isAuthenticated,
	});
	const userRoles: string[] = useMemo(
		() => (Array.isArray(rawUserRoles) && rawUserRoles[0] !== null ? rawUserRoles[0] : []),
		[rawUserRoles]
	);

	const isAdmin = useMemo(() => userRoles.includes("admin"), [userRoles]);
	const isSeller = useMemo(() => userRoles.includes("seller"), [userRoles]);
	const hasAdminOrSellerAccess = useMemo(() => isAdmin || isSeller, [isAdmin, isSeller]);

	// Filter sidebar items based on user roles
	const filteredSidebarItems = useMemo(() => {
		return sidebarItems.filter((item) => {
			// Only show admin section if user has admin role
			if (item.translationKey === "sidebar.nav.admin") {
				return isAdmin;
			}
			// Only show sales history section if user has admin or seller role
			if (item.translationKey === "sidebar.nav.salesHistory") {
				return hasAdminOrSellerAccess;
			}
			// Always show other items
			return true;
		});
	}, [isAdmin, hasAdminOrSellerAccess]);

	return { filteredSidebarItems };
}
