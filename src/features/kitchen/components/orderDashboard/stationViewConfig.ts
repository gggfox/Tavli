/**
 * Render-mode configuration for the OrderDashboard.
 *
 * Selecting a prep station is only ever a FILTER — it narrows which orders
 * you see and never changes what the board is. Opening one station's rail of
 * `Station ticket`s (ADR 007) is this separate switch, because conflating the
 * two meant filtering to Kitchen on a closed status blanked the whole board.
 */
import type { OrderDashboardStationView } from "@/features";
import { OrdersKeys } from "@/global/i18n";
import { LayoutGrid, ReceiptText, type LucideIcon } from "lucide-react";

export type StationViewValue = OrderDashboardStationView;

/**
 * Cards is the default: it shows everything the filters selected, whatever the
 * status. The rail is the deliberate choice, not the accident.
 */
export const DEFAULT_STATION_VIEW: StationViewValue = "cards";

export const ALL_STATION_VIEWS: StationViewValue[] = ["cards", "tickets"];

export const STATION_VIEW_ICON: Record<StationViewValue, LucideIcon> = {
	cards: LayoutGrid,
	tickets: ReceiptText,
};

export const STATION_VIEW_LABEL_KEY: Record<StationViewValue, string> = {
	cards: OrdersKeys.VIEW_CARDS,
	tickets: OrdersKeys.VIEW_TICKETS,
};
