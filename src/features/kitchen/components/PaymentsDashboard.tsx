import {
	CopyableId,
	DashboardShell,
	EmptyState,
	SegmentedControl,
	Surface,
	Tooltip,
} from "@/global/components";
import { CommonKeys, localizeName, PaymentsKeys } from "@/global/i18n";
import { formatDate } from "@/global/utils/date";
import { formatCents } from "@/global/utils/money";
import type { Doc, Id } from "convex/_generated/dataModel";
import { CreditCard, DollarSign, Hash, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePayments } from "../hooks/usePayments";
import { PaymentsDashboardSkeleton } from "./PaymentsDashboardSkeleton";

type LiveNameDescriptionTranslations = Record<string, { name?: string; description?: string }>;

type PaymentsOrderItem = Doc<"orderItems"> & {
	readonly menuItemTranslations?: LiveNameDescriptionTranslations;
};

type PaymentsOrder = Doc<"orders"> & {
	readonly items: ReadonlyArray<PaymentsOrderItem>;
	readonly tableNumber: number;
};

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

export function PaymentsDashboard({ restaurantId }: Readonly<PaymentsDashboardProps>) {
	const { t, i18n } = useTranslation();
	const [timeFrame, setTimeFrame] = useState<TimeFrame>("today");

	const from = useMemo(() => getTimeFrameStart(timeFrame), [timeFrame]);

	const { orders, totalRevenue, orderCount, isLoading, error } = usePayments({
		restaurantId,
		from,
		to: undefined,
	});

	const averageOrder = orderCount > 0 ? totalRevenue / orderCount : 0;

	const typedOrders = orders as ReadonlyArray<PaymentsOrder>;

	const sorted = useMemo(
		() => [...typedOrders].sort((a, b) => (b.paidAt ?? 0) - (a.paidAt ?? 0)),
		[typedOrders]
	);

	const timeFrameOptions = useMemo(
		() => TIME_FRAMES.map((value) => ({ value, label: t(TIME_FRAME_KEYS[value]) })),
		[t]
	);

	const header = (
		<SegmentedControl
			options={timeFrameOptions}
			value={timeFrame}
			onChange={setTimeFrame}
			ariaLabel={t(PaymentsKeys.ARIA_FILTER)}
		/>
	);

	return (
		<DashboardShell
			isLoading={isLoading}
			error={error}
			entityName="payments"
			skeleton={<PaymentsDashboardSkeleton />}
			header={header}
			gap="6"
		>
			<div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
				<SummaryCard
					icon={<DollarSign size={20} />}
					label={t(PaymentsKeys.SUMMARY_TOTAL_REVENUE)}
					value={`$${formatCents(totalRevenue)}`}
				/>
				<SummaryCard
					icon={<Hash size={20} />}
					label={t(PaymentsKeys.SUMMARY_ORDERS)}
					value={String(orderCount)}
				/>
				<SummaryCard
					icon={<TrendingUp size={20} />}
					label={t(PaymentsKeys.SUMMARY_AVG_ORDER)}
					value={`$${formatCents(averageOrder)}`}
				/>
			</div>

			{sorted.length === 0 ? (
				<EmptyState icon={CreditCard} title={t(PaymentsKeys.EMPTY_NO_PAYMENTS)} fill />
			) : (
				<Surface tone="secondary" rounded="xl" className="overflow-hidden">
					<table className="w-full text-sm border-b border-border">
						<thead>
							<tr >
								<th
									className="text-left px-4 py-3 font-medium text-faint-foreground"
									
								>
									{t(PaymentsKeys.TABLE_ORDER_ID)}
								</th>
								<th
									className="text-left px-4 py-3 font-medium text-faint-foreground"
									
								>
									{t(PaymentsKeys.TABLE_DATE)}
								</th>
								<th
									className="text-left px-4 py-3 font-medium text-faint-foreground"
									
								>
									{t(PaymentsKeys.TABLE_TABLE)}
								</th>
								<th
									className="text-left px-4 py-3 font-medium text-faint-foreground"
									
								>
									{t(PaymentsKeys.TABLE_ITEMS)}
								</th>
								<th
									className="text-right px-4 py-3 font-medium text-faint-foreground"
									
								>
									{t(PaymentsKeys.TABLE_TOTAL)}
								</th>
							</tr>
						</thead>
						<tbody>
							{sorted.map((order) => (
								<tr
									key={order._id}
									className="border-b border-border" 
								>
									<td className="px-4 py-3">
										<CopyableId id={order._id} />
									</td>
									<td className="px-4 py-3 text-foreground" >
										{order.paidAt ? formatDate(order.paidAt, i18n.language) : "—"}
									</td>
									<td className="px-4 py-3 text-foreground" >
										{t(PaymentsKeys.TABLE_TABLE)} {order.tableNumber}
									</td>
									<td className="px-4 py-3">
										<OrderItemsTooltipTrigger order={order} />
									</td>
									<td
										className="px-4 py-3 text-right font-medium text-foreground"
										
									>
										${formatCents(order.totalAmount)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</Surface>
			)}
		</DashboardShell>
	);
}

function OrderItemsTooltipTrigger({ order }: Readonly<{ order: PaymentsOrder }>) {
	const { t, i18n } = useTranslation();
	const itemCount = order.items.reduce((n, item) => n + item.quantity, 0);
	const label = t(CommonKeys.ITEMS_COUNT, { count: itemCount });

	return (
		<Tooltip
			content={
				<div className="space-y-2">
					<ul className="space-y-1 list-none p-0 m-0">
						{order.items.map((item) => (
							<li
								key={item._id}
								className="flex items-baseline justify-between gap-3 text-foreground"
								
							>
								<span className="text-faint-foreground" >{item.quantity}×</span>
								<span className="flex-1">
									{localizeName(item.menuItemName, item.menuItemTranslations, i18n.language)}
								</span>
							</li>
						))}
					</ul>
					<div
						className="flex items-baseline justify-between gap-3 pt-1.5 mt-1 font-medium border-t border-border text-foreground"
						
					>
						<span className="text-faint-foreground" >
							{t(PaymentsKeys.TOOLTIP_TOTAL)}
						</span>
						<span>${formatCents(order.totalAmount)}</span>
					</div>
				</div>
			}
		>
			<button
				type="button"
				className="bg-transparent p-0 cursor-help text-muted-foreground"
				style={{textDecoration: "underline",
				textDecorationStyle: "dotted",
				textUnderlineOffset: "3px"}}
			>
				{label}
			</button>
		</Tooltip>
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
				style={{backgroundColor: "var(--bg-tertiary))"}}
			>
				<span className="text-faint-foreground" >{icon}</span>
			</div>
			<div>
				<p className="text-xs text-faint-foreground" >
					{label}
				</p>
				<p className="text-xl font-semibold text-foreground" >
					{value}
				</p>
			</div>
		</Surface>
	);
}
