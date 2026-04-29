import { unwrapResult } from "@/global/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import { useConvexAuth } from "convex/react";

/**
 * Returns the current authenticated user's role list. Centralizes the
 * `useQuery + select: unwrapResult + enabled: isAuthenticated` boilerplate
 * that was previously duplicated across `admin.tsx`,
 * `useSidebarItems`, `SettingsModal`, and `AdminRestaurantsList`.
 *
 * React Query dedupes calls by query key, so multiple components using
 * this hook share a single network round-trip.
 */
export function useCurrentUserRoles() {
	const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
	const query = useQuery({
		...convexQuery(api.admin.getCurrentUserRoles, {}),
		enabled: isAuthenticated,
		select: unwrapResult<string[]>,
	});
	return {
		roles: query.data ?? [],
		isLoading: query.isLoading || isAuthLoading,
		isAuthenticated,
	};
}
