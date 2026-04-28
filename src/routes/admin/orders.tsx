import { OrderDashboard, OrderDashboardSkeleton } from "@/features/kitchen";
import { useRestaurant } from "@/features/restaurants";
import { createFileRoute } from "@tanstack/react-router";
import type { Id } from "convex/_generated/dataModel";

export const Route = createFileRoute("/admin/orders")({
	component: OrdersPage,
});

function OrdersPage() {
	const { restaurant, isLoading } = useRestaurant();

	return (
		<div className="p-6 flex flex-col h-full">
			<div className="mb-6">
				<h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
					Orders
				</h1>
				<p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
					Live order dashboard. Orders update in real time.
				</p>
			</div>
			<div className="flex-1 overflow-y-auto">
				<OrdersContent restaurantId={restaurant?._id} isLoading={isLoading} />
			</div>
		</div>
	);
}

function OrdersContent({
	restaurantId,
	isLoading,
}: Readonly<{ restaurantId: Id<"restaurants"> | undefined; isLoading: boolean }>) {
	if (isLoading) return <OrderDashboardSkeleton />;
	if (!restaurantId) {
		return (
			<p className="text-sm" style={{ color: "var(--text-muted)" }}>
				Please set up your restaurant first.
			</p>
		);
	}
	return <OrderDashboard restaurantId={restaurantId} />;
}
