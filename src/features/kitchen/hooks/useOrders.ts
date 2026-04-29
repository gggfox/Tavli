import type { OrderDashboardStatusFilter } from "@/features";
import { useConvexMutate } from "@/global/hooks";
import { unwrapQuery } from "@/global/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";

export function useOrders(
	restaurantId: Id<"restaurants"> | undefined,
	statuses?: OrderDashboardStatusFilter[]
) {
	const { data: rawResult, isLoading } = useQuery(
		convexQuery(
			api.orders.getActiveOrdersByRestaurant,
			restaurantId ? { restaurantId, statuses } : "skip"
		)
	);

	const { data, error } = unwrapQuery(rawResult);
	const orders = data ?? [];

	const updateStatus = useConvexMutate(api.orders.updateStatus);

	return {
		orders,
		isLoading,
		error,
		updateStatus: updateStatus.mutateAsync,
	};
}
