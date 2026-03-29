import { EmptyState, LoadingState } from "@/global/components";
import { formatDate } from "@/global/utils/date";
import { formatCents } from "@/global/utils/money";
import type { Id } from "convex/_generated/dataModel";
import { AlertTriangle, CreditCard, DollarSign, Hash, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";
import { usePayments } from "../hooks/usePayments";

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

	const sorted = useMemo(
		() => [...orders].sort((a: any, b: any) => (b.paidAt ?? 0) - (a.paidAt ?? 0)),
		[orders]
	);

	if (isLoading) {
		return <LoadingState message="Loading payments..." className="p-4" />;
	}

	if (error) {
		return (
			<EmptyState
				icon={AlertTriangle}
				title="Could not load payments."
				description={error.message ?? "Please check your permissions and try again."}
			/>
		);
	}

	return (
		<div className="space-y-6">
			{/* Time frame filter */}
			<div className="flex flex-wrap gap-2">
				{TIME_FRAME_OPTIONS.map((opt) => (
					<button
						key={opt.key}
						onClick={() => setTimeFrame(opt.key)}
						className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
						style={
							timeFrame === opt.key
								? {
										backgroundColor: "var(--btn-primary-bg)",
										color: "var(--btn-primary-text, #fff)",
									}
								: {
										backgroundColor: "var(--bg-secondary)",
										color: "var(--text-secondary)",
										border: "1px solid var(--border-default)",
									}
						}
					>
						{opt.label}
					</button>
				))}
			</div>

			{/* Summary cards */}
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

			{/* Orders list */}
			{sorted.length === 0 ? (
				<EmptyState icon={CreditCard} title="No payments in this period." />
			) : (
				<div
					className="rounded-xl overflow-hidden"
					style={{
						border: "1px solid var(--border-default)",
						backgroundColor: "var(--bg-secondary)",
					}}
				>
					<table className="w-full text-sm">
						<thead>
							<tr style={{ borderBottom: "1px solid var(--border-default)" }}>
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
							{sorted.map((order: any) => (
								<tr key={order._id} style={{ borderBottom: "1px solid var(--border-default)" }}>
									<td className="px-4 py-3" style={{ color: "var(--text-primary)" }}>
										{order.paidAt ? formatDate(order.paidAt) : "—"}
									</td>
									<td className="px-4 py-3" style={{ color: "var(--text-primary)" }}>
										Table {order.tableNumber}
									</td>
									<td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>
										{order.items.map((i: any) => `${i.quantity}x ${i.menuItemName}`).join(", ")}
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
				</div>
			)}
		</div>
	);
}

function SummaryCard({
	icon,
	label,
	value,
}: Readonly<{ icon: React.ReactNode; label: string; value: string }>) {
	return (
		<div
			className="rounded-xl p-4 flex items-center gap-4"
			style={{
				border: "1px solid var(--border-default)",
				backgroundColor: "var(--bg-secondary)",
			}}
		>
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
		</div>
	);
}
