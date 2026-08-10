import { RestaurantManagersField } from "@/features/restaurants/components/RestaurantManagersField";
import type { Id } from "convex/_generated/dataModel";

interface ManagersSectionProps {
	readonly restaurantId: Id<"restaurants">;
	readonly onError: (message: string) => void;
}

/**
 * Manager assignment. `RestaurantManagersField` already renders its own
 * title, hint and per-toggle save, so this section is only the card shell --
 * wrapping it in `SettingsSection` would duplicate the heading.
 */
export function ManagersSection({ restaurantId, onError }: Readonly<ManagersSectionProps>) {
	return (
		<section
			data-testid="settings-section-managers"
			className="rounded-xl border border-border bg-muted/30 p-4 sm:p-6"
		>
			<RestaurantManagersField restaurantId={restaurantId} onError={onError} />
		</section>
	);
}
