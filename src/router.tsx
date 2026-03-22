import { useAuthForConvex } from "@/features";
import { Config } from "@/global/utils/config";
import { ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routerWithQueryClient } from "@tanstack/react-router-with-query";
import { AuthKitProvider } from "@workos/authkit-tanstack-react-start/client";
import { ConvexProvider, ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";
import { routeTree } from "./routeTree.gen";

// Get config from singleton
const config = Config.instance;

// Conditional auth wrapper - only use AuthKitProvider when credentials are present

interface AuthWrapperProps {
	children: ReactNode;
	convexClient: ConvexReactClient;
}

/**
 * Inner component that uses the auth hooks.
 * Must be rendered inside AuthKitProvider.
 */
function ConvexAuthBridge({ children, convexClient }: Readonly<AuthWrapperProps>) {
	return (
		<ConvexProviderWithAuth client={convexClient} useAuth={useAuthForConvex}>
			{children}
		</ConvexProviderWithAuth>
	);
}

function AuthWrapper({ children, convexClient }: Readonly<AuthWrapperProps>) {
	if (config.hasWorkOSConfig) {
		return (
			<AuthKitProvider
				onSessionExpired={() => {
					// Redirect to sign-in when session expires
					globalThis.location.href = "/api/auth/signin";
				}}
			>
				<ConvexAuthBridge convexClient={convexClient}>{children}</ConvexAuthBridge>
			</AuthKitProvider>
		);
	}

	// Fallback: Convex without auth when WorkOS is not configured
	return <ConvexProvider client={convexClient}>{children}</ConvexProvider>;
}

// Create a new router instance
export function getRouter() {
	const convexQueryClient = new ConvexQueryClient(config.convexUrl);

	const queryClient: QueryClient = new QueryClient({
		defaultOptions: {
			queries: {
				queryKeyHashFn: convexQueryClient.hashFn(),
				queryFn: convexQueryClient.queryFn(),
			},
		},
	});
	convexQueryClient.connect(queryClient);

	const router = routerWithQueryClient(
		createRouter({
			routeTree,
			defaultPreload: "intent",
			context: { queryClient },
			scrollRestoration: true,
			defaultPreloadStaleTime: 0,
			Wrap: ({ children }) => (
				<AuthWrapper convexClient={convexQueryClient.convexClient}>{children}</AuthWrapper>
			),
		}),
		queryClient
	);

	return router;
}
