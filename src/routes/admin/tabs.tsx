import { OpenTabsPanel } from "@/features/kitchen";
import { useRestaurant } from "@/features/restaurants";
import { AdminPageLayout } from "@/global/components";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/admin/tabs")({
	component: TabsPage,
});

function TabsPage() {
	const { restaurant, isLoading } = useRestaurant();

	return (
		<AdminPageLayout>
			{isLoading ? (
				<div className="flex items-center justify-center py-16">
					<Loader2 size={24} className="animate-spin text-faint-foreground" />
				</div>
			) : restaurant ? (
				<OpenTabsPanel restaurantId={restaurant._id} />
			) : (
				<p className="text-sm text-faint-foreground">Please set up your restaurant first.</p>
			)}
		</AdminPageLayout>
	);
}
