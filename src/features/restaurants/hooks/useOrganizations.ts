/**
 * Single data source for the organization pickers in the restaurants admin
 * (create form + the Organization section of the settings canvas).
 *
 * It deliberately surfaces `isLoading` / `error` instead of collapsing to an
 * empty array: the settings view renders an explanatory state rather than
 * making the field vanish when the query is slow or fails.
 */
import { unwrapResult, type UnwrappedValue } from "@/global/utils";
import { convexQuery, useConvexAuth } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { FunctionReturnType } from "convex/server";

type OrganizationsValue = UnwrappedValue<
	FunctionReturnType<typeof api.organizations.getAllOrganizations>
>;

export interface UseOrganizationsResult {
	organizations: OrganizationsValue;
	isLoading: boolean;
	error: unknown;
}

export function useOrganizations(): UseOrganizationsResult {
	const { isAuthenticated } = useConvexAuth();
	const {
		data = [],
		isLoading,
		error,
	} = useQuery({
		...convexQuery(api.organizations.getAllOrganizations, {}),
		enabled: isAuthenticated,
		select: unwrapResult<OrganizationsValue>,
	});
	return { organizations: data, isLoading: isAuthenticated && isLoading, error };
}
