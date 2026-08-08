/* eslint-disable boundaries/no-unknown -- feature-internal hooks/types not in eslint-boundaries map */
import { usePaymentsDashboardPrefs } from "../hooks/usePaymentsDashboardPrefs";
import type { PaymentsTimePeriod } from "../paymentsDashboardSearch";
import { AdminTable, DashboardShell, SegmentedControl, Surface } from "@/global/components";
import { useAdminTable } from "@/global/hooks";
import { PaymentsKeys } from "@/global/i18n";
import { formatCents } from "@/global/utils/money";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { CreditCard, DollarSign, HandCoins, Hash, Receipt, TrendingUp } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { PaymentsDashboardSkeleton } from "./PaymentsDashboardSkeleton";
import { usePaymentsColumns } from "./payments/Columns";
import type { PaymentsLedgerRow } from "./payments/types";

interface PaymentsDashboardProps {
	restaurantId: Id<"restaurants">;
}

const TIME_FRAME_KEYS: Record<PaymentsTimePeriod, string> = {
	today: PaymentsKeys.TIME_FRAME_TODAY,
	week: PaymentsKeys.TIME_FRAME_WEEK,
	month: PaymentsKeys.TIME_FRAME_MONTH,
	quarter: PaymentsKeys.TIME_FRAME_QUARTER,
	year: PaymentsKeys.TIME_FRAME_YEAR,
	all: PaymentsKeys.TIME_FRAME_ALL,
};

const TIME_FRAMES: PaymentsTimePeriod[] = ["today", "week", "month", "quarter", "year", "all"];

function getTimeFrameStart(frame: PaymentsTimePeriod): number | undefined {
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
	/** Food sold — excludes the Tavli service fee and tips (ADR 008). */
	totalRevenue: number;
	orderCount: number;
	averageOrder: number;
	serviceFees: number;
	tips: number;
}

/**
 * Summary numbers for the ledger. `totalRevenue` counts order rows only — a
 * tip row's money is reported under `tips`, never as restaurant sales — and
 * the Tavli service fee is reported separately because the diner, not the
 * restaurant, pays it.
 */
function deriveAggregates(rows: ReadonlyArray<PaymentsLedgerRow>): PaymentsAggregates {
	let totalRevenue = 0;
	let orderCount = 0;
	let serviceFees = 0;
	let tips = 0;
	for (const row of rows) {
		if (row.rowKind === "order") {
			orderCount += 1;
			totalRevenue += row.subtotalCents;
		}
		serviceFees += row.serviceFeeCents ?? 0;
		tips += row.tipCents;
	}
	const averageOrder = orderCount > 0 ? totalRevenue / orderCount : 0;
	return { totalRevenue, orderCount, averageOrder, serviceFees, tips };
}

export function PaymentsDashboard({ restaurantId }: Readonly<PaymentsDashboardProps>) {
	const { t } = useTranslation();
	const { period, setPeriod, q, setSearch } = usePaymentsDashboardPrefs(restaurantId);

	const from = useMemo(() => getTimeFrameStart(period), [period]);
	const columns = usePaymentsColumns();

	const tableState = useAdminTable<PaymentsLedgerRow>({
		queryOptions: convexQuery(api.orders.getPaymentsLedgerByRestaurant, {
			restaurantId,
			from,
			to: undefined,
		}),
		columns,
		globalFilter: q,
		onGlobalFilterChange: setSearch,
	});

	const aggregates = useMemo(() => deriveAggregates(tableState.data ?? []), [tableState.data]);

	const timeFrameOptions = useMemo(
		() => TIME_FRAMES.map((value) => ({ value, label: t(TIME_FRAME_KEYS[value]) })),
		[t]
	);

	const timeFrameControl = (
		<SegmentedControl
			options={timeFrameOptions}
			value={period}
			onChange={setPeriod}
			ariaLabel={t(PaymentsKeys.ARIA_FILTER)}
		/>
	);

	return (
		<DashboardShell
			isLoading={tableState.isLoading || tableState.isAuthLoading}
			error={tableState.error}
			entityName="payments"
			skeleton={<PaymentsDashboardSkeleton />}
			header={timeFrameControl}
			gap="6"
		>
			<div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-4">
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
				<SummaryCard
					icon={<Receipt size={20} />}
					label={t(PaymentsKeys.SUMMARY_SERVICE_FEES)}
					value={`$${formatCents(aggregates.serviceFees)}`}
				/>
				<SummaryCard
					icon={<HandCoins size={20} />}
					label={t(PaymentsKeys.SUMMARY_TIPS)}
					value={`$${formatCents(aggregates.tips)}`}
				/>
			</div>

			<AdminTable
				tableState={tableState}
				entityName="payments"
				searchPlaceholder={t(PaymentsKeys.SEARCH_PLACEHOLDER)}
				getResultCountText={(count) => t(PaymentsKeys.RESULT_COUNT, { count })}
				emptyIcon={CreditCard}
				emptyTitle={t(PaymentsKeys.EMPTY_NO_PAYMENTS)}
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
