import { DashboardKeys } from "@/global/i18n";
import { unwrapResult, type UnwrappedValue } from "@/global/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { DonutChart } from "@tremor/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { PieChart } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { SampleDataBadge } from "../../components/SampleDataBadge";
import { WidgetExportButton } from "../../components/WidgetExportButton";
import { WidgetEmpty, WidgetError, WidgetLoading } from "../../components/WidgetStates";
import { SOBER_CHART_COLORS } from "../../constants";
import { useWidgetData } from "../../hooks/useWidgetData";
import { registerWidget, type WidgetDescriptor, type WidgetProps } from "../registry";

export const ITEMS_BY_CATEGORY_TYPE = "itemsByCategory";

const optionsSchema = z.object({});
type Options = z.infer<typeof optionsSchema>;

type Result = UnwrappedValue<FunctionReturnType<typeof api.analytics.itemsByCategory.compute>>;

function ItemsByCategoryWidget({ context }: WidgetProps<Options>) {
	const { i18n } = useTranslation();
	const queryArgs =
		context.scopeKind === "restaurant" && context.restaurantId
			? { restaurantId: context.restaurantId as Id<"restaurants">, range: context.range }
			: "skip";

	const query = useQuery({
		...convexQuery(api.analytics.itemsByCategory.compute, queryArgs),
		select: unwrapResult<Result>,
	});

	const { data, isSample, isPending, error } = useWidgetData<Result>(
		ITEMS_BY_CATEGORY_TYPE,
		query,
		(d) => d.length === 0
	);

	const money = useMemo(
		() =>
			new Intl.NumberFormat(i18n.language, {
				style: "currency",
				currency: "USD",
				maximumFractionDigits: 0,
			}),
		[i18n.language]
	);

	const chartData = useMemo(
		() => (data ?? []).map((row) => ({ name: row.categoryName, value: row.revenue })),
		[data]
	);

	const exportRows = useMemo(
		() => (data ?? []).map((row) => ({ category: row.categoryName, revenue: row.revenue })),
		[data]
	);

	if (isPending && !data) return <WidgetLoading />;
	if (error) return <WidgetError error={error as Error} />;
	if (!data || chartData.length === 0) return <WidgetEmpty />;

	return (
		<div className="h-full flex flex-col">
			<div className="flex items-center justify-end gap-2 h-4">
				{isSample && <SampleDataBadge />}
				<WidgetExportButton filename="items-by-category" rows={exportRows} />
			</div>
			<DonutChart
				className="flex-1 mt-1"
				data={chartData}
				category="value"
				index="name"
				colors={[...SOBER_CHART_COLORS]}
				valueFormatter={(v) => money.format(v)}
				showAnimation={false}
			/>
		</div>
	);
}

export const itemsByCategoryDescriptor: WidgetDescriptor<Options> = registerWidget<Options>({
	type: ITEMS_BY_CATEGORY_TYPE,
	i18nLabelKey: DashboardKeys.WIDGET_ITEMS_BY_CATEGORY_LABEL,
	i18nDescriptionKey: DashboardKeys.WIDGET_ITEMS_BY_CATEGORY_DESCRIPTION,
	icon: PieChart,
	requiredRole: "employee",
	portfolioCapable: false,
	supportsComparison: false,
	maxRangeDays: 92,
	defaultGrid: { w: 4, h: 5, minW: 3, minH: 3 },
	optionsSchema,
	defaultOptions: {},
	Component: ItemsByCategoryWidget,
});
