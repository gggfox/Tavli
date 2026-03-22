import { useCallback, useMemo, useRef } from "react";
import {
  useAuth,
  useAccessToken,
} from "@workos/authkit-tanstack-react-start/client";

/**
 * Custom hook that bridges WorkOS TanStack Start auth with Convex's expected auth interface.
 *
 * @workos/authkit-tanstack-react-start splits auth state (useAuth) and token fetching (useAccessToken)
 * into separate hooks, but Convex expects them combined in a single useAuth hook.
 *
 * This follows the pattern from the Convex + WorkOS documentation for Next.js/TanStack integrations,
 * using a stable ref for the access token to ensure consistent token availability.
 */
export function useAuthForConvex() {
  const { user, loading: authLoading } = useAuth();
  const {
    accessToken,
    loading: tokenLoading,
    error: tokenError,
    getAccessToken,
  } = useAccessToken();

  // Store token in ref for stability across renders
  const stableAccessToken = useRef<string | null>(null);
  if (accessToken && !tokenError) {
    stableAccessToken.current = accessToken;
  }

  const isLoading = (authLoading ?? false) || (tokenLoading ?? false);
  // Important: isAuthenticated requires BOTH user AND accessToken
  const isAuthenticated = !!user && !!accessToken && !isLoading;

  /**
   * Fetch access token for Convex authentication.
   *
   * @param args - Optional parameter object from ConvexProviderWithAuth
   * @param args.forceRefreshToken - When true, fetch a fresh token instead of using cached
   * @returns The access token or null if unavailable
   */
  const fetchAccessToken = useCallback(
    async (args?: { forceRefreshToken: boolean }) => {
      const forceRefreshToken = args?.forceRefreshToken ?? false;
      // When force refresh is requested, use getAccessToken to fetch a fresh token
      if (forceRefreshToken) {
        try {
          const freshToken = await getAccessToken();
          if (freshToken) {
            stableAccessToken.current = freshToken;
            return freshToken;
          }
        } catch {
          // Fall through to return cached token or null
        }
      }

      // Return cached token if available
      const token = stableAccessToken.current;
      if (token && !tokenError) {
        return token;
      }
      return null;
    },
    [getAccessToken, tokenError]
  );

  return useMemo(
    () => ({
      isLoading,
      isAuthenticated,
      fetchAccessToken,
    }),
    [isLoading, isAuthenticated, fetchAccessToken]
  );
}
