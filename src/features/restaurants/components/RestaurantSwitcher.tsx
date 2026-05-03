import { RestaurantsKeys } from "@/global/i18n";
import type { Doc, Id } from "convex/_generated/dataModel";
import type { ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { useRestaurant } from "../RestaurantAdminScope";

export function RestaurantSwitcher() {
	const { t } = useTranslation();
	const { restaurant, restaurants, selectedRestaurantId, setSelectedRestaurantId, isMultiRestaurant, isLoading } =
		useRestaurant();

	if (!isMultiRestaurant || isLoading) return null;

	const onChange = (e: ChangeEvent<HTMLSelectElement>) => {
		setSelectedRestaurantId(e.target.value as Id<"restaurants">);
	};

	const sorted = [...restaurants].sort((a, b) => a.name.localeCompare(b.name));
	const effectiveId = selectedRestaurantId ?? restaurant?._id ?? "";

	return (
		<div className="px-3 py-2 border-b border-border">
			<label
				htmlFor="sidebar-restaurant-switcher"
				className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1"
			>
				{t(RestaurantsKeys.SWITCHER_LABEL)}
			</label>
			<select
				id="sidebar-restaurant-switcher"
				value={effectiveId}
				onChange={onChange}
				className="w-full px-2 py-1.5 rounded-md text-xs bg-muted border border-border text-foreground"
			>
				{sorted.map((r: Doc<"restaurants">) => (
					<option key={r._id} value={r._id}>
						{r.name}
					</option>
				))}
			</select>
		</div>
	);
}
