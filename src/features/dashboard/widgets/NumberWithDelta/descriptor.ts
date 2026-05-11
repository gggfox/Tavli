import { DashboardKeys } from "@/global/i18n";
import { Hash } from "lucide-react";
import { registerWidget, type WidgetDescriptor } from "../registry";
import {
	numberWithDeltaOptionsSchema,
	type NumberWithDeltaOptions,
} from "./schema";
import { NumberWithDeltaWidget } from "./Widget";

export const NUMBER_WITH_DELTA_TYPE = "numberWithDelta";

export const numberWithDeltaDescriptor: WidgetDescriptor<NumberWithDeltaOptions> =
	registerWidget<NumberWithDeltaOptions>({
		type: NUMBER_WITH_DELTA_TYPE,
		i18nLabelKey: DashboardKeys.WIDGET_NUMBER_WITH_DELTA_LABEL,
		i18nDescriptionKey: DashboardKeys.WIDGET_NUMBER_WITH_DELTA_DESCRIPTION,
		icon: Hash,
		requiredRole: "employee",
		portfolioCapable: true,
		supportsComparison: true,
		maxRangeDays: 366,
		defaultGrid: { w: 3, h: 3, minW: 2, minH: 2 },
		optionsSchema: numberWithDeltaOptionsSchema,
		defaultOptions: { metric: "reservations.count" },
		Component: NumberWithDeltaWidget,
	});
