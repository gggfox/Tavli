import { unwrapResult, type UnwrappedValue } from "@/global/utils";
import { DashboardKeys } from "@/global/i18n";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { LineChart } from "@tremor/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { LayoutGrid } from "lucide-react";
import { useMemo } from "react";
import { z } from "zod";
import { WidgetEmpty, WidgetError, WidgetLoading } from "../../components/WidgetStates";
import { registerWidget, type WidgetDescriptor, type WidgetProps } from "../registry";

export const TABLE_OCCUPANCY_TYPE = "tableOccupancy";

const optionsSchema = z.object({});
type Options = z.infer<typeof optionsSchema>;

type Result = UnwrappedValue<FunctionReturnType<typeof api.analytics.tableOccupancy.compute>>;

function TableOccupancyWidget({ context }: WidgetProps<Options>) {
	const queryArgs =
		context.scopeKind === "restaurant" && context.restaurantId
			? {
					restaurantId: context.restaurantId as Id<"restaurants">,
					range: context.range,
				}
			: "skip";

	const query = useQuery({
		...convexQuery(api.analytics.tableOccupancy.compute, queryArgs),
		select: unwrapResult<Result>,
	});

	const chartData = useMemo(
		() =>
			(query.data ?? []).map((row) => ({
				hour: `${row.hour.toString().padStart(2, "0")}h`,
				avg: Number(row.averageTables.toFixed(2)),
			})),
		[query.data]
	);

	if (query.isPending && !query.data) return <WidgetLoading />;
	if (query.error) return <WidgetError error={query.error as Error} />;
	if (!query.data || query.data.every((row) => row.averageTables === 0)) return <WidgetEmpty />;

	return (
		<LineChart
			className="h-full"
			data={chartData}
			index="hour"
			categories={["avg"]}
			colors={["emerald"]}
			showLegend={false}
			showGridLines={false}
			yAxisWidth={32}
		/>
	);
}

export const tableOccupancyDescriptor: WidgetDescriptor<Options> = registerWidget<Options>({
	type: TABLE_OCCUPANCY_TYPE,
	i18nLabelKey: DashboardKeys.WIDGET_TABLE_OCCUPANCY_LABEL,
	i18nDescriptionKey: DashboardKeys.WIDGET_TABLE_OCCUPANCY_DESCRIPTION,
	icon: LayoutGrid,
	requiredRole: "employee",
	portfolioCapable: false,
	supportsComparison: false,
	maxRangeDays: 92,
	defaultGrid: { w: 6, h: 4, minW: 3, minH: 3 },
	optionsSchema,
	defaultOptions: {},
	Component: TableOccupancyWidget,
});
