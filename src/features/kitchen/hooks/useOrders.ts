import type { OrderDashboardPrepStationFilter, OrderDashboardStatusFilter } from "@/features";
import { useConvexMutate } from "@/global/hooks";
import { unwrapResult, type UnwrappedValue } from "@/global/utils";
import { convexQuery, useConvexAction } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import type { Id } from "convex/_generated/dataModel";

type ActiveOrdersValue = UnwrappedValue<
	FunctionReturnType<typeof api.orders.getActiveOrdersByRestaurant>
>;

export function useOrders(
	restaurantId: Id<"restaurants"> | undefined,
	statuses?: OrderDashboardStatusFilter[],
	prepStations?: OrderDashboardPrepStationFilter[]
) {
	const {
		data: orders = [],
		isLoading,
		error,
	} = useQuery({
		...convexQuery(
			api.orders.getActiveOrdersByRestaurant,
			restaurantId ? { restaurantId, statuses, prepStations } : "skip"
		),
		select: unwrapResult<ActiveOrdersValue>,
	});

	const updateStatus = useConvexMutate(api.orders.updateStatus);
	const markStationReady = useConvexMutate(api.orders.markStationReady);

	// Cancelling is an *action*, not a mutation — it calls Stripe — so it can't
	// go through `useConvexMutate`, which is typed for mutations.
	const cancelOrder = useMutation({
		mutationFn: useConvexAction(api.stripe.cancelOrderAndRefund),
	});

	return {
		orders,
		isLoading,
		error,
		updateStatus: updateStatus.mutateAsync,
		markStationReady: markStationReady.mutateAsync,
		cancelOrderAndRefund: cancelOrder.mutateAsync,
	};
}
