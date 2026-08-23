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
import { ChefHat, LayoutGrid, Wine, type LucideIcon } from "lucide-react";

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
	readonly icon: LucideIcon;
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
			solidFg: "var(--text-on-accent)",
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
			solidFg: "var(--text-on-accent)",
			tintedBg: "var(--station-bar-light)",
			fg: "var(--station-bar)",
			accentBorder: "var(--station-bar)",
		},
	},
};

export function isDashboardPrepStation(value: string): value is DashboardPrepStation {
	return value in STATION_CONFIG;
}

/** Sentinel for "don't filter by station" in the single-select station control. */
export const STATION_FILTER_ALL = "all";

/**
 * Value space of the dashboard's station segmented control: no filter, or
 * exactly one station.
 *
 * The persisted user setting stays an ARRAY (`orderDashboardPrepStationFilters`)
 * because that is what the orders query takes and what older clients wrote.
 * `stationFilterToValue` / `stationValueToFilters` are the only two places that
 * bridge the two shapes — a legacy both-stations-selected array collapses to
 * "all", which filters identically (every order has an item in some station).
 */
export type StationFilterValue = typeof STATION_FILTER_ALL | DashboardPrepStation;

/** Segment order of the station control. */
export const ALL_STATION_FILTER_VALUES: StationFilterValue[] = [
	STATION_FILTER_ALL,
	"kitchen",
	"bar",
];

export const STATION_FILTER_ICON: Record<StationFilterValue, LucideIcon> = {
	[STATION_FILTER_ALL]: LayoutGrid,
	kitchen: STATION_CONFIG.kitchen.icon,
	bar: STATION_CONFIG.bar.icon,
};

export const STATION_FILTER_LABEL_KEY: Record<StationFilterValue, string> = {
	[STATION_FILTER_ALL]: OrdersKeys.STATION_ALL,
	kitchen: STATION_CONFIG.kitchen.labelKey,
	bar: STATION_CONFIG.bar.labelKey,
};

export function stationFilterToValue(filters: readonly DashboardPrepStation[]): StationFilterValue {
	return filters.length === 1 ? filters[0] : STATION_FILTER_ALL;
}

export function stationValueToFilters(value: StationFilterValue): DashboardPrepStation[] {
	return value === STATION_FILTER_ALL ? [] : [value];
}
