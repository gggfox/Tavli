import { RestaurantSettingsForm, useRestaurant } from "@/features/restaurants";
import { InlineError, LoadingState } from "@/global/components";
import { Outlet, createFileRoute, useMatches } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/admin/restaurant")({
	component: RestaurantLayout,
});

function RestaurantLayout() {
	const matches = useMatches();
	const isExactRoute = matches.length > 0 && matches.at(-1)?.pathname === "/admin/restaurant";

	return (
		<div
			className="h-full flex flex-col overflow-hidden"
			style={{ backgroundColor: "var(--bg-primary)" }}
		>
			{isExactRoute ? <RestaurantSettingsPage /> : <Outlet />}
		</div>
	);
}

function RestaurantSettingsPage() {
	const { restaurant, isLoading, create, update, toggleActive } = useRestaurant();
	const [error, setError] = useState<string | null>(null);

	const handleSave = async (data: {
		name: string;
		slug: string;
		description?: string;
		currency: string;
		timezone?: string;
	}) => {
		setError(null);
		try {
			if (restaurant) {
				await update({ restaurantId: restaurant._id, ...data });
			} else {
				await create(data);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to save restaurant");
		}
	};

	const handleToggleActive = async (restaurantId: Parameters<typeof toggleActive>[0]) => {
		setError(null);
		try {
			await toggleActive(restaurantId);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to toggle restaurant status");
		}
	};

	return (
		<div className="p-6 flex flex-col h-full">
			<div className="mb-6">
				<h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
					Restaurant Settings
				</h1>
				<p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
					{restaurant
						? "Manage your restaurant details."
						: "Set up your restaurant to get started."}
				</p>
			</div>
			{error && <InlineError message={error} onDismiss={() => setError(null)} className="mb-4" />}
			<div className="flex-1 overflow-y-auto">
				{isLoading ? (
					<LoadingState />
				) : (
					<RestaurantSettingsForm
						restaurant={restaurant}
						onSave={handleSave}
						onToggleActive={handleToggleActive}
					/>
				)}
			</div>
		</div>
	);
}
