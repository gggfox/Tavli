/**
 * The two lists the single-invite form picks from: every organization on the
 * platform, and the restaurants of whichever one the admin chose.
 *
 * Both halves surface `isLoading` and `error` rather than collapsing to an
 * empty array. A silently-empty organization `<select>` has already bitten this
 * repo once (see `AdminRestaurantsCreateForm.test.tsx`), and here the failure
 * mode is worse: an admin who cannot tell "still loading" from "no restaurants"
 * would conclude the organization has no locations and invite the person as an
 * owner instead.
 *
 * Restaurants come from `restaurants.getAll`, which returns every live
 * restaurant for a platform admin, filtered here to the chosen organization.
 * That is deliberate — this form must reach any tenant, so it must NOT read the
 * admin scope (`RestaurantAdminScope`), whose whole job is to narrow the app to
 * one organization at a time.
 */
import { useOrganizations } from "@/features/restaurants/hooks/useOrganizations";
import { unwrapResult } from "@/global/utils";
import { convexQuery, useConvexAuth } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { useMemo } from "react";

export interface UseInviteDirectoryOptions {
	/** Skip both queries entirely — the dialog is closed, or the viewer is not an admin. */
	readonly enabled: boolean;
	/** `null` until the admin picks one; restaurants stay empty until then. */
	readonly organizationId: Id<"organizations"> | null;
}

export interface UseInviteDirectoryResult {
	readonly organizations: readonly Doc<"organizations">[];
	readonly isOrganizationsLoading: boolean;
	readonly organizationsError: unknown;
	/** Live restaurants of `organizationId`, sorted by name. Empty when none is chosen. */
	readonly restaurants: readonly Doc<"restaurants">[];
	readonly isRestaurantsLoading: boolean;
	readonly restaurantsError: unknown;
}

function byName<T extends { name: string }>(rows: readonly T[]): T[] {
	return [...rows].sort((a, b) => a.name.localeCompare(b.name));
}

export function useInviteDirectory({
	enabled,
	organizationId,
}: UseInviteDirectoryOptions): UseInviteDirectoryResult {
	const { isAuthenticated } = useConvexAuth();
	const active = enabled && isAuthenticated;

	const {
		organizations,
		isLoading: isOrganizationsLoading,
		error: organizationsError,
	} = useOrganizations({ enabled: active });

	const {
		data: allRestaurants = [],
		isLoading: isRestaurantsQueryLoading,
		error: restaurantsQueryError,
	} = useQuery({
		...convexQuery(api.restaurants.getAll, {}),
		enabled: active,
		select: unwrapResult<Doc<"restaurants">[]>,
	});

	const restaurants = useMemo(() => {
		if (!active || organizationId === null) return [];
		return byName(allRestaurants.filter((row) => row.organizationId === organizationId));
	}, [active, organizationId, allRestaurants]);

	return {
		organizations: useMemo(() => byName(organizations), [organizations]),
		isOrganizationsLoading,
		organizationsError,
		restaurants,
		// A query that never ran is not loading and cannot have failed.
		isRestaurantsLoading: active && isRestaurantsQueryLoading,
		restaurantsError: active ? restaurantsQueryError : null,
	};
}
