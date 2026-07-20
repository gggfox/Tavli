import { RouteErrorComponent } from "@/global/components";
import { ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routerWithQueryClient } from "@tanstack/react-router-with-query";
import { convexClient } from "./convexClient";
import { routeTree } from "./routeTree.gen";

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
			// Every route gets a boundary for free. Routes only declare their
			// own `errorComponent` where recovery genuinely differs (see
			// `routes/admin.tsx` and `routes/r/$slug.tsx`); without this the
			// default was TanStack's bare stack-trace panel.
			defaultErrorComponent: RouteErrorComponent,
		}),
		queryClient
	);

	return router;
}
