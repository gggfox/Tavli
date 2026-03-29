import { AdminRestaurantsList } from "@/features/restaurants";
import { AdminPageLayout } from "@/global/components";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/restaurants")({
	component: AdminRestaurantsPage,
});

function AdminRestaurantsPage() {
	return (
		<AdminPageLayout
			title="All Restaurants"
			description="View and manage all restaurants in the system."
		>
			<AdminRestaurantsList />
		</AdminPageLayout>
	);
}
