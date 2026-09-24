import { RestaurantManagersField } from "@/features/restaurants/components/RestaurantManagersField";
import { SettingsRow } from "@/features/restaurants/components/settings/SettingsRow";
import { SettingsSection } from "@/features/restaurants/components/settings/SettingsSection";
import { RestaurantsKeys } from "@/global/i18n";
import type { Id } from "convex/_generated/dataModel";
import { useTranslation } from "react-i18next";

interface ManagersSectionProps {
	readonly restaurantId: Id<"restaurants">;
	readonly onError: (message: string) => void;
}

/**
 * Manager assignment: one row, the current managers plus the picker that
 * changes them. There is no section save -- every toggle in the picker saves
 * on its own, so the card has no footer.
 */
export function ManagersSection({ restaurantId, onError }: Readonly<ManagersSectionProps>) {
	const { t } = useTranslation();
	return (
		<SettingsSection
			testId="settings-section-managers"
			title={t(RestaurantsKeys.SETTINGS_NAV_MANAGERS)}
			hint={t(RestaurantsKeys.MANAGERS_SECTION_HINT)}
		>
			<SettingsRow label={t(RestaurantsKeys.MANAGERS_SECTION_TITLE)}>
				<RestaurantManagersField restaurantId={restaurantId} onError={onError} />
			</SettingsRow>
		</SettingsSection>
	);
}
