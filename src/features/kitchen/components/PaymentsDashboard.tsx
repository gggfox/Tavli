import { AdminTable, DashboardShell, SegmentedControl, Surface } from "@/global/components";
import { useAdminTable } from "@/global/hooks";
import { PaymentsKeys } from "@/global/i18n";
import { formatCents } from "@/global/utils/money";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { CreditCard, DollarSign, Hash, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PaymentsDashboardSkeleton } from "./PaymentsDashboardSkeleton";
import { usePaymentsColumns } from "./payments/Columns";
import type { PaymentsOrder } from "./payments/OrderItemsTooltipTrigger";

interface PaymentsDashboardProps {
	restaurantId: Id<"restaurants">;
}

type TimeFrame = "today" | "week" | "month" | "quarter" | "year" | "all";

const TIME_FRAME_KEYS: Record<TimeFrame, string> = {
	today: PaymentsKeys.TIME_FRAME_TODAY,
	week: PaymentsKeys.TIME_FRAME_WEEK,
	month: PaymentsKeys.TIME_FRAME_MONTH,
	quarter: PaymentsKeys.TIME_FRAME_QUARTER,
	year: PaymentsKeys.TIME_FRAME_YEAR,
	all: PaymentsKeys.TIME_FRAME_ALL,
};

const TIME_FRAMES: TimeFrame[] = ["today", "week", "month", "quarter", "year", "all"];

function getTimeFrameStart(frame: TimeFrame): number | undefined {
	if (frame === "all") return undefined;

	const now = new Date();
	switch (frame) {
		case "today":
			return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
		case "week": {
			const day = now.getDay();
			const diff = now.getDate() - day + (day === 0 ? -6 : 1);
			return new Date(now.getFullYear(), now.getMonth(), diff).getTime();
		}
		case "month":
			return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
		case "quarter": {
			const quarterMonth = Math.floor(now.getMonth() / 3) * 3;
			return new Date(now.getFullYear(), quarterMonth, 1).getTime();
		}
		case "year":
			return new Date(now.getFullYear(), 0, 1).getTime();
	}
}

interface PaymentsAggregates {
	totalRevenue: number;
	orderCount: number;
	averageOrder: number;
}

function deriveAggregates(orders: ReadonlyArray<PaymentsOrder>): PaymentsAggregates {
	const orderCount = orders.length;
	const totalRevenue = orders.reduce((sum, o) => sum + o.totalAmount, 0);
	const averageOrder = orderCount > 0 ? totalRevenue / orderCount : 0;
	return { totalRevenue, orderCount, averageOrder };
}

export function PaymentsDashboard({ restaurantId }: Readonly<PaymentsDashboardProps>) {
	const { t } = useTranslation();
	const [timeFrame, setTimeFrame] = useState<TimeFrame>("today");

	const from = useMemo(() => getTimeFrameStart(timeFrame), [timeFrame]);
	const columns = usePaymentsColumns();

	const tableState = useAdminTable<PaymentsOrder>({
		queryOptions: convexQuery(api.orders.getPaidOrdersByRestaurant, {
			restaurantId,
			from,
			to: undefined,
		}),
		columns,
	});

	const aggregates = useMemo(() => deriveAggregates(tableState.data ?? []), [tableState.data]);

	const timeFrameOptions = useMemo(
		() => TIME_FRAMES.map((value) => ({ value, label: t(TIME_FRAME_KEYS[value]) })),
		[t]
	);

	const timeFrameControl = (
		<SegmentedControl
			options={timeFrameOptions}
			value={timeFrame}
			onChange={setTimeFrame}
			ariaLabel={t(PaymentsKeys.ARIA_FILTER)}
		/>
	);

	return (
		<DashboardShell
			isLoading={tableState.isLoading || tableState.isAuthLoading}
			error={tableState.error}
			entityName="payments"
			skeleton={<PaymentsDashboardSkeleton />}
			gap="6"
		>
			<div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
				<SummaryCard
					icon={<DollarSign size={20} />}
					label={t(PaymentsKeys.SUMMARY_TOTAL_REVENUE)}
					value={`$${formatCents(aggregates.totalRevenue)}`}
				/>
				<SummaryCard
					icon={<Hash size={20} />}
					label={t(PaymentsKeys.SUMMARY_ORDERS)}
					value={String(aggregates.orderCount)}
				/>
				<SummaryCard
					icon={<TrendingUp size={20} />}
					label={t(PaymentsKeys.SUMMARY_AVG_ORDER)}
					value={`$${formatCents(aggregates.averageOrder)}`}
				/>
			</div>

			<AdminTable
				tableState={tableState}
				entityName="payments"
				emptyIcon={CreditCard}
				emptyTitle={t(PaymentsKeys.EMPTY_NO_PAYMENTS)}
				actions={timeFrameControl}
			/>
		</DashboardShell>
	);
}

function SummaryCard({
	icon,
	label,
	value,
}: Readonly<{ icon: React.ReactNode; label: string; value: string }>) {
	return (
		<Surface tone="secondary" rounded="xl" className="p-4 flex items-center gap-4">
			<div
				className="flex items-center justify-center w-10 h-10 rounded-lg"
				style={{ backgroundColor: "var(--bg-tertiary)" }}
			>
				<span className="text-faint-foreground">{icon}</span>
			</div>
			<div>
				<p className="text-xs text-faint-foreground">{label}</p>
				<p className="text-xl font-semibold text-foreground">{value}</p>
			</div>
		</Surface>
	);
}
