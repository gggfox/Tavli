import { unwrapResult, type UnwrappedValue } from "@/global/utils";
import { DashboardKeys } from "@/global/i18n";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { SparkAreaChart } from "@tremor/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { ArrowDown, ArrowUp, Coins } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { WidgetEmpty, WidgetError, WidgetLoading } from "../../components/WidgetStates";
import { registerWidget, type WidgetDescriptor, type WidgetProps } from "../registry";

export const TIPS_TOTAL_TYPE = "tipsTotal";

const optionsSchema = z.object({});
type Options = z.infer<typeof optionsSchema>;

type Result = UnwrappedValue<
	FunctionReturnType<typeof api.analytics.tipsTotal.compute>
>;

function TipsTotalWidget({ context }: WidgetProps<Options>) {
	const { t, i18n } = useTranslation();
	const queryArgs =
		context.scopeKind === "restaurant" && context.restaurantId
			? {
					restaurantId: context.restaurantId as Id<"restaurants">,
					range: context.range,
					compareToPrev: context.compareToPrev,
				}
			: "skip";

	const query = useQuery({
		...convexQuery(api.analytics.tipsTotal.compute, queryArgs),
		select: unwrapResult<Result>,
	});

	const sparkData = useMemo(
		() =>
			(query.data?.buckets ?? []).map((b) => ({
				date: b.date,
				value: b.amountCents / 100,
			})),
		[query.data]
	);

	if (query.isPending && !query.data) return <WidgetLoading />;
	if (query.error) return <WidgetError error={query.error as Error} />;
	if (!query.data) return <WidgetEmpty />;

	const totalDollars = query.data.totalCents / 100;
	const formatted = new Intl.NumberFormat(i18n.language, {
		style: "currency",
		currency: "USD",
	}).format(totalDollars);

	let deltaNode: React.ReactNode = null;
	if (query.data.previousTotalCents !== null) {
		const previous = query.data.previousTotalCents;
		const diff = query.data.totalCents - previous;
		const pct = previous !== 0 ? diff / previous : null;
		const Icon = diff > 0 ? ArrowUp : diff < 0 ? ArrowDown : null;
		const tone =
			diff > 0
				? "text-emerald-600 dark:text-emerald-400"
				: diff < 0
					? "text-rose-600 dark:text-rose-400"
					: "text-faint-foreground";
		deltaNode = (
			<div className={`flex items-center gap-1 text-xs ${tone}`}>
				{Icon && <Icon size={12} />}
				<span>
					{pct !== null
						? `${(Math.abs(pct) * 100).toFixed(1)}%`
						: new Intl.NumberFormat(i18n.language, {
								style: "currency",
								currency: "USD",
							}).format(Math.abs(diff) / 100)}
				</span>
				<span className="text-faint-foreground">{t(DashboardKeys.WIDGET_DELTA_VS_PREV)}</span>
			</div>
		);
	}

	return (
		<div className="h-full flex flex-col justify-between gap-2">
			<div className="flex items-end gap-3">
				<span className="text-3xl font-semibold text-foreground tabular-nums">
					{formatted}
				</span>
			</div>
			{sparkData.length > 0 && (
				<SparkAreaChart
					data={sparkData}
					index="date"
					categories={["value"]}
					colors={["blue"]}
					className="h-12 w-full"
				/>
			)}
			{deltaNode}
		</div>
	);
}

export const tipsTotalDescriptor: WidgetDescriptor<Options> =
	registerWidget<Options>({
		type: TIPS_TOTAL_TYPE,
		i18nLabelKey: DashboardKeys.WIDGET_TIPS_TOTAL_LABEL,
		i18nDescriptionKey: DashboardKeys.WIDGET_TIPS_TOTAL_DESCRIPTION,
		icon: Coins,
		requiredRole: "manager",
		portfolioCapable: false,
		supportsComparison: true,
		maxRangeDays: 366,
		defaultGrid: { w: 3, h: 4, minW: 2, minH: 3 },
		optionsSchema,
		defaultOptions: {},
		Component: TipsTotalWidget,
	});
