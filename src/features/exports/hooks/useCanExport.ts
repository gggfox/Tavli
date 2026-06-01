/**
 * Returns whether the current user can export data for a given restaurant.
 *
 * The export Convex actions require owner / manager / admin access (the same
 * tier `requireRestaurantManagerOrAbove` enforces). This hook mirrors that
 * check on the client so we can hide the button when it would be rejected.
 *
 * Authorization paths (any one of these qualifies):
 *   - platform admin (`userRoles.roles` contains `admin`)
 *   - org owner whose `userRoles.organizationId` matches the restaurant's org
 *   - restaurant document owner (`restaurants.ownerId`)
 *   - active restaurant member with the manager role
 */
import { useCurrentUserRoles } from "@/features/users/hooks";
import { unwrapResult } from "@/global/utils";
import { useUser } from "@clerk/tanstack-react-start";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { RESTAURANT_MEMBER_ROLE, USER_ROLES } from "convex/constants";
import { useConvexAuth } from "convex/react";
import { useMemo } from "react";

export function useCanExport(
	restaurantId: Id<"restaurants"> | undefined,
	organizationId: Id<"organizations"> | undefined,
	restaurantOwnerId?: string
): { canExport: boolean; isLoading: boolean } {
	const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
	const { user, isLoaded: isClerkLoaded } = useUser();
	const { roles, organizationId: userOrgId, isLoading: rolesLoading } = useCurrentUserRoles();
	const { data: myMemberships, isLoading: membershipsLoading } = useQuery({
		...convexQuery(api.restaurantMembers.listByUser, {}),
		enabled: isAuthenticated && !isAuthLoading,
		select: unwrapResult<Doc<"restaurantMembers">[]>,
	});

	const isAdmin = roles.includes(USER_ROLES.ADMIN);
	const isOrgOwner =
		roles.includes(USER_ROLES.OWNER) &&
		userOrgId != null &&
		organizationId != null &&
		userOrgId === String(organizationId);

	const isManager = useMemo(() => {
		if (!myMemberships || !restaurantId) return false;
		return myMemberships.some(
			(m) =>
				m.isActive && m.restaurantId === restaurantId && m.role === RESTAURANT_MEMBER_ROLE.MANAGER
		);
	}, [myMemberships, restaurantId]);

	const isRestaurantDocumentOwner = Boolean(
		restaurantOwnerId && user?.id && user.id === restaurantOwnerId
	);

	return {
		canExport: Boolean(
			restaurantId && (isAdmin || isOrgOwner || isManager || isRestaurantDocumentOwner)
		),
		isLoading:
			rolesLoading || !isClerkLoaded || isAuthLoading || (isAuthenticated && membershipsLoading),
	};
}
