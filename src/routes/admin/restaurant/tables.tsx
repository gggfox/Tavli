import { TablesManager, useRestaurant } from "@/features/restaurants";
import { LoadingState } from "@/global/components";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/restaurant/tables")({
	component: TablesPage,
});

function TablesPage() {
	const { restaurant, isLoading } = useRestaurant();

	return (
		<div className="p-6 flex flex-col h-full">
			<div className="mb-6">
				<h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
					Table Management
				</h1>
				<p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
					Add and manage your restaurant&apos;s tables. Each table gets a unique link for customers.
				</p>
			</div>
			<div className="flex-1 overflow-y-auto">
			{isLoading && <LoadingState />}
				{!isLoading && restaurant && <TablesManager restaurantId={restaurant._id} />}
				{!isLoading && !restaurant && (
					<p className="text-sm" style={{ color: "var(--text-muted)" }}>
						Please set up your restaurant first.
					</p>
				)}
			</div>
		</div>
	);
}
