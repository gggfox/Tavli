/**
 * Service-day filter configuration for the OrderDashboard.
 *
 * A third orthogonal axis alongside status and prep station: WHEN the work
 * came in. "Today" is the restaurant's own business day (its configured
 * rollover, not midnight), so a ticket opened at 01:00 still belongs to the
 * night the staff is still working.
 */
import type { OrderDashboardServiceDateFilter } from "@/features";
import { OrdersKeys } from "@/global/i18n";
import { CalendarDays, CalendarRange, type LucideIcon } from "lucide-react";

export type ServiceDateFilterValue = OrderDashboardServiceDateFilter;

/**
 * "all" is the default for a user who never picked: it is what the board did
 * before the filter existed, so nobody loses sight of an old open ticket by
 * upgrading.
 */
export const DEFAULT_SERVICE_DATE: ServiceDateFilterValue = "all";

/** Segment order of the service-day control. */
export const ALL_SERVICE_DATE_VALUES: ServiceDateFilterValue[] = ["today", "all"];

export const SERVICE_DATE_ICON: Record<ServiceDateFilterValue, LucideIcon> = {
	today: CalendarDays,
	all: CalendarRange,
};

export const SERVICE_DATE_LABEL_KEY: Record<ServiceDateFilterValue, string> = {
	today: OrdersKeys.SERVICE_DATE_TODAY,
	all: OrdersKeys.SERVICE_DATE_ALL,
};
