import { unwrapResult, type UnwrappedValue } from "@/global/utils";
import { DashboardKeys } from "@/global/i18n";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { Activity } from "lucide-react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { SampleDataBadge } from "../../components/SampleDataBadge";
import { WidgetEmpty, WidgetError, WidgetLoading } from "../../components/WidgetStates";
import { useWidgetData } from "../../hooks/useWidgetData";
import { registerWidget, type WidgetDescriptor, type WidgetProps } from "../registry";

export const ACTIVE_ORDERS_TYPE = "activeOrders";

const optionsSchema = z.object({});
type Options = z.infer<typeof optionsSchema>;

type Result = UnwrappedValue<FunctionReturnType<typeof api.analytics.activeOrders.compute>>;

function ActiveOrdersWidget({ context }: WidgetProps<Options>) {
	const { t, i18n } = useTranslation();
	const queryArgs =
		context.scopeKind === "restaurant" && context.restaurantId
			? { restaurantId: context.restaurantId as Id<"restaurants"> }
			: "skip";

	const query = useQuery({
		...convexQuery(api.analytics.activeOrders.compute, queryArgs),
		select: unwrapResult<Result>,
	});

	const { data, isSample, isPending, error } = useWidgetData<Result>(
		ACTIVE_ORDERS_TYPE,
		query,
		(d) => d.seatedTables === 0 && d.activeOrderCount === 0
	);

	if (isPending && !data) return <WidgetLoading />;
	if (error) return <WidgetError error={error as Error} />;
	if (!data) return <WidgetEmpty />;

	const money = new Intl.NumberFormat(i18n.language, {
		style: "currency",
		currency: "USD",
	}).format(data.activeOrderValue);

	return (
		<div className="h-full flex flex-col">
			<div className="flex items-center justify-end h-4">{isSample && <SampleDataBadge />}</div>
			<div className="flex-1 grid grid-cols-2 gap-3 content-center">
				<Stat
					label={t(DashboardKeys.WIDGET_ACTIVE_ORDERS_SEATED)}
					value={String(data.seatedTables)}
				/>
				<Stat
					label={t(DashboardKeys.WIDGET_ACTIVE_ORDERS_ACTIVE)}
					value={String(data.activeOrderCount)}
				/>
				<div className="col-span-2">
					<Stat label={t(DashboardKeys.WIDGET_ACTIVE_ORDERS_VALUE)} value={money} />
				</div>
			</div>
		</div>
	);
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex flex-col">
			<span className="text-xs uppercase tracking-wide text-faint-foreground">{label}</span>
			<span className="text-2xl font-semibold text-foreground tabular-nums">{value}</span>
		</div>
	);
}

export const activeOrdersDescriptor: WidgetDescriptor<Options> = registerWidget<Options>({
	type: ACTIVE_ORDERS_TYPE,
	i18nLabelKey: DashboardKeys.WIDGET_ACTIVE_ORDERS_LABEL,
	i18nDescriptionKey: DashboardKeys.WIDGET_ACTIVE_ORDERS_DESCRIPTION,
	icon: Activity,
	requiredRole: "employee",
	portfolioCapable: false,
	supportsComparison: false,
	maxRangeDays: 366,
	defaultGrid: { w: 3, h: 3, minW: 2, minH: 2 },
	optionsSchema,
	defaultOptions: {},
	Component: ActiveOrdersWidget,
});
