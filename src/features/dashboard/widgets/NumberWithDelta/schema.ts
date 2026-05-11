import { DashboardKeys } from "@/global/i18n";
import { z } from "zod";

export const numberWithDeltaOptionsSchema = z.object({
	metric: z.enum([
		"reservations.count",
		"reservations.confirmed",
		"orders.count",
		"payments.revenueTotal",
		"covers",
	]),
});

export type NumberWithDeltaOptions = z.infer<typeof numberWithDeltaOptionsSchema>;

export const METRIC_LABEL_KEY: Record<NumberWithDeltaOptions["metric"], string> = {
	"reservations.count": DashboardKeys.WIDGET_NUMBER_WITH_DELTA_METRIC_RESERVATIONS_COUNT,
	"reservations.confirmed": DashboardKeys.WIDGET_NUMBER_WITH_DELTA_METRIC_RESERVATIONS_CONFIRMED,
	"orders.count": DashboardKeys.WIDGET_NUMBER_WITH_DELTA_METRIC_ORDERS_COUNT,
	"payments.revenueTotal": DashboardKeys.WIDGET_NUMBER_WITH_DELTA_METRIC_PAYMENTS_REVENUE_TOTAL,
	"covers": DashboardKeys.WIDGET_NUMBER_WITH_DELTA_METRIC_COVERS,
};
