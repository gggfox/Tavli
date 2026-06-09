import { unwrapResult, type UnwrappedValue } from "@/global/utils";
import { DashboardKeys } from "@/global/i18n";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { LineChart } from "@tremor/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { TrendingUp } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { WidgetExportButton } from "../../components/WidgetExportButton";
import { WidgetEmpty, WidgetError, WidgetLoading } from "../../components/WidgetStates";
import { registerWidget, type WidgetDescriptor, type WidgetProps } from "../registry";

export const REVENUE_OVER_TIME_TYPE = "revenueOverTime";

const optionsSchema = z.object({});
type Options = z.infer<typeof optionsSchema>;

type Result = UnwrappedValue<FunctionReturnType<typeof api.analytics.revenueOverTime.compute>>;

function RevenueOverTimeWidget({ context }: WidgetProps<Options>) {
	const { t, i18n } = useTranslation();
	const queryArgs =
		context.scopeKind === "restaurant" && context.restaurantId
			? {
					scopeKind: "restaurant" as const,
					restaurantId: context.restaurantId as Id<"restaurants">,
					range: context.range,
					compareToPrev: context.compareToPrev,
				}
			: context.scopeKind === "portfolio"
				? {
						scopeKind: "portfolio" as const,
						range: context.range,
						compareToPrev: context.compareToPrev,
					}
				: "skip";

	const query = useQuery({
		...convexQuery(api.analytics.revenueOverTime.compute, queryArgs),
		select: unwrapResult<Result>,
	});

	const chartData = useMemo(() => {
		if (!query.data) return [];
		const currentByDate = new Map<string, number>(
			query.data.buckets.map((b) => [b.date, b.amount])
		);
		const prevByIndex = new Map<number, number>();
		if (query.data.previousBuckets) {
			query.data.previousBuckets.forEach((b, i) => prevByIndex.set(i, b.amount));
		}
		const sortedDates = [...currentByDate.keys()].sort();
		return sortedDates.map((date, i) => {
			const row: Record<string, string | number> = {
				date,
				[t(DashboardKeys.WIDGET_REVENUE_OVER_TIME_AXIS)]: currentByDate.get(date) ?? 0,
			};
			if (query.data?.previousBuckets) {
				row[t(DashboardKeys.WIDGET_DELTA_VS_PREV)] = prevByIndex.get(i) ?? 0;
			}
			return row;
		});
	}, [query.data, t]);

	if (query.isPending && !query.data) return <WidgetLoading />;
	if (query.error) return <WidgetError error={query.error as Error} />;
	if (!query.data || chartData.length === 0) return <WidgetEmpty />;

	const categories = [t(DashboardKeys.WIDGET_REVENUE_OVER_TIME_AXIS)];
	if (query.data.previousBuckets) {
		categories.push(t(DashboardKeys.WIDGET_DELTA_VS_PREV));
	}

	const exportRows = query.data.buckets.map((b) => ({ date: b.date, revenue: b.amount }));

	return (
		<div className="h-full flex flex-col">
			<div className="flex items-center justify-end h-4">
				<WidgetExportButton filename="revenue-over-time" rows={exportRows} />
			</div>
			<LineChart
				className="flex-1 mt-1"
				data={chartData}
				index="date"
				categories={categories}
				colors={["blue", "slate"]}
				valueFormatter={(v) =>
					new Intl.NumberFormat(i18n.language, {
						style: "currency",
						currency: query.data?.currency ?? "USD",
						maximumFractionDigits: 0,
					}).format(v)
				}
				showLegend={false}
				showGridLines={false}
				yAxisWidth={48}
			/>
		</div>
	);
}

export const revenueOverTimeDescriptor: WidgetDescriptor<Options> = registerWidget<Options>({
	type: REVENUE_OVER_TIME_TYPE,
	i18nLabelKey: DashboardKeys.WIDGET_REVENUE_OVER_TIME_LABEL,
	i18nDescriptionKey: DashboardKeys.WIDGET_REVENUE_OVER_TIME_DESCRIPTION,
	icon: TrendingUp,
	requiredRole: "manager",
	portfolioCapable: true,
	supportsComparison: true,
	maxRangeDays: 366,
	defaultGrid: { w: 6, h: 5, minW: 3, minH: 3 },
	optionsSchema,
	defaultOptions: {},
	Component: RevenueOverTimeWidget,
});
