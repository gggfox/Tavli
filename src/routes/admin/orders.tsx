import { OrderDashboard } from "@/features/kitchen";
import { useRestaurant } from "@/features/restaurants";
import { LoadingState } from "@/global/components";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/orders")({
	component: OrdersPage,
});

function OrdersPage() {
	const { restaurant, isLoading } = useRestaurant();

	if (isLoading) {
		return (
			<div className="p-6">
				<LoadingState />
			</div>
		);
	}

	if (!restaurant) {
		return (
			<div className="p-6">
				<p className="text-sm" style={{ color: "var(--text-muted)" }}>
					Please set up your restaurant first.
				</p>
			</div>
		);
	}

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
				<OrderDashboard restaurantId={restaurant._id} />
			</div>
		</div>
	);
}
