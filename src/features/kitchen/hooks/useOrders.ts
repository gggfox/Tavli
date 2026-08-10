import type {
	OrderDashboardPrepStationFilter,
	OrderDashboardServiceDateFilter,
	OrderDashboardStatusFilterValue,
} from "@/features";
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

type StatusCountsValue = UnwrappedValue<
	FunctionReturnType<typeof api.orders.getDashboardStatusCounts>
>;

/**
 * Card count per dashboard status segment, under the given station filter.
 *
 * Its own query rather than a field on `useOrders`: the dashboard fetches only
 * the ONE selected status (ADR 008), so the other five segments have nothing to
 * count from. Counts are decoration — a failure resolves to `undefined` and the
 * segments simply render without a number rather than taking the board down.
 */
export function useOrderStatusCounts(
	restaurantId: Id<"restaurants"> | undefined,
	prepStations?: OrderDashboardPrepStationFilter[],
	serviceDate?: OrderDashboardServiceDateFilter
) {
	const { data } = useQuery({
		...convexQuery(
			api.orders.getDashboardStatusCounts,
			restaurantId ? { restaurantId, prepStations, serviceDate } : "skip"
		),
		select: unwrapResult<StatusCountsValue>,
	});

	return data;
}

export function useOrders(
	restaurantId: Id<"restaurants"> | undefined,
	statuses?: OrderDashboardStatusFilterValue[],
	prepStations?: OrderDashboardPrepStationFilter[],
	serviceDate?: OrderDashboardServiceDateFilter
) {
	const {
		data: orders = [],
		isLoading,
		error,
	} = useQuery({
		...convexQuery(
			api.orders.getActiveOrdersByRestaurant,
			restaurantId ? { restaurantId, statuses, prepStations, serviceDate } : "skip"
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
