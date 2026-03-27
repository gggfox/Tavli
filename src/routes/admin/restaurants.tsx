import { AdminRestaurantsList } from "@/features/restaurants";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/restaurants")({
	component: AdminRestaurantsPage,
});

function AdminRestaurantsPage() {
	return (
		<div className="p-6 flex flex-col h-full">
			<div className="mb-6">
				<h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
					All Restaurants
				</h1>
				<p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
					View and manage all restaurants in the system.
				</p>
			</div>
			<div className="flex-1 overflow-y-auto">
				<AdminRestaurantsList />
			</div>
		</div>
	);
}
