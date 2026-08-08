import { GeneralSection } from "@/features/restaurants/components/settings/GeneralSection";
import { HoursSection } from "@/features/restaurants/components/settings/HoursSection";
import { LocationSection } from "@/features/restaurants/components/settings/LocationSection";
import { ManagersSection } from "@/features/restaurants/components/settings/ManagersSection";
import { OrganizationSection } from "@/features/restaurants/components/settings/OrganizationSection";
import { PaymentsSection } from "@/features/restaurants/components/settings/PaymentsSection";
import { TaxInfoSection } from "@/features/restaurants/components/settings/TaxInfoSection";
import { RESTAURANT_SETTINGS_SECTION } from "@/features/restaurants/constants";
import {
	useRestaurantSettingsSave,
	type RestaurantSettingsPatch,
} from "@/features/restaurants/hooks/useRestaurantSettingsSave";
import { useCurrentUserRoles } from "@/features/users/hooks";
import { InlineError, StatusBadge } from "@/global/components";
import { useIsTabletPortraitViewport } from "@/global/hooks";
import { RestaurantsKeys } from "@/global/i18n";
import type { Doc, Id } from "convex/_generated/dataModel";
import { USER_ROLES } from "convex/constants";
import { ChevronLeft, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface RestaurantSettingsViewProps {
	readonly restaurant: Doc<"restaurants">;
	/** Org admins/owners see every section; managers get the operational ones. */
	readonly settingsAccess: "full" | "manager";
	readonly onClose: () => void;
	readonly onToggleActive?: (restaurantId: Id<"restaurants">) => void;
}

/**
 * Full-canvas restaurant settings, the `?settings=<id>` sibling of the
 * `?manage=<id>` tables canvas. Replaces the `size="lg"` edit modal that
 * stacked 15 fields, a Leaflet map, the managers picker and Stripe
 * onboarding into one scrolling dialog.
 *
 * Sections save independently (see `useRestaurantSettingsSave`): at this
 * height a single bottom-anchored submit would sit below the map, so the
 * save affordance lives with the fields it applies to.
 */
export function RestaurantSettingsView({
	restaurant,
	settingsAccess,
	onClose,
	onToggleActive,
}: Readonly<RestaurantSettingsViewProps>) {
	const { t } = useTranslation();
	const isTabletPortrait = useIsTabletPortraitViewport();
	const { roles } = useCurrentUserRoles();
	const isAdmin = roles.includes(USER_ROLES.ADMIN);
	const isFullAccess = settingsAccess === "full";

	const { save, savingSection, errorSection, error, savedSection, clearError } =
		useRestaurantSettingsSave(restaurant);
	const [sideEffectError, setSideEffectError] = useState<string | null>(null);

	const sectionProps = (
		section: (typeof RESTAURANT_SETTINGS_SECTION)[keyof typeof RESTAURANT_SETTINGS_SECTION]
	) => ({
		restaurant,
		onSave: (patch: RestaurantSettingsPatch) => save(section, patch),
		isSaving: savingSection === section,
		isSaved: savedSection === section,
		error: errorSection === section ? error : null,
		onDismissError: clearError,
	});

	return (
		<div className="rounded-xl bg-background border border-border min-h-[calc(100vh-12rem)] flex flex-col">
			<div className="sticky top-0 z-20 flex items-center justify-between gap-3 px-6 py-4 bg-background border-b border-border rounded-t-xl">
				<button
					type="button"
					onClick={onClose}
					className="flex items-center gap-1 px-2 py-1.5 rounded-md hover:bg-hover text-sm text-muted-foreground"
					title={t(RestaurantsKeys.SETTINGS_CLOSE)}
					aria-label={t(RestaurantsKeys.SETTINGS_CLOSE)}
				>
					<ChevronLeft size={16} />
				</button>
				<div className="flex items-center gap-3 min-w-0 flex-1">
					<h2 className="text-xl font-semibold text-foreground truncate">{restaurant.name}</h2>
					<StatusBadge
						bgColor={restaurant.isActive ? "var(--accent-success)" : "var(--bg-tertiary)"}
						textColor={restaurant.isActive ? "white" : "var(--text-muted)"}
						label={
							restaurant.isActive
								? t(RestaurantsKeys.LIST_STATUS_ACTIVE)
								: t(RestaurantsKeys.LIST_STATUS_INACTIVE)
						}
					/>
					{!isTabletPortrait && (
						<span className="text-xs text-faint-foreground">{restaurant.currency}</span>
					)}
				</div>
				<button
					type="button"
					onClick={onClose}
					className="p-1.5 rounded-md hover:bg-hover text-faint-foreground"
					title={t(RestaurantsKeys.SETTINGS_CLOSE)}
					aria-label={t(RestaurantsKeys.SETTINGS_CLOSE)}
				>
					<X size={20} />
				</button>
			</div>

			<div className="flex-1 px-4 py-4 sm:px-6 space-y-4 pb-16">
				{sideEffectError ? (
					<InlineError message={sideEffectError} onDismiss={() => setSideEffectError(null)} />
				) : null}

				<GeneralSection
					{...sectionProps(RESTAURANT_SETTINGS_SECTION.GENERAL)}
					onToggleActive={isFullAccess ? onToggleActive : undefined}
				/>

				<HoursSection
					{...sectionProps(RESTAURANT_SETTINGS_SECTION.HOURS)}
					canEditOrderNumberReset={isAdmin && isFullAccess}
				/>

				<LocationSection {...sectionProps(RESTAURANT_SETTINGS_SECTION.LOCATION)} />

				<TaxInfoSection {...sectionProps(RESTAURANT_SETTINGS_SECTION.TAX)} />

				{isFullAccess ? (
					<>
						<OrganizationSection {...sectionProps(RESTAURANT_SETTINGS_SECTION.ORGANIZATION)} />
						<ManagersSection restaurantId={restaurant._id} onError={setSideEffectError} />
						<PaymentsSection restaurant={restaurant} isAdmin={isAdmin} />
					</>
				) : null}
			</div>
		</div>
	);
}
