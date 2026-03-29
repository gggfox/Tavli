import { unwrapQuery } from "@/global/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";

interface UsePaymentsArgs {
	restaurantId: Id<"restaurants"> | undefined;
	from?: number;
	to?: number;
}

export function usePayments({ restaurantId, from, to }: UsePaymentsArgs) {
	const { data: rawResult, isLoading } = useQuery(
		convexQuery(
			api.orders.getPaidOrdersByRestaurant,
			restaurantId ? { restaurantId, from, to } : "skip"
		)
	);

	const { data, error } = unwrapQuery(rawResult);
	const orders = data?.orders ?? [];
	const totalRevenue = data?.totalRevenue ?? 0;
	const orderCount = data?.orderCount ?? 0;

	return {
		orders,
		totalRevenue,
		orderCount,
		isLoading,
		error,
	};
}
