import { unwrapResult, type UnwrappedValue } from "@/global/utils";
import { DashboardKeys } from "@/global/i18n";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { ListOrdered } from "lucide-react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { WidgetEmpty, WidgetError, WidgetLoading } from "../../components/WidgetStates";
import { registerWidget, type WidgetDescriptor, type WidgetProps } from "../registry";

export const TOP_MENU_ITEMS_TYPE = "topMenuItems";

const optionsSchema = z.object({
	limit: z.union([z.literal(5), z.literal(10), z.literal(20)]),
});

type Options = z.infer<typeof optionsSchema>;

type Result = UnwrappedValue<
	FunctionReturnType<typeof api.analytics.topMenuItems.compute>
>;

function TopMenuItemsWidget({ options, context }: WidgetProps<Options>) {
	const { t } = useTranslation();
	const queryArgs =
		context.scopeKind === "restaurant" && context.restaurantId
			? {
					restaurantId: context.restaurantId as Id<"restaurants">,
					range: context.range,
					limit: options.limit,
				}
			: "skip";

	const query = useQuery({
		...convexQuery(api.analytics.topMenuItems.compute, queryArgs),
		select: unwrapResult<Result>,
	});

	if (query.isPending && !query.data) return <WidgetLoading />;
	if (query.error) return <WidgetError error={query.error as Error} />;
	if (!query.data || query.data.length === 0) return <WidgetEmpty />;

	return (
		<ol className="space-y-1.5">
			{query.data.map((row, i) => (
				<li
					key={row.menuItemId}
					className="flex items-center justify-between gap-2 text-sm"
				>
					<span className="flex items-center gap-2 min-w-0">
						<span className="text-faint-foreground tabular-nums w-5 text-right">
							{i + 1}.
						</span>
						<span className="truncate text-foreground">{row.menuItemName}</span>
					</span>
					<span className="text-xs text-faint-foreground shrink-0">
						{t(DashboardKeys.WIDGET_TOP_MENU_ITEMS_QUANTITY, { count: row.quantity })}
					</span>
				</li>
			))}
		</ol>
	);
}

export const topMenuItemsDescriptor: WidgetDescriptor<Options> =
	registerWidget<Options>({
		type: TOP_MENU_ITEMS_TYPE,
		i18nLabelKey: DashboardKeys.WIDGET_TOP_MENU_ITEMS_LABEL,
		i18nDescriptionKey: DashboardKeys.WIDGET_TOP_MENU_ITEMS_DESCRIPTION,
		icon: ListOrdered,
		requiredRole: "employee",
		portfolioCapable: false,
		supportsComparison: false,
		maxRangeDays: 92,
		defaultGrid: { w: 3, h: 5, minW: 2, minH: 3 },
		optionsSchema,
		defaultOptions: { limit: 10 },
		Component: TopMenuItemsWidget,
	});
