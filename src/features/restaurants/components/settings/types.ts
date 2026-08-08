import type { RestaurantSettingsPatch } from "@/features/restaurants/hooks/useRestaurantSettingsSave";
import type { Doc } from "convex/_generated/dataModel";

/**
 * Props every self-saving section of the restaurant settings canvas takes.
 * The parent view owns the mutation (see `useRestaurantSettingsSave`) and
 * hands each section only its own slice of pending / error state.
 */
export interface RestaurantSettingsSectionProps {
	readonly restaurant: Doc<"restaurants">;
	/** Resolves `true` when the patch persisted, so the form can reset dirty. */
	readonly onSave: (patch: RestaurantSettingsPatch) => Promise<boolean>;
	readonly isSaving: boolean;
	readonly isSaved: boolean;
	readonly error: string | null;
	readonly onDismissError: () => void;
}
