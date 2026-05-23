import { unwrapResult, type UnwrappedValue } from "@/global/utils";
import { DashboardKeys } from "@/global/i18n";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { BarChart } from "@tremor/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { Clock } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { WidgetEmpty, WidgetError, WidgetLoading } from "../../components/WidgetStates";
import { registerWidget, type WidgetDescriptor, type WidgetProps } from "../registry";

export const ORDERS_BY_HOUR_TYPE = "ordersByHour";

const optionsSchema = z.object({});
type Options = z.infer<typeof optionsSchema>;

type Result = UnwrappedValue<FunctionReturnType<typeof api.analytics.ordersByHour.compute>>;

function OrdersByHourWidget({ context }: WidgetProps<Options>) {
	const { t } = useTranslation();
	const queryArgs =
		context.scopeKind === "restaurant" && context.restaurantId
			? {
					restaurantId: context.restaurantId as Id<"restaurants">,
					range: context.range,
				}
			: "skip";

	const query = useQuery({
		...convexQuery(api.analytics.ordersByHour.compute, queryArgs),
		select: unwrapResult<Result>,
	});

	const chartData = useMemo(
		() =>
			(query.data ?? []).map((row) => ({
				hour: `${row.hour.toString().padStart(2, "0")}h`,
				[t(DashboardKeys.WIDGET_ORDERS_BY_HOUR_AXIS)]: Number(row.averagePerDay.toFixed(2)),
			})),
		[query.data, t]
	);

	if (query.isPending && !query.data) return <WidgetLoading />;
	if (query.error) return <WidgetError error={query.error as Error} />;
	if (!query.data || query.data.every((row) => row.total === 0)) return <WidgetEmpty />;

	return (
		<BarChart
			className="h-full"
			data={chartData}
			index="hour"
			categories={[t(DashboardKeys.WIDGET_ORDERS_BY_HOUR_AXIS)]}
			colors={["blue"]}
			showLegend={false}
			showGridLines={false}
			yAxisWidth={32}
		/>
	);
}

export const ordersByHourDescriptor: WidgetDescriptor<Options> = registerWidget<Options>({
	type: ORDERS_BY_HOUR_TYPE,
	i18nLabelKey: DashboardKeys.WIDGET_ORDERS_BY_HOUR_LABEL,
	i18nDescriptionKey: DashboardKeys.WIDGET_ORDERS_BY_HOUR_DESCRIPTION,
	icon: Clock,
	requiredRole: "employee",
	portfolioCapable: false,
	supportsComparison: false,
	maxRangeDays: 92,
	defaultGrid: { w: 6, h: 4, minW: 3, minH: 3 },
	optionsSchema,
	defaultOptions: {},
	Component: OrdersByHourWidget,
});
