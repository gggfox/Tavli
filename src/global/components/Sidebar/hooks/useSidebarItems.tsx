import { useCurrentUserRoles } from "@/features/users/hooks";
import { SidebarKeys } from "@/global/i18n";
import { STAFF_ROLES, USER_ROLES } from "convex/constants";
import { useMemo } from "react";
import { sidebarItems } from "../constants";

const STAFF_ROLE_SET = new Set<string>(STAFF_ROLES);

const STAFF_SIDEBAR_KEYS = new Set<string>([
	SidebarKeys.RESTAURANTS,
	SidebarKeys.MENUS,
	SidebarKeys.OPTIONS,
	SidebarKeys.ORDERS,
	SidebarKeys.PAYMENTS,
	SidebarKeys.RESERVATIONS,
	SidebarKeys.TEAM,
]);

export function useSidebarItems() {
	const { roles: userRoles } = useCurrentUserRoles();

	const isAdmin = useMemo(() => userRoles.includes(USER_ROLES.ADMIN), [userRoles]);
	const isStaff = useMemo(() => userRoles.some((role) => STAFF_ROLE_SET.has(role)), [userRoles]);

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
