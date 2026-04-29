/* eslint-disable boundaries/no-unknown-files */
import { ConvexReactClient } from "convex/react";

/**
 * Singleton Convex client.
 *
 * Lives in its own module to avoid a circular import:
 *   router.tsx → routeTree.gen.ts → routes/__root.tsx → (this file)
 * Previously `__root.tsx` imported `convexClient` from `router.tsx`, which
 * then imported the generated route tree, which imported `__root.tsx` —
 * producing TDZ errors during HMR ("Cannot access 'convexClient' before
 * initialization"). Top-level placement matches `router.tsx`, which sits
 * outside the `boundaries` element types for the same reason.
 */
export const convexClient = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL ?? "");
