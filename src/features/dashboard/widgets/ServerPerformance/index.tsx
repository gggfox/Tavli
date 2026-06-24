import { DashboardKeys } from "@/global/i18n";
import { unwrapResult, type UnwrappedValue } from "@/global/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { Trophy } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { WidgetExportButton } from "../../components/WidgetExportButton";
import { WidgetEmpty, WidgetError, WidgetLoading } from "../../components/WidgetStates";
import { registerWidget, type WidgetDescriptor, type WidgetProps } from "../registry";

export const SERVER_PERFORMANCE_TYPE = "serverPerformance";

const optionsSchema = z.object({});
type Options = z.infer<typeof optionsSchema>;

type Result = UnwrappedValue<FunctionReturnType<typeof api.analytics.serverPerformance.compute>>;

function ServerPerformanceWidget({ context }: WidgetProps<Options>) {
	const { t, i18n } = useTranslation();
	const queryArgs =
		context.scopeKind === "restaurant" && context.restaurantId
			? { restaurantId: context.restaurantId as Id<"restaurants">, range: context.range }
			: "skip";

	const query = useQuery({
		...convexQuery(api.analytics.serverPerformance.compute, queryArgs),
		select: unwrapResult<Result>,
	});

	const data = query.data;

	const money = useMemo(
		() =>
			new Intl.NumberFormat(i18n.language, {
				style: "currency",
				currency: context.currency ?? "USD",
				maximumFractionDigits: 0,
			}),
		[i18n.language, context.currency]
	);

	const maxSales = useMemo(() => Math.max(1, ...(data ?? []).map((r) => r.sales)), [data]);

	const exportRows = useMemo(
		() =>
			(data ?? []).map((r) => ({
				server: r.name,
				sales: r.sales,
				orders: r.orders,
				avgCheck: Number(r.avgCheck.toFixed(2)),
			})),
		[data]
	);

	if (query.isPending && !data) return <WidgetLoading />;
	if (query.error) return <WidgetError error={query.error as Error} />;
	if (!data || data.length === 0) return <WidgetEmpty />;

	return (
		<div className="h-full flex flex-col">
			<div className="flex items-center justify-end gap-2 h-4">
				<WidgetExportButton filename="server-performance" rows={exportRows} />
			</div>
			<div className="flex-1 overflow-auto mt-1">
				<table className="w-full text-sm">
					<thead>
						<tr className="text-[10px] uppercase tracking-wide text-faint-foreground text-left">
							<th className="font-medium py-1">
								{t(DashboardKeys.WIDGET_SERVER_PERFORMANCE_COL_SERVER)}
							</th>
							<th className="font-medium py-1">
								{t(DashboardKeys.WIDGET_SERVER_PERFORMANCE_COL_SALES)}
							</th>
							<th className="font-medium py-1 text-right">
								{t(DashboardKeys.WIDGET_SERVER_PERFORMANCE_COL_ORDERS)}
							</th>
							<th className="font-medium py-1 text-right">
								{t(DashboardKeys.WIDGET_SERVER_PERFORMANCE_COL_AVG_CHECK)}
							</th>
						</tr>
					</thead>
					<tbody>
						{data.map((row) => (
							<tr key={row.memberId} className="border-t border-(--border-default)">
								<td className="py-1 pr-2 truncate max-w-[8rem] text-foreground">{row.name}</td>
								<td className="py-1 pr-2 w-1/2">
									<div className="relative h-4 rounded bg-hover overflow-hidden">
										<div
											className="absolute inset-y-0 left-0 bg-blue-500/30 dark:bg-blue-400/25"
											style={{ width: `${(row.sales / maxSales) * 100}%` }}
										/>
										<span className="relative px-1 text-[11px] text-foreground tabular-nums">
											{money.format(row.sales)}
										</span>
									</div>
								</td>
								<td className="py-1 text-right tabular-nums text-faint-foreground">{row.orders}</td>
								<td className="py-1 text-right tabular-nums text-faint-foreground">
									{money.format(row.avgCheck)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

export const serverPerformanceDescriptor: WidgetDescriptor<Options> = registerWidget<Options>({
	type: SERVER_PERFORMANCE_TYPE,
	i18nLabelKey: DashboardKeys.WIDGET_SERVER_PERFORMANCE_LABEL,
	i18nDescriptionKey: DashboardKeys.WIDGET_SERVER_PERFORMANCE_DESCRIPTION,
	icon: Trophy,
	requiredRole: "manager",
	portfolioCapable: false,
	supportsComparison: false,
	maxRangeDays: 366,
	defaultGrid: { w: 6, h: 5, minW: 3, minH: 3 },
	optionsSchema,
	defaultOptions: {},
	Component: ServerPerformanceWidget,
});
