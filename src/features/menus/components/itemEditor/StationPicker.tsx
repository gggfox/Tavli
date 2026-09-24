import { MenusKeys } from "@/global/i18n";
import { PREP_STATION } from "convex/constants";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PrepStation } from "../../hooks/useMenuItemDraft";

/** Station colours come from the theme's `--station-*` tokens (kitchen orange, bar violet). */
export const STATION_STYLE: Record<PrepStation, { dot: string; chip: string; labelKey: string }> = {
	[PREP_STATION.KITCHEN]: {
		dot: "bg-[var(--station-kitchen)]",
		chip: "bg-[var(--station-kitchen-light)] text-[var(--station-kitchen)]",
		labelKey: MenusKeys.ITEM_PREP_STATION_KITCHEN,
	},
	[PREP_STATION.BAR]: {
		dot: "bg-[var(--station-bar)]",
		chip: "bg-[var(--station-bar-light)] text-[var(--station-bar)]",
		labelKey: MenusKeys.ITEM_PREP_STATION_BAR,
	},
};

/**
 * Kitchen / bar. The selected segment takes its station's own colour, a ring
 * and a check, so it reads as selected at a glance (the neutral segmented
 * control lacked contrast against the editor surface).
 */
export function StationPicker({
	value,
	onChange,
}: Readonly<{ value: PrepStation; onChange: (station: PrepStation) => void }>) {
	const { t } = useTranslation();
	return (
		<div
			role="radiogroup"
			aria-label={t(MenusKeys.ITEM_PREP_STATION_LABEL)}
			className="inline-flex gap-1 rounded-lg p-1 ring-1 ring-border-strong"
		>
			{[PREP_STATION.KITCHEN, PREP_STATION.BAR].map((station) => {
				const style = STATION_STYLE[station];
				const selected = value === station;
				return (
					<button
						key={station}
						type="button"
						role="radio"
						aria-checked={selected}
						onClick={() => onChange(station)}
						className={`flex h-9 items-center gap-1.5 rounded-md px-3.5 text-sm font-medium transition-colors md:h-8 md:text-xs ${
							selected
								? `${style.chip} ring-1 ring-current`
								: "text-muted-foreground hover:bg-hover hover:text-foreground"
						}`}
					>
						{selected ? (
							<Check size={14} strokeWidth={2.5} aria-hidden />
						) : (
							<span aria-hidden className={`h-2 w-2 rounded-full ${style.dot}`} />
						)}
						{t(style.labelKey)}
					</button>
				);
			})}
		</div>
	);
}
