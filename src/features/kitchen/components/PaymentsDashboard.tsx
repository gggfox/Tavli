import {
	CopyableId,
	DashboardShell,
	EmptyState,
	SegmentedControl,
	Surface,
	Tooltip,
} from "@/global/components";
import { formatDate } from "@/global/utils/date";
import { formatCents } from "@/global/utils/money";
import type { Doc, Id } from "convex/_generated/dataModel";
import { CreditCard, DollarSign, Hash, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";
import { usePayments } from "../hooks/usePayments";
import { PaymentsDashboardSkeleton } from "./PaymentsDashboardSkeleton";

type PaymentsOrder = Doc<"orders"> & {
	readonly items: ReadonlyArray<Doc<"orderItems">>;
	readonly tableNumber: number;
};

interface PaymentsDashboardProps {
	restaurantId: Id<"restaurants">;
}

type TimeFrame = "today" | "week" | "month" | "quarter" | "year" | "all";

const TIME_FRAME_OPTIONS: { key: TimeFrame; label: string }[] = [
	{ key: "today", label: "Today" },
	{ key: "week", label: "This Week" },
	{ key: "month", label: "This Month" },
	{ key: "quarter", label: "This Quarter" },
	{ key: "year", label: "This Year" },
	{ key: "all", label: "All Time" },
];

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

	const header = (
		<SegmentedControl
			options={TIME_FRAME_OPTIONS.map((o) => ({ value: o.key, label: o.label }))}
			value={timeFrame}
			onChange={setTimeFrame}
			ariaLabel="Filter payments by time frame"
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
					label="Total Revenue"
					value={`$${formatCents(totalRevenue)}`}
				/>
				<SummaryCard icon={<Hash size={20} />} label="Orders" value={String(orderCount)} />
				<SummaryCard
					icon={<TrendingUp size={20} />}
					label="Avg. Order"
					value={`$${formatCents(averageOrder)}`}
				/>
			</div>

			{sorted.length === 0 ? (
				<EmptyState icon={CreditCard} title="No payments in this period." fill />
			) : (
				<Surface tone="secondary" rounded="xl" className="overflow-hidden">
					<table className="w-full text-sm">
						<thead>
							<tr style={{ borderBottom: "1px solid var(--border-default)" }}>
								<th
									className="text-left px-4 py-3 font-medium"
									style={{ color: "var(--text-muted)" }}
								>
									Order ID
								</th>
								<th
									className="text-left px-4 py-3 font-medium"
									style={{ color: "var(--text-muted)" }}
								>
									Date
								</th>
								<th
									className="text-left px-4 py-3 font-medium"
									style={{ color: "var(--text-muted)" }}
								>
									Table
								</th>
								<th
									className="text-left px-4 py-3 font-medium"
									style={{ color: "var(--text-muted)" }}
								>
									Items
								</th>
								<th
									className="text-right px-4 py-3 font-medium"
									style={{ color: "var(--text-muted)" }}
								>
									Total
								</th>
							</tr>
						</thead>
						<tbody>
							{sorted.map((order) => (
								<tr
									key={order._id}
									style={{ borderBottom: "1px solid var(--border-default)" }}
								>
									<td className="px-4 py-3">
										<CopyableId id={order._id} />
									</td>
									<td className="px-4 py-3" style={{ color: "var(--text-primary)" }}>
										{order.paidAt ? formatDate(order.paidAt) : "—"}
									</td>
									<td className="px-4 py-3" style={{ color: "var(--text-primary)" }}>
										Table {order.tableNumber}
									</td>
									<td className="px-4 py-3">
										<OrderItemsTooltipTrigger order={order} />
									</td>
									<td
										className="px-4 py-3 text-right font-medium"
										style={{ color: "var(--text-primary)" }}
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
	const itemCount = order.items.reduce((n, item) => n + item.quantity, 0);
	const label = itemCount === 1 ? "1 item" : `${itemCount} items`;

	return (
		<Tooltip
			content={
				<div className="space-y-2">
					<ul className="space-y-1 list-none p-0 m-0">
						{order.items.map((item) => (
							<li
								key={item._id}
								className="flex items-baseline justify-between gap-3"
								style={{ color: "var(--text-primary)" }}
							>
								<span style={{ color: "var(--text-muted)" }}>{item.quantity}×</span>
								<span className="flex-1">{item.menuItemName}</span>
							</li>
						))}
					</ul>
					<div
						className="flex items-baseline justify-between gap-3 pt-1.5 mt-1 font-medium"
						style={{
							borderTop: "1px solid var(--border-default)",
							color: "var(--text-primary)",
						}}
					>
						<span style={{ color: "var(--text-muted)" }}>Total</span>
						<span>${formatCents(order.totalAmount)}</span>
					</div>
				</div>
			}
		>
			<button
				type="button"
				className="bg-transparent p-0 cursor-help"
				style={{
					color: "var(--text-secondary)",
					textDecoration: "underline",
					textDecorationStyle: "dotted",
					textUnderlineOffset: "3px",
				}}
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
				style={{ backgroundColor: "var(--bg-tertiary, var(--bg-primary))" }}
			>
				<span style={{ color: "var(--text-muted)" }}>{icon}</span>
			</div>
			<div>
				<p className="text-xs" style={{ color: "var(--text-muted)" }}>
					{label}
				</p>
				<p className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
					{value}
				</p>
			</div>
		</Surface>
	);
}
