/**
 * Side-effect import of every widget descriptor. The dashboard page imports
 * this barrel once so that all widgets are registered before the registry is
 * read for picker / render. New widgets only need a new line here + their
 * own module.
 */
export { busyTimesHeatmapDescriptor, BUSY_TIMES_HEATMAP_TYPE } from "./BusyTimesHeatmap";
export { numberWithDeltaDescriptor, NUMBER_WITH_DELTA_TYPE } from "./NumberWithDelta/descriptor";
export { ordersByHourDescriptor, ORDERS_BY_HOUR_TYPE } from "./OrdersByHour";
export { reservationsByStatusDescriptor, RESERVATIONS_BY_STATUS_TYPE } from "./ReservationsByStatus";
export { revenueOverTimeDescriptor, REVENUE_OVER_TIME_TYPE } from "./RevenueOverTime";
export { tableOccupancyDescriptor, TABLE_OCCUPANCY_TYPE } from "./TableOccupancy";
export { tipsTotalDescriptor, TIPS_TOTAL_TYPE } from "./TipsTotal";
export { topMenuItemsDescriptor, TOP_MENU_ITEMS_TYPE } from "./TopMenuItems";

export {
	getWidgetDescriptor,
	listWidgetDescriptors,
	registerWidget,
	safeParseOptions,
	userHasWidgetRole,
	type AnyWidgetDescriptor,
	type WidgetDescriptor,
	type WidgetProps,
	type WidgetRenderContext,
} from "./registry";
