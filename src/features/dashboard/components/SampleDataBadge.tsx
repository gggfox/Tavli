/**
 * Small chip shown inside a widget body when it is rendering dev-only sample
 * data (see `useWidgetData`). Deliberately high-contrast/amber so sample
 * figures can never be mistaken for real ones.
 */
import { DashboardKeys } from "@/global/i18n";
import { useTranslation } from "react-i18next";

export function SampleDataBadge() {
	const { t } = useTranslation();
	return (
		<span
			className="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
			title={t(DashboardKeys.WIDGET_SAMPLE_DATA_TOOLTIP)}
		>
			{t(DashboardKeys.WIDGET_SAMPLE_DATA_BADGE)}
		</span>
	);
}
