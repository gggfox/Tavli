import { ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routerWithQueryClient } from "@tanstack/react-router-with-query";
import { ConvexReactClient } from "convex/react";
import { routeTree } from "./routeTree.gen";

export const convexClient = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL ?? "");

export function getRouter() {
	const convexQueryClient = new ConvexQueryClient(convexClient);

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
		}),
		queryClient
	);

	return router;
}
