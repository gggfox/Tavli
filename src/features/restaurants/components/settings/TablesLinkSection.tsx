import { SettingsSection } from "@/features/restaurants/components/settings/SettingsSection";
import { RestaurantsKeys } from "@/global/i18n";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Tables live on their own full canvas (`?manage=<id>`, drag-and-drop floor
 * plan). Settings only points there, so a manager looking for "tables" under
 * Operations finds the way in instead of a dead end.
 */
export function TablesLinkSection({ onOpen }: Readonly<{ onOpen: () => void }>) {
	const { t } = useTranslation();
	return (
		<SettingsSection
			testId="settings-section-tables"
			title={t(RestaurantsKeys.SETTINGS_TABLES_TITLE)}
			hint={t(RestaurantsKeys.SETTINGS_TABLES_HINT)}
		>
			<button
				type="button"
				onClick={onOpen}
				className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-hover"
			>
				{t(RestaurantsKeys.SETTINGS_TABLES_OPEN)}
				<ChevronRight size={14} aria-hidden />
			</button>
		</SettingsSection>
	);
}
