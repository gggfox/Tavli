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

export interface UseOrganizationsOptions {
	/**
	 * Skip the query entirely. `getAllOrganizations` rejects anyone below owner,
	 * so a caller that already knows the viewer is not entitled (the sidebar
	 * organization switcher, which is admin-only) must not subscribe: it would
	 * open a permanently-failing Convex subscription for every manager,
	 * employee and customer and render nothing from it. Defaults to `true` for
	 * the owner-facing callers (create form, settings canvas).
	 */
	enabled?: boolean;
}

export function useOrganizations({
	enabled = true,
}: UseOrganizationsOptions = {}): UseOrganizationsResult {
	const { isAuthenticated } = useConvexAuth();
	const active = isAuthenticated && enabled;
	const {
		data = [],
		isLoading,
		error,
	} = useQuery({
		...convexQuery(api.organizations.getAllOrganizations, {}),
		enabled: active,
		select: unwrapResult<OrganizationsValue>,
	});
	// A disabled query is not "loading" and cannot have errored — it never ran.
	return {
		organizations: active ? data : [],
		isLoading: active && isLoading,
		error: active ? error : null,
	};
}
