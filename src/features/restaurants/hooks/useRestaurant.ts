import { unwrapQuery, unwrapResult } from "@/global/utils";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";

export function useRestaurant() {
	const { data: rawResult, isLoading } = useQuery(convexQuery(api.restaurants.getByOwner, {}));

	const restaurants = unwrapQuery(rawResult).data ?? [];

	const restaurant = restaurants[0] ?? null;

	const createMutation = useMutation({
		mutationFn: useConvexMutation(api.restaurants.create),
	});

	const updateMutation = useMutation({
		mutationFn: useConvexMutation(api.restaurants.update),
	});

	const toggleActiveMutation = useMutation({
		mutationFn: useConvexMutation(api.restaurants.toggleActive),
	});

	return {
		restaurant,
		restaurants,
		isLoading,
		create: async (args: Parameters<typeof createMutation.mutateAsync>[0]) =>
			unwrapResult(await createMutation.mutateAsync(args)),
		update: async (args: Parameters<typeof updateMutation.mutateAsync>[0]) =>
			unwrapResult(await updateMutation.mutateAsync(args)),
		toggleActive: async (restaurantId: Id<"restaurants">) =>
			unwrapResult(await toggleActiveMutation.mutateAsync({ restaurantId })),
	};
}
