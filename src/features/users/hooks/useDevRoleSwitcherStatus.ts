import { unwrapResult } from "@/global/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";

/**
 * Whether the backend will actually accept `admin.devSetOwnRoles` on this
 * deployment (`CONVEX_ENV=development` + `ENABLE_DEV_ROLE_SWITCHER`).
 *
 * The Settings modal gates the dev role-switcher buttons on this instead of
 * trusting the frontend build flag alone, so a deployment that is missing the
 * backend env vars shows an explanatory hint rather than buttons whose clicks
 * silently no-op.
 */
export function useDevRoleSwitcherStatus(queryEnabled: boolean) {
	const query = useQuery({
		...convexQuery(api.admin.getDevRoleSwitcherStatus, {}),
		enabled: queryEnabled,
		select: unwrapResult<{ enabled: boolean }>,
	});
	return {
		switcherEnabled: query.data?.enabled ?? false,
		isLoading: queryEnabled && query.isLoading,
	};
}
