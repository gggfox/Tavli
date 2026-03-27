import { convexQuery, useConvexAuth } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import { useMemo } from "react";
import { sidebarItems } from "../constants";

export function useSidebarItems({ isMounted }: { isMounted: boolean }) {
	const { isAuthenticated } = useConvexAuth();

	const { data: rawUserRoles } = useQuery({
		...convexQuery(api.admin.getCurrentUserRoles, {}),
		enabled: isMounted && isAuthenticated,
	});
	const userRoles: string[] = useMemo(
		() => (Array.isArray(rawUserRoles) && rawUserRoles[0] !== null ? rawUserRoles[0] : []),
		[rawUserRoles]
	);

	const isAdmin = useMemo(() => userRoles.includes("admin"), [userRoles]);

	const filteredSidebarItems = useMemo(() => {
		return sidebarItems.filter((item) => {
			if (item.translationKey === "sidebar.nav.admin") {
				return isAdmin;
			}
			return true;
		});
	}, [isAdmin]);

	return { filteredSidebarItems };
}
