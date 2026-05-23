import { TanStackDevtools, type TanStackDevtoolsReactInit } from "@tanstack/react-devtools";
import { useEffect, useState } from "react";

/**
 * A client-only wrapper for TanStack Devtools.
 *
 * This prevents SSR issues where router hooks are called before
 * the router context is available.
 */
export function ClientOnlyDevtools(props: TanStackDevtoolsReactInit) {
	const [isClient, setIsClient] = useState(false);

	useEffect(() => {
		setIsClient(true);
	}, []);

	// Don't render anything during SSR or initial hydration
	if (!isClient) {
		return null;
	}

	return <TanStackDevtools {...props} />;
}
