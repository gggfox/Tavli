/**
 * Public types for the configurable dashboard feature.
 *
 * The Convex schema (`convex/schema.ts dashboardLayouts.config`) is the
 * authoritative shape; these types narrow the parts the frontend cares about.
 * Per-widget `options` are typed `unknown` here and parsed by each widget's
 * Zod schema in `widgets/registry.ts` before render.
 */
import type { Id } from "convex/_generated/dataModel";

export type DashboardScopeKind = "restaurant" | "portfolio";

export type DashboardRangeKind =
	| "today"
	| "week"
	| "month"
	| "quarter"
	| "year"
	| "custom";

export type DashboardCustomRange = { from: number; to: number };

export type DashboardWidgetGridPosition = {
	x: number;
	y: number;
	w: number;
	h: number;
};

export type DashboardWidgetDateRangeOverride = {
	kind: DashboardRangeKind;
	custom?: DashboardCustomRange;
};

export type DashboardWidgetInstance = {
	instanceId: string;
	widgetType: string;
	gridPosition: DashboardWidgetGridPosition;
	options: unknown;
	dateRangeOverride?: DashboardWidgetDateRangeOverride;
};

export type DashboardLayoutConfig = {
	globalDateRange: DashboardRangeKind;
	customRange?: DashboardCustomRange;
	compareToPrev: boolean;
	widgets: DashboardWidgetInstance[];
};

export type DashboardLayout = {
	_id: Id<"dashboardLayouts">;
	_creationTime: number;
	userId: string;
	scopeKind: DashboardScopeKind;
	restaurantId?: Id<"restaurants">;
	name: string;
	position: number;
	config: DashboardLayoutConfig;
	createdAt: number;
	updatedAt: number;
};

/** A scope-aware role identifier used by widget access gates. */
export type DashboardWidgetRole = "employee" | "manager" | "admin";

/** Resolved time window the widget should query for. */
export type ResolvedRange = { from: number; to: number };
