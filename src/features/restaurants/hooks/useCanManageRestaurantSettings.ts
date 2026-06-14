/**
 * Returns whether the current user can edit restaurant settings (timezone,
 * operating hours, etc.) for a given restaurant.
 *
 * Mirrors `requireRestaurantManagerOrAbove` on the backend.
 */
import { useCurrentUserRoles } from "@/features/users/hooks";
import { unwrapResult } from "@/global/utils";
import { useUser } from "@clerk/tanstack-react-start";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Doc } from "convex/_generated/dataModel";
import { RESTAURANT_MEMBER_ROLE, USER_ROLES } from "convex/constants";
import { useConvexAuth } from "convex/react";
import { useMemo } from "react";

export function useCanManageRestaurantSettings(
	restaurant: Pick<Doc<"restaurants">, "_id" | "organizationId" | "ownerId"> | null | undefined
): { canEditSettings: boolean; isLoading: boolean } {
	const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
	const { user, isLoaded: isClerkLoaded } = useUser();
	const { roles, organizationId: userOrgId, isLoading: rolesLoading } = useCurrentUserRoles();
	const { data: myMemberships, isLoading: membershipsLoading } = useQuery({
		...convexQuery(api.restaurantMembers.listByUser, {}),
		enabled: isAuthenticated && !isAuthLoading,
		select: unwrapResult<Doc<"restaurantMembers">[]>,
	});

	const restaurantId = restaurant?._id;
	const organizationId = restaurant?.organizationId;
	const restaurantOwnerId = restaurant?.ownerId;

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
		canEditSettings: Boolean(
			restaurantId && (isAdmin || isOrgOwner || isManager || isRestaurantDocumentOwner)
		),
		isLoading:
			rolesLoading || !isClerkLoaded || isAuthLoading || (isAuthenticated && membershipsLoading),
	};
}
