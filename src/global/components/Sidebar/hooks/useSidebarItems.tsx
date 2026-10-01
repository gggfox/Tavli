import { useRestaurant } from "@/features/restaurants";
import { useCurrentUserRoles } from "@/features/users/hooks";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import { STAFF_ROLES, USER_ROLES } from "convex/constants";
import { useMemo } from "react";
import { sidebarItems } from "../constants";
import { filterSidebarItems } from "../sidebarAccess";

const STAFF_ROLE_SET = new Set<string>(STAFF_ROLES);

export function useSidebarItems() {
	const { roles: userRoles, isAuthenticated } = useCurrentUserRoles();
	const { restaurant } = useRestaurant();

	const isAdmin = useMemo(() => userRoles.includes(USER_ROLES.ADMIN), [userRoles]);
	const isStaff = useMemo(() => userRoles.some((role) => STAFF_ROLE_SET.has(role)), [userRoles]);

	// Manager-or-above is per restaurant (a member can manage one location and
	// be an employee at another), so ask the backend about the selected one —
	// the same `requireRestaurantManagerOrAbove` the manager-only pages call.
	const { data: accessLevel } = useQuery({
		...convexQuery(
			api.restaurantMembers.myAccessLevel,
			restaurant ? { restaurantId: restaurant._id } : "skip"
		),
		enabled: isAuthenticated && isStaff && !isAdmin,
	});

	// Platform admins and organization owners manage every restaurant they can
	// select, so they get their full sidebar immediately instead of watching it
	// grow when the query answers. Everyone else waits for the answer: until
	// then the manager-only entries stay hidden rather than flashing in and out
	// for an employee.
	const isManagerOrAbove =
		isAdmin || (accessLevel?.isManagerOrAbove ?? userRoles.includes(USER_ROLES.OWNER));

	const filteredSidebarItems = useMemo(
		() => filterSidebarItems(sidebarItems, { isAdmin, isStaff, isManagerOrAbove }),
		[isAdmin, isStaff, isManagerOrAbove]
	);

	return { filteredSidebarItems };
}
