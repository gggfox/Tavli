import { unwrapResult } from "@/global/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";

interface UsePaymentsArgs {
	restaurantId: Id<"restaurants"> | undefined;
	from?: number;
	to?: number;
}

type PaidOrdersValue = {
	orders: Array<unknown>;
	totalRevenue: number;
	orderCount: number;
};

export function usePayments({ restaurantId, from, to }: UsePaymentsArgs) {
	const { data, isLoading, error } = useQuery({
		...convexQuery(
			api.orders.getPaidOrdersByRestaurant,
			restaurantId ? { restaurantId, from, to } : "skip"
		),
		select: unwrapResult<PaidOrdersValue>,
	});

	return {
		orders: data?.orders ?? [],
		totalRevenue: data?.totalRevenue ?? 0,
		orderCount: data?.orderCount ?? 0,
		isLoading,
		error,
	};
}
