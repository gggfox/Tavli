/**
 * Prep-station configuration for the OrderDashboard.
 *
 * Mirrors the shape of `statusConfig.ts` but for the orthogonal "where is
 * this prepared?" axis. Stations are NOT statuses — they don't progress
 * through a state machine, they just label items so the dashboard can
 * filter / highlight per-station. See ADR 005.
 */
import type { OrderDashboardPrepStationFilter } from "@/features";
import { OrdersKeys } from "@/global/i18n";
import { ChefHat, Wine } from "lucide-react";
import type { ComponentType } from "react";

export type DashboardPrepStation = OrderDashboardPrepStationFilter;

export interface StationVisual {
	/** Saturated fill used for active filter chips. */
	readonly solidBg: string;
	/** Foreground color used on top of `solidBg`. */
	readonly solidFg: string;
	/** Subtle tinted fill for highlighted item rows + inactive chips. */
	readonly tintedBg: string;
	/** Foreground color used on top of `tintedBg`. */
	readonly fg: string;
	/** Border accent (typically rendered as a left-border on item rows). */
	readonly accentBorder: string;
}

export interface StationConfig {
	readonly labelKey: string;
	readonly readyActionKey: string;
	readonly icon: ComponentType<{ size?: number; className?: string }>;
	readonly visual: StationVisual;
}

/**
 * Per-station visual + label config. The CSS variables resolve to the
 * tones declared in `src/global/styles/theme.css` (`--station-kitchen*`,
 * `--station-bar*`); both the light and dark themes provide values, so
 * this map never needs to branch on theme at the JS level.
 */
export const STATION_CONFIG: Record<DashboardPrepStation, StationConfig> = {
	kitchen: {
		labelKey: OrdersKeys.STATION_KITCHEN,
		readyActionKey: OrdersKeys.ACTION_MARK_KITCHEN_READY,
		icon: ChefHat,
		visual: {
			solidBg: "var(--station-kitchen)",
			solidFg: "#ffffff",
			tintedBg: "var(--station-kitchen-light)",
			fg: "var(--station-kitchen)",
			accentBorder: "var(--station-kitchen)",
		},
	},
	bar: {
		labelKey: OrdersKeys.STATION_BAR,
		readyActionKey: OrdersKeys.ACTION_MARK_BAR_READY,
		icon: Wine,
		visual: {
			solidBg: "var(--station-bar)",
			solidFg: "#ffffff",
			tintedBg: "var(--station-bar-light)",
			fg: "var(--station-bar)",
			accentBorder: "var(--station-bar)",
		},
	},
};

export const ALL_PREP_STATIONS: DashboardPrepStation[] = ["kitchen", "bar"];

export function isDashboardPrepStation(value: string): value is DashboardPrepStation {
	return value in STATION_CONFIG;
}
