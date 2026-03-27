import { OptionGroupManager } from "@/features/options";
import { useRestaurant } from "@/features/restaurants";
import { LoadingState } from "@/global/components";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/options")({
	component: OptionsPage,
});

function OptionsPage() {
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
					Option Groups
				</h1>
				<p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
					Create reusable option groups (e.g. &quot;Meat Doneness&quot;, &quot;Side Dish&quot;) and
					link them to menu items.
				</p>
			</div>
			<div className="flex-1 overflow-y-auto">
				<OptionGroupManager restaurantId={restaurant._id} />
			</div>
		</div>
	);
}
