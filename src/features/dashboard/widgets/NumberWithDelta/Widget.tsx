import { DashboardKeys } from "@/global/i18n";
import { unwrapResult, type UnwrappedValue } from "@/global/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { WidgetEmpty, WidgetError, WidgetLoading } from "../../components/WidgetStates";
import type { WidgetProps } from "../registry";
import type { NumberWithDeltaOptions } from "./schema";
import { METRIC_LABEL_KEY } from "./schema";

type NumberWithDeltaResult = UnwrappedValue<
	FunctionReturnType<typeof api.analytics.numberWithDelta.compute>
>;

const MONEY_METRICS = new Set<NumberWithDeltaOptions["metric"]>([
	"payments.revenueTotal",
	"orders.avgDishValue",
	"orders.avgCheck",
]);

export function NumberWithDeltaWidget({ options, context }: WidgetProps<NumberWithDeltaOptions>) {
	const { t, i18n } = useTranslation();
	const queryArgs =
		context.scopeKind === "restaurant" && context.restaurantId
			? {
					scopeKind: "restaurant" as const,
					restaurantId: context.restaurantId as Id<"restaurants">,
					metric: options.metric,
					range: context.range,
					compareToPrev: context.compareToPrev,
				}
			: context.scopeKind === "portfolio"
				? {
						scopeKind: "portfolio" as const,
						metric: options.metric,
						range: context.range,
						compareToPrev: context.compareToPrev,
					}
				: "skip";

	const query = useQuery({
		...convexQuery(api.analytics.numberWithDelta.compute, queryArgs),
		select: unwrapResult<NumberWithDeltaResult>,
	});

	const data = query.data;

	if (query.isPending && !data) return <WidgetLoading />;
	if (query.error) return <WidgetError error={query.error as Error} />;
	if (!data) return <WidgetEmpty />;

	const currency = context.currency ?? "USD";
	const isMoney = MONEY_METRICS.has(options.metric);
	const formatted = isMoney
		? formatMoney(data.current, i18n.language, currency)
		: formatNumber(data.current, i18n.language);

	const deltaPct = data.deltaPct;
	const deltaAbs = data.deltaAbs;

	let deltaNode: React.ReactNode = null;
	if (deltaPct !== null) {
		const up = deltaPct > 0;
		const down = deltaPct < 0;
		const Icon = up ? ArrowUp : down ? ArrowDown : null;
		const tone = up
			? "text-emerald-600 dark:text-emerald-400"
			: down
				? "text-rose-600 dark:text-rose-400"
				: "text-faint-foreground";
		deltaNode = (
			<div className={`flex items-center gap-1 text-xs ${tone}`}>
				{Icon && <Icon size={12} />}
				<span>{(Math.abs(deltaPct) * 100).toFixed(1)}%</span>
				<span className="text-faint-foreground">{t(DashboardKeys.WIDGET_DELTA_VS_PREV)}</span>
			</div>
		);
	} else if (deltaAbs !== null) {
		deltaNode = (
			<div className="text-xs text-faint-foreground">
				{deltaAbs > 0 ? "+" : ""}
				{isMoney
					? formatMoney(deltaAbs, i18n.language, currency)
					: formatNumber(deltaAbs, i18n.language)}{" "}
				{t(DashboardKeys.WIDGET_DELTA_VS_PREV)}
			</div>
		);
	}

	return (
		<div className="h-full flex flex-col">
			<div className="flex items-center justify-between gap-2">
				<span className="text-xs uppercase tracking-wide text-faint-foreground truncate">
					{t(METRIC_LABEL_KEY[options.metric])}
				</span>
			</div>
			<div className="flex-1 flex flex-col items-center justify-center gap-2">
				<span className="text-3xl font-semibold text-foreground tabular-nums">{formatted}</span>
				{deltaNode}
			</div>
		</div>
	);
}

function formatNumber(value: number, locale: string): string {
	return new Intl.NumberFormat(locale).format(value);
}

function formatMoney(value: number, locale: string, currency: string): string {
	return new Intl.NumberFormat(locale, {
		style: "currency",
		currency,
	}).format(value);
}
