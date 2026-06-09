/**
 * Dashboard feature constants: the sober chart palette TAVLI-2 asks for, and
 * the curated default "Business Summary" layout new users land on.
 */
import type { DashboardLayoutConfig } from "./types";

/**
 * Muted, professional chart colors (tremor named Tailwind colors). TAVLI-2:
 * "respect the platform's design and color palette, mainly using sober colors."
 */
export const SOBER_CHART_COLORS = ["blue", "slate", "stone", "zinc", "neutral", "gray"] as const;

/** Name of the curated default layout (also used as its tab title once saved). */
export const BUSINESS_SUMMARY_NAME = "Business Summary";

/**
 * Where dashboard error reports are routed (TAVLI-2: "redirect the user to an
 * email contact so they can submit a report"). TODO: confirm the real address
 * — this is a stub.
 */
export const SUPPORT_EMAIL = "support@tavli.app";

/**
 * The curated "Business Summary" dashboard from TAVLI-2: an owner/manager
 * at-a-glance view. Rendered for any user who has no saved layout, and
 * materialized as their own editable layout the moment they enter edit mode
 * (see `DashboardPage`). Versioned here in code — no DB seeding/migration.
 *
 * 12-column grid. Money / staff-performance widgets self-gate (manager+); plain
 * employees see those tiles in their error state, which is acceptable since the
 * audience is owner/manager.
 */
export const BUSINESS_SUMMARY_CONFIG: DashboardLayoutConfig = {
	globalDateRange: "month",
	compareToPrev: true,
	widgets: [
		// Row 1 — headline KPIs.
		{
			instanceId: "bs-total-sales",
			widgetType: "numberWithDelta",
			gridPosition: { x: 0, y: 0, w: 3, h: 3 },
			options: { metric: "payments.revenueTotal" },
		},
		{
			instanceId: "bs-order-count",
			widgetType: "numberWithDelta",
			gridPosition: { x: 3, y: 0, w: 3, h: 3 },
			options: { metric: "orders.count" },
		},
		{
			instanceId: "bs-reservations-today",
			widgetType: "numberWithDelta",
			gridPosition: { x: 6, y: 0, w: 3, h: 3 },
			options: { metric: "reservations.confirmed" },
			dateRangeOverride: { kind: "today" },
		},
		{
			instanceId: "bs-active-orders",
			widgetType: "activeOrders",
			gridPosition: { x: 9, y: 0, w: 3, h: 3 },
			options: {},
		},
		// Row 2 — value KPIs + tips.
		{
			instanceId: "bs-avg-check",
			widgetType: "numberWithDelta",
			gridPosition: { x: 0, y: 3, w: 3, h: 3 },
			options: { metric: "orders.avgCheck" },
		},
		{
			instanceId: "bs-avg-dish-value",
			widgetType: "numberWithDelta",
			gridPosition: { x: 3, y: 3, w: 3, h: 3 },
			options: { metric: "orders.avgDishValue" },
		},
		{
			instanceId: "bs-tips-total",
			widgetType: "tipsTotal",
			gridPosition: { x: 6, y: 3, w: 3, h: 3 },
			options: {},
		},
		{
			instanceId: "bs-covers",
			widgetType: "numberWithDelta",
			gridPosition: { x: 9, y: 3, w: 3, h: 3 },
			options: { metric: "covers" },
		},
		// Row 3 — comparative sales + category mix.
		{
			instanceId: "bs-revenue-over-time",
			widgetType: "revenueOverTime",
			gridPosition: { x: 0, y: 6, w: 8, h: 5 },
			options: {},
		},
		{
			instanceId: "bs-items-by-category",
			widgetType: "itemsByCategory",
			gridPosition: { x: 8, y: 6, w: 4, h: 5 },
			options: {},
		},
		// Row 4 — best sellers + server performance.
		{
			instanceId: "bs-top-menu-items",
			widgetType: "topMenuItems",
			gridPosition: { x: 0, y: 11, w: 4, h: 5 },
			options: { limit: 10 },
		},
		{
			instanceId: "bs-server-performance",
			widgetType: "serverPerformance",
			gridPosition: { x: 4, y: 11, w: 8, h: 5 },
			options: {},
		},
		// Row 5 — reservations breakdown.
		{
			instanceId: "bs-reservations-by-status",
			widgetType: "reservationsByStatus",
			gridPosition: { x: 0, y: 16, w: 6, h: 4 },
			options: {},
		},
	],
};
