import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";

export function useOrders(restaurantId: Id<"restaurants"> | undefined) {
	const { data: rawResult, isLoading } = useQuery({
		...convexQuery(api.orders.getActiveOrdersByRestaurant, { restaurantId: restaurantId! }),
		enabled: !!restaurantId,
	});

	const orders = Array.isArray(rawResult) && rawResult[0] ? rawResult[0] : [];

	const updateStatus = useMutation({
		mutationFn: useConvexMutation(api.orders.updateStatus),
	});

	return {
		orders,
		isLoading,
		updateStatus: updateStatus.mutateAsync,
	};
}
