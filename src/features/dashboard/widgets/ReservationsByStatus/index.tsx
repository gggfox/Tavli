import { unwrapResult, type UnwrappedValue } from "@/global/utils";
import { DashboardKeys, ReservationsKeys } from "@/global/i18n";
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
import { WidgetEmpty, WidgetError, WidgetLoading } from "../../components/WidgetStates";
import { registerWidget, type WidgetDescriptor, type WidgetProps } from "../registry";

export const RESERVATIONS_BY_STATUS_TYPE = "reservationsByStatus";

const optionsSchema = z.object({});
type Options = z.infer<typeof optionsSchema>;

type Result = UnwrappedValue<FunctionReturnType<typeof api.analytics.reservationsByStatus.compute>>;

const STATUS_LABEL_KEY: Record<string, string> = {
	pending: ReservationsKeys.STATUS_PENDING,
	confirmed: ReservationsKeys.STATUS_CONFIRMED,
	seated: ReservationsKeys.STATUS_SEATED,
	completed: ReservationsKeys.STATUS_COMPLETED,
	cancelled: ReservationsKeys.STATUS_CANCELLED,
	no_show: ReservationsKeys.STATUS_NO_SHOW,
};

function ReservationsByStatusWidget({ context }: WidgetProps<Options>) {
	const { t } = useTranslation();
	const queryArgs =
		context.scopeKind === "restaurant" && context.restaurantId
			? {
					restaurantId: context.restaurantId as Id<"restaurants">,
					range: context.range,
				}
			: "skip";

	const query = useQuery({
		...convexQuery(api.analytics.reservationsByStatus.compute, queryArgs),
		select: unwrapResult<Result>,
	});

	const chartData = useMemo(
		() =>
			(query.data ?? [])
				.filter((row) => row.count > 0)
				.map((row) => ({
					name: t(STATUS_LABEL_KEY[row.status] ?? row.status),
					value: row.count,
				})),
		[query.data, t]
	);

	if (query.isPending && !query.data) return <WidgetLoading />;
	if (query.error) return <WidgetError error={query.error as Error} />;
	if (chartData.length === 0) return <WidgetEmpty />;

	return (
		<DonutChart
			className="h-full"
			data={chartData}
			category="value"
			index="name"
			colors={["blue", "amber", "violet", "emerald", "rose", "gray"]}
			showLabel
			showAnimation={false}
		/>
	);
}

export const reservationsByStatusDescriptor: WidgetDescriptor<Options> = registerWidget<Options>({
	type: RESERVATIONS_BY_STATUS_TYPE,
	i18nLabelKey: DashboardKeys.WIDGET_RESERVATIONS_BY_STATUS_LABEL,
	i18nDescriptionKey: DashboardKeys.WIDGET_RESERVATIONS_BY_STATUS_DESCRIPTION,
	icon: PieChart,
	requiredRole: "employee",
	portfolioCapable: false,
	supportsComparison: false,
	maxRangeDays: 366,
	defaultGrid: { w: 4, h: 4, minW: 3, minH: 3 },
	optionsSchema,
	defaultOptions: {},
	Component: ReservationsByStatusWidget,
});
