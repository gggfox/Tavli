import { unwrapQuery } from "@/global/utils";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";

export function useOrders(restaurantId: Id<"restaurants"> | undefined) {
	const { data: rawResult, isLoading } = useQuery(
		convexQuery(api.orders.getActiveOrdersByRestaurant, restaurantId ? { restaurantId } : "skip")
	);

	const orders = unwrapQuery(rawResult).data ?? [];

	const updateStatus = useMutation({
		mutationFn: useConvexMutation(api.orders.updateStatus),
	});

	return {
		orders,
		isLoading,
		updateStatus: updateStatus.mutateAsync,
	};
}
