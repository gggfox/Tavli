/**
 * Fetches the list of years a restaurant can export. Returns the same shape
 * the Convex `getRestaurantExportYears` query returns, plus loading state.
 */
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useConvexAuth } from "convex/react";

export function useExportYears(restaurantId: Id<"restaurants">) {
	const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
	const query = useQuery({
		...convexQuery(api.exports.getRestaurantExportYears, { restaurantId }),
		// Wait until Convex has the Clerk token — avoids transient "Unauthorized" logs.
		enabled: isAuthenticated && !isAuthLoading,
	});
	return {
		years: query.data?.years ?? [],
		currentYear: query.data?.currentYear ?? new Date().getFullYear(),
		isLoading: query.isLoading || isAuthLoading,
		error: query.error,
	};
}
