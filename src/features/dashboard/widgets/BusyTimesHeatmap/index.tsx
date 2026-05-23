import { unwrapResult, type UnwrappedValue } from "@/global/utils";
import { DashboardKeys } from "@/global/i18n";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { Flame } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { WidgetEmpty, WidgetError, WidgetLoading } from "../../components/WidgetStates";
import { registerWidget, type WidgetDescriptor, type WidgetProps } from "../registry";

export const BUSY_TIMES_HEATMAP_TYPE = "busyTimesHeatmap";

const optionsSchema = z.object({});
type Options = z.infer<typeof optionsSchema>;

type Result = UnwrappedValue<FunctionReturnType<typeof api.analytics.busyTimesHeatmap.compute>>;

const DAY_LABEL_KEYS = [
	DashboardKeys.DAY_SUN,
	DashboardKeys.DAY_MON,
	DashboardKeys.DAY_TUE,
	DashboardKeys.DAY_WED,
	DashboardKeys.DAY_THU,
	DashboardKeys.DAY_FRI,
	DashboardKeys.DAY_SAT,
];

function BusyTimesHeatmapWidget({ context }: WidgetProps<Options>) {
	const { t } = useTranslation();
	const queryArgs =
		context.scopeKind === "restaurant" && context.restaurantId
			? {
					restaurantId: context.restaurantId as Id<"restaurants">,
					range: context.range,
				}
			: "skip";

	const query = useQuery({
		...convexQuery(api.analytics.busyTimesHeatmap.compute, queryArgs),
		select: unwrapResult<Result>,
	});

	const { matrix, max } = useMemo(() => {
		if (!query.data) return { matrix: null as number[][] | null, max: 0 };
		const m: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
		let mx = 0;
		for (const cell of query.data) {
			m[cell.dayOfWeek][cell.hour] = cell.count;
			if (cell.count > mx) mx = cell.count;
		}
		return { matrix: m, max: mx };
	}, [query.data]);

	if (query.isPending && !query.data) return <WidgetLoading />;
	if (query.error) return <WidgetError error={query.error as Error} />;
	if (!matrix || max === 0) return <WidgetEmpty />;

	return (
		<div className="h-full overflow-x-auto">
			<table className="w-full text-[10px] border-separate border-spacing-px">
				<thead>
					<tr>
						<th className="text-left text-faint-foreground font-normal" />
						{Array.from({ length: 24 }).map((_, h) => (
							<th key={h} className="text-center text-faint-foreground font-normal w-5">
								{h % 3 === 0 ? h : ""}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{matrix.map((row, dayIdx) => (
						<tr key={dayIdx}>
							<td className="text-faint-foreground pr-1 whitespace-nowrap">
								{t(DAY_LABEL_KEYS[dayIdx])}
							</td>
							{row.map((count, hour) => {
								const intensity = max > 0 ? count / max : 0;
								return (
									<td
										key={hour}
										title={`${t(DAY_LABEL_KEYS[dayIdx])} · ${hour
											.toString()
											.padStart(2, "0")}h · ${count}`}
										className="h-4 rounded-sm"
										style={{
											backgroundColor:
												intensity === 0
													? "var(--bg-hover)"
													: `rgba(59, 130, 246, ${0.15 + intensity * 0.85})`,
										}}
									/>
								);
							})}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

export const busyTimesHeatmapDescriptor: WidgetDescriptor<Options> = registerWidget<Options>({
	type: BUSY_TIMES_HEATMAP_TYPE,
	i18nLabelKey: DashboardKeys.WIDGET_BUSY_TIMES_HEATMAP_LABEL,
	i18nDescriptionKey: DashboardKeys.WIDGET_BUSY_TIMES_HEATMAP_DESCRIPTION,
	icon: Flame,
	requiredRole: "employee",
	portfolioCapable: false,
	supportsComparison: false,
	maxRangeDays: 92,
	defaultGrid: { w: 6, h: 4, minW: 3, minH: 3 },
	optionsSchema,
	defaultOptions: {},
	Component: BusyTimesHeatmapWidget,
});
