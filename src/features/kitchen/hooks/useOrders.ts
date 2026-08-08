import type { OrderDashboardPrepStationFilter, OrderDashboardStatusFilterValue } from "@/features";
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
	statuses?: OrderDashboardStatusFilterValue[],
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
	const unmarkStationReady = useConvexMutate(api.orders.unmarkStationReady);
	const cancelOrderItem = useConvexMutate(api.orders.cancelOrderItem);
	// Staff collected cash for an `awaiting_payment` order (ADR 008). On
	// success the order flips to `submitted` server-side and the dashboard
	// updates through the live query — no manual refetch needed.
	const markOrderPaidInPerson = useConvexMutate(api.orders.markOrderPaidInPerson);

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
		unmarkStationReady: unmarkStationReady.mutateAsync,
		cancelOrderItem: cancelOrderItem.mutateAsync,
		markOrderPaidInPerson: markOrderPaidInPerson.mutateAsync,
		cancelOrderAndRefund: cancelOrder.mutateAsync,
	};
}
