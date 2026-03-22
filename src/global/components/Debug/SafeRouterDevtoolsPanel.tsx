import { Suspense, lazy, useEffect, useState } from "react";

// Dynamically import the router devtools to avoid SSR issues
const TanStackRouterDevtoolsPanel = lazy(() =>
	import("@tanstack/react-router-devtools").then((mod) => ({
		default: mod.TanStackRouterDevtoolsPanel,
	}))
);

function LoadingFallback() {
	return (
		<div className="p-4 font-mono text-xs bg-slate-900 min-h-full">
			<p className="text-slate-400">Loading router devtools...</p>
		</div>
	);
}

/**
 * A wrapper around TanStackRouterDevtoolsPanel that safely handles cases
 * where the router context is not yet available.
 *
 * This prevents "useRouter must be used inside a <RouterProvider> component"
 * warnings during SSR or initial hydration by:
 * 1. Only rendering on the client (after useEffect runs)
 * 2. Using lazy loading to defer the import
 */
export function SafeRouterDevtoolsPanel() {
	const [isClient, setIsClient] = useState(false);

	useEffect(() => {
		setIsClient(true);
	}, []);

	// Only render on client side after hydration is complete
	if (!isClient) {
		return <LoadingFallback />;
	}

	return (
		<Suspense fallback={<LoadingFallback />}>
			<TanStackRouterDevtoolsPanel />
		</Suspense>
	);
}
