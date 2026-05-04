/**
 * Resolve the list of `restaurantMembers` rows the current user is allowed
 * to schedule shifts for at `restaurantId`.
 *
 * The convex layer enforces this on every write via
 * `requireShiftTargetAuthority`, but the UI also needs to know the list to:
 *   - render the member dropdown in `ShiftDrawer`
 *   - render the row axis of `ScheduleWeekGrid`
 *   - hide the team-row "Asignar turno…" action for forbidden targets
 *
 * Permission tiers (mirrors `assertCanManageMembership`):
 *   - admin / restaurant document owner / org owner → all active members
 *   - active manager at this restaurant → employees only
 *   - everyone else → none
 */
import { useRestaurant } from "@/features/restaurants";
import { useCurrentUserRoles } from "@/features/users/hooks";
import { unwrapResult } from "@/global/utils";
import { useAuth } from "@clerk/tanstack-react-start";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import {
	RESTAURANT_MEMBER_ROLE,
	type RestaurantMemberRole,
	USER_ROLES,
} from "convex/constants";
import { useConvexAuth } from "convex/react";
import { useMemo } from "react";
import type { AssignableMember } from "../types";

interface UseAssignableMembersResult {
	readonly members: AssignableMember[];
	readonly isLoading: boolean;
	readonly canAssignAny: boolean;
}

interface DirectoryMemberRow {
	rowType: "member";
	_id: Id<"restaurantMembers">;
	userId: string;
	role: RestaurantMemberRole;
	isActive: boolean;
	email: string | null;
}

type DirectoryRow =
	| DirectoryMemberRow
	| { rowType: "restaurantOwner" | "orgOwner"; userId: string; role: string; isActive: boolean; email: string | null }
	| { rowType: "invite"; _id: Id<"invitations">; email: string; role: string };

export function useAssignableMembers(restaurantId: Id<"restaurants"> | undefined): UseAssignableMembersResult {
	const { isAuthenticated } = useConvexAuth();
	const { userId } = useAuth();
	const { roles, organizationId: userOrgId } = useCurrentUserRoles();
	const { restaurant, restaurants } = useRestaurant();

	const { data: directoryRows, isLoading: directoryLoading } = useQuery({
		...convexQuery(
			api.restaurantMembers.listTeamDirectory,
			restaurantId ? { restaurantId } : "skip"
		),
		enabled: Boolean(isAuthenticated && restaurantId),
		select: unwrapResult<DirectoryRow[]>,
	});

	const { data: myMemberships, isLoading: membershipsLoading } = useQuery({
		...convexQuery(api.restaurantMembers.listByUser, {}),
		enabled: isAuthenticated,
		select: unwrapResult<Doc<"restaurantMembers">[]>,
	});

	const isAdmin = roles.includes(USER_ROLES.ADMIN);
	const orgIdStr =
		restaurant?.organizationId != null ? String(restaurant.organizationId) : undefined;

	const ownsRestaurantInCurrentOrg = useMemo(() => {
		if (!userId || !restaurant) return false;
		return restaurants.some(
			(r) => r.organizationId === restaurant.organizationId && r.ownerId === userId
		);
	}, [userId, restaurant, restaurants]);

	const isOrgOwner =
		roles.includes(USER_ROLES.OWNER) &&
		orgIdStr != null &&
		(userOrgId === orgIdStr || ownsRestaurantInCurrentOrg);

	const isRestaurantManager = useMemo(() => {
		if (!restaurantId || !myMemberships) return false;
		return myMemberships.some(
			(m) =>
				m.isActive &&
				m.restaurantId === restaurantId &&
				m.role === RESTAURANT_MEMBER_ROLE.MANAGER
		);
	}, [myMemberships, restaurantId]);

	const isRestaurantDocumentOwner = useMemo(() => {
		if (!restaurant || !userId) return false;
		return restaurant.ownerId === userId;
	}, [restaurant, userId]);

	const canAssignAny =
		isAdmin || isOrgOwner || isRestaurantDocumentOwner || isRestaurantManager;

	const canTargetManagers = isAdmin || isOrgOwner || isRestaurantDocumentOwner;

	const members = useMemo<AssignableMember[]>(() => {
		if (!directoryRows || !canAssignAny) return [];
		const out: AssignableMember[] = [];
		for (const row of directoryRows) {
			if (row.rowType !== "member") continue;
			if (!row.isActive) continue;
			if (!canTargetManagers && row.role === RESTAURANT_MEMBER_ROLE.MANAGER) continue;
			out.push({
				memberId: row._id,
				userId: row.userId,
				role: row.role,
				email: row.email,
			});
		}
		out.sort((a, b) => {
			const left = a.email?.trim() ? a.email : a.userId;
			const right = b.email?.trim() ? b.email : b.userId;
			return left.localeCompare(right, undefined, { sensitivity: "base" });
		});
		return out;
	}, [directoryRows, canAssignAny, canTargetManagers]);

	return {
		members,
		isLoading: directoryLoading || membershipsLoading,
		canAssignAny,
	};
}
