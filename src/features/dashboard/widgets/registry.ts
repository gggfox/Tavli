/**
 * Widget registry: every widget the dashboard can render.
 *
 * A descriptor declares everything the dashboard shell needs to know about
 * a widget without rendering it: i18n labels, icon, role gate,
 * portfolio-capability, comparison support, default grid size, options Zod
 * schema with defaults, and the React component to render.
 *
 * Adding a new widget = adding a new descriptor here and re-exporting from
 * `index.ts`. Convex queries live alongside the descriptor in
 * `convex/analytics/<widgetType>.ts`.
 */
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { z } from "zod";
import type { DashboardScopeKind, DashboardWidgetRole, ResolvedRange } from "../types";

export type WidgetRenderContext = {
	/** Active layout's scope. */
	scopeKind: DashboardScopeKind;
	/** Restaurant id for restaurant-scoped layouts (null for portfolio). */
	restaurantId: string | null;
	/**
	 * ISO currency code for formatting money in widgets. Restaurant scope: the
	 * restaurant's `currency`. Portfolio scope: the first restaurant's currency
	 * (best-effort, mirrors `revenueOverTime`). `null` falls back to "USD".
	 */
	currency: string | null;
	/** Resolved date range to query. */
	range: ResolvedRange;
	/** Comparison range (previous period of equal length) when enabled. */
	comparisonRange: ResolvedRange | null;
	/** Whether the layout requested compare-to-previous. */
	compareToPrev: boolean;
};

export type WidgetProps<TOptions> = {
	options: TOptions;
	context: WidgetRenderContext;
};

export type WidgetDescriptor<TOptions> = {
	type: string;
	i18nLabelKey: string;
	i18nDescriptionKey: string;
	icon: LucideIcon;
	requiredRole: DashboardWidgetRole;
	portfolioCapable: boolean;
	supportsComparison: boolean;
	maxRangeDays: number;
	defaultGrid: { w: number; h: number; minW?: number; minH?: number };
	optionsSchema: z.ZodType<TOptions>;
	defaultOptions: TOptions;
	Component: (props: WidgetProps<TOptions>) => ReactNode;
};

/** Type-erased descriptor for storing in the registry. */
export type AnyWidgetDescriptor = WidgetDescriptor<unknown>;

/** Internal mutable registry; public access goes through the helpers below. */
const REGISTRY = new Map<string, AnyWidgetDescriptor>();

export function registerWidget<TOptions>(
	descriptor: WidgetDescriptor<TOptions>
): WidgetDescriptor<TOptions> {
	REGISTRY.set(descriptor.type, descriptor as AnyWidgetDescriptor);
	return descriptor;
}

export function getWidgetDescriptor(type: string): AnyWidgetDescriptor | undefined {
	return REGISTRY.get(type);
}

export function listWidgetDescriptors(): AnyWidgetDescriptor[] {
	return [...REGISTRY.values()];
}

/**
 * Parse an `options` blob from a layout config against the widget's schema.
 * Returns the parsed options (or the descriptor's defaults on parse failure)
 * so a corrupt option blob doesn't crash the widget.
 */
export function safeParseOptions<TOptions>(
	descriptor: WidgetDescriptor<TOptions>,
	raw: unknown
): TOptions {
	const result = descriptor.optionsSchema.safeParse(raw);
	if (result.success) return result.data;
	return descriptor.defaultOptions;
}

/**
 * Whether the user's role list satisfies the widget's `requiredRole`. Uses the
 * standard hierarchy: admin > owner > manager > employee. The dashboard tab
 * receives the user's flat role list from `useCurrentUserRoles`.
 */
export function userHasWidgetRole(
	userRoles: ReadonlyArray<string>,
	required: DashboardWidgetRole
): boolean {
	if (userRoles.includes("admin")) return true;
	if (required === "admin") return userRoles.includes("admin");
	if (userRoles.includes("owner")) return true;
	if (required === "manager") return userRoles.includes("manager");
	return userRoles.includes("manager") || userRoles.includes("employee");
}
