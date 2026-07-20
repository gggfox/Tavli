/**
 * RouteErrorComponent - router-level counterpart to `ErrorBoundary`.
 *
 * TanStack Router catches errors thrown by `beforeLoad`, loaders and route
 * components itself and renders the route's `errorComponent` instead of the
 * route. Wired as `defaultErrorComponent` in `src/router.tsx`, this gives
 * every one of the app's route files a boundary without hand-writing one per
 * file; individual routes override it only where recovery differs.
 *
 * Recovery is two-step on purpose: `reset()` clears the router's captured
 * error, and `invalidate()` drops the cached (failed) loader result so the
 * retry actually re-runs the load instead of replaying the same failure.
 */
import { useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { useCallback, type ReactNode } from "react";
import { ErrorFallback } from "./ErrorFallback";

export type RouteErrorComponentProps = ErrorComponentProps & {
	/** Extra recovery actions (e.g. "back to the menu") for a given section. */
	readonly actions?: ReactNode;
};

export function RouteErrorComponent({ error, reset, actions }: RouteErrorComponentProps) {
	const router = useRouter();

	const handleRetry = useCallback(() => {
		reset();
		void router.invalidate();
	}, [reset, router]);

	// Mirrors `ErrorBoundary.componentDidCatch`. Real telemetry is TAVLI-9.
	console.error("Route error:", error);

	return <ErrorFallback error={error} onRetry={handleRetry} actions={actions} />;
}
