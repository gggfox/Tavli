import { SidebarKeys } from "@/global/i18n";
import { unwrapQuery } from "@/global/utils";
import { convexQuery, useConvexAuth } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import { useMemo } from "react";
import { sidebarItems } from "../constants";

const STAFF_ROLES = ["admin", "owner", "manager", "employee"];

const STAFF_SIDEBAR_KEYS = new Set([
	SidebarKeys.RESTAURANTS,
	SidebarKeys.MENUS,
	SidebarKeys.OPTIONS,
	SidebarKeys.ORDERS,
]);

export function useSidebarItems({ isMounted }: { isMounted: boolean }) {
	const { isAuthenticated } = useConvexAuth();

	const { data: rawUserRoles } = useQuery({
		...convexQuery(api.admin.getCurrentUserRoles, {}),
		enabled: isMounted && isAuthenticated,
	});
	const userRoles: string[] = useMemo(() => unwrapQuery(rawUserRoles).data ?? [], [rawUserRoles]);

	const isAdmin = useMemo(() => userRoles.includes("admin"), [userRoles]);
	const isStaff = useMemo(() => userRoles.some((role) => STAFF_ROLES.includes(role)), [userRoles]);

	const filteredSidebarItems = useMemo(() => {
		return sidebarItems.filter((item) => {
			if (item.translationKey === SidebarKeys.ADMIN) {
				return isAdmin;
			}
			if (STAFF_SIDEBAR_KEYS.has(item.translationKey)) {
				return isStaff;
			}
			return true;
		});
	}, [isAdmin, isStaff]);

	return { filteredSidebarItems };
}
