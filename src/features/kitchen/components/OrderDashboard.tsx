import type { OrderDashboardStatusFilter } from "@/features";
import { useUserSettings } from "@/features/users/hooks/useUserSettings";
import {
	EmptyState,
	getStatusToneStyle,
	Modal,
	StatusBadge,
	StatusFilterChips,
	type StatusFilterOption,
	type StatusTone,
} from "@/global/components";
import { formatCents } from "@/global/utils/money";
import type { Id } from "convex/_generated/dataModel";
import {
	AlertTriangle,
	CheckCircle2,
	ChefHat,
	Clock,
	CreditCard,
	UtensilsCrossed,
	X,
	XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useOrders } from "../hooks/useOrders";
import { OrderDashboardSkeleton } from "./OrderDashboardSkeleton";

interface OrderDashboardProps {
	restaurantId: Id<"restaurants">;
}

type StatusConfig = {
	label: string;
	tone: StatusTone;
	next: string | null;
	nextLabel: string | null;
};

const STATUS_CONFIG: Record<OrderDashboardStatusFilter, StatusConfig> = {
	submitted: {
		label: "Pending",
		tone: "warning",
		next: "preparing",
		nextLabel: "Accept Order",
	},
	preparing: {
		label: "Preparing",
		tone: "info",
		next: "ready",
		nextLabel: "Mark Ready",
	},
	ready: {
		label: "Ready",
		tone: "success",
		next: "served",
		nextLabel: "Mark Served",
	},
	served: {
		label: "Served",
		tone: "neutral",
		next: null,
		nextLabel: null,
	},
	cancelled: {
		label: "Cancelled",
		tone: "danger",
		next: null,
		nextLabel: null,
	},
};

const ALL_STATUSES: OrderDashboardStatusFilter[] = [
	"submitted",
	"preparing",
	"ready",
	"served",
	"cancelled",
];

const STATUS_FILTER_OPTIONS: ReadonlyArray<StatusFilterOption<OrderDashboardStatusFilter>> =
	ALL_STATUSES.map((status) => ({
		value: status,
		label: STATUS_CONFIG[status].label,
		tone: STATUS_CONFIG[status].tone,
	}));

const DEFAULT_STATUS_FILTERS: OrderDashboardStatusFilter[] = ["submitted", "preparing", "ready"];

const STATUS_SORT_PRIORITY: Record<OrderDashboardStatusFilter, number> = {
	submitted: 0,
	preparing: 1,
	ready: 2,
	served: 3,
	cancelled: 4,
};

const MAX_VISIBLE_ITEMS = 7;

function formatOrderTime(timestamp: number): string {
	return new Date(timestamp).toLocaleTimeString(undefined, {
		hour: "numeric",
		minute: "2-digit",
	});
}

function formatOrderDate(timestamp: number): string {
	return new Intl.DateTimeFormat("en-GB", {
		day: "2-digit",
		month: "short",
		year: "numeric",
	})
		.format(new Date(timestamp))
		.replaceAll(" ", "-");
}

function getOrderAge(
	createdAt: number,
	now: number
): { label: string; color: string; minutes: number } {
	const minutes = Math.max(0, Math.floor((now - createdAt) / 60_000));

	let label: string;
	if (minutes < 1) label = "just now";
	else if (minutes < 60) label = `${minutes} min ago`;
	else if (minutes < 60 * 24) label = `${Math.floor(minutes / 60)} h ago`;
	else label = `${Math.floor(minutes / (60 * 24))} d ago`;

	let color: string;
	if (minutes < 10) color = "var(--accent-success)";
	else if (minutes < 30) color = "var(--accent-warning)";
	else color = "var(--accent-danger)";

	return { label, color, minutes };
}

function OrderItemRow({ item }: Readonly<{ item: any }>) {
	return (
		<div className="text-sm" style={{ color: "var(--text-primary)" }}>
			<span className="font-medium">{item.quantity}x</span> {item.menuItemName}
			{item.selectedOptions.length > 0 && (
				<span className="text-xs ml-1" style={{ color: "var(--text-muted)" }}>
					({item.selectedOptions.map((o: any) => o.optionName).join(", ")})
				</span>
			)}
			{item.specialInstructions && (
				<p className="text-xs italic" style={{ color: "var(--accent-warning)" }}>
					{item.specialInstructions}
				</p>
			)}
		</div>
	);
}

function isDashboardStatus(status: string): status is OrderDashboardStatusFilter {
	return status in STATUS_CONFIG;
}

export function OrderDashboard({ restaurantId }: Readonly<OrderDashboardProps>) {
	const { orderDashboardStatusFilters, updateOrderDashboardStatusFilters } = useUserSettings();
	const [cancelConfirm, setCancelConfirm] = useState<string | null>(null);
	const [fullOrder, setFullOrder] = useState<any>(null);
	const [now, setNow] = useState(() => Date.now());

	// Optimistic local copy so toggling pills feels instant. Once the persisted
	// value arrives (or changes), we sync to it.
	const [localFilters, setLocalFilters] = useState<OrderDashboardStatusFilter[] | null>(null);

	useEffect(() => {
		if (orderDashboardStatusFilters !== null) {
			setLocalFilters(orderDashboardStatusFilters);
		}
	}, [orderDashboardStatusFilters]);

	const activeFilters = useMemo<OrderDashboardStatusFilter[]>(() => {
		if (localFilters !== null) return localFilters;
		if (orderDashboardStatusFilters !== null) return orderDashboardStatusFilters;
		return DEFAULT_STATUS_FILTERS;
	}, [localFilters, orderDashboardStatusFilters]);

	const { orders, isLoading, error, updateStatus } = useOrders(restaurantId, activeFilters);

	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), 30_000);
		return () => clearInterval(id);
	}, []);

	const activeFilterSet = useMemo(() => new Set(activeFilters), [activeFilters]);

	const handleToggleFilter = (status: OrderDashboardStatusFilter) => {
		const current = activeFilters;
		const next = current.includes(status)
			? current.filter((s) => s !== status)
			: [...current, status];
		setLocalFilters(next);
		// Fire-and-forget: errors here only mean the choice doesn't persist
		// across devices, the UI already reflects the change locally.
		updateOrderDashboardStatusFilters(next).catch(() => {
			// Intentionally swallowed -- local state already reflects the toggle.
		});
	};

	const filterPills = (
		<div className="mb-4">
			<StatusFilterChips
				options={STATUS_FILTER_OPTIONS}
				selected={activeFilterSet}
				onToggle={handleToggleFilter}
				ariaLabel="Filter orders by status"
			/>
		</div>
	);

	if (isLoading) {
		return (
			<>
				{filterPills}
				<OrderDashboardSkeleton />
			</>
		);
	}

	if (error) {
		return (
			<>
				{filterPills}
				<EmptyState
					icon={AlertTriangle}
					title="Could not load orders."
					description={error.message ?? "Please check your permissions and try again."}
				/>
			</>
		);
	}

	const sorted = (orders as any[])
		.filter((o: any) => isDashboardStatus(o.status))
		.sort((a: any, b: any) => {
			const aPriority = STATUS_SORT_PRIORITY[a.status as OrderDashboardStatusFilter];
			const bPriority = STATUS_SORT_PRIORITY[b.status as OrderDashboardStatusFilter];
			return aPriority - bPriority || a.createdAt - b.createdAt;
		});

	const fullOrderConfig =
		fullOrder && isDashboardStatus(fullOrder.status)
			? STATUS_CONFIG[fullOrder.status as OrderDashboardStatusFilter]
			: null;
	const fullOrderAge = fullOrder ? getOrderAge(fullOrder.createdAt, now) : null;

	return (
		<>
			{filterPills}

			{sorted.length === 0 ? (
				<EmptyState
					icon={ChefHat}
					title={
						activeFilters.length === 0
							? "Select at least one status to view orders."
							: "No orders match the selected filters."
					}
				/>
			) : (
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
					{sorted.map((order: any) => {
						const config = STATUS_CONFIG[order.status as OrderDashboardStatusFilter];
						const visibleItems = order.items.slice(0, MAX_VISIBLE_ITEMS);
						const hiddenCount = order.items.length - visibleItems.length;
						const age = getOrderAge(order.createdAt, now);
						const absoluteTimestamp = `${formatOrderDate(order.createdAt)}, ${formatOrderTime(order.createdAt)}`;
						const hasNextAction = config.next !== null && config.nextLabel !== null;
						const isCancelling = cancelConfirm === order._id;
						const itemNoun = hiddenCount === 1 ? "item" : "items";
						const viewFullOrderLabel =
							hiddenCount > 0
								? `+${hiddenCount} more ${itemNoun} · View full order →`
								: "View full order →";

						return (
							<div
								key={order._id}
								className="rounded-xl overflow-hidden flex flex-col aspect-video"
								style={{
									border: "1px solid var(--border-default)",
									backgroundColor: "var(--bg-secondary)",
								}}
							>
								<div
									className="px-4 py-3 shrink-0"
									style={{ borderBottom: "1px solid var(--border-default)" }}
								>
									<div className="flex items-center justify-between gap-2">
										<div className="flex items-center gap-2 min-w-0">
											<StatusBadge
												bgColor={getStatusToneStyle(config.tone).solidBg}
												textColor={getStatusToneStyle(config.tone).solidFg}
												label={config.label}
											/>
											<span
												className="text-sm font-medium truncate"
												style={{ color: "var(--text-primary)" }}
											>
												Table {order.tableNumber}
											</span>
											{order.paidAt && (
												<span
													className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0"
													style={{ backgroundColor: "var(--accent-success)", color: "white" }}
												>
													<CreditCard size={10} />
													Paid
												</span>
											)}
										</div>
										<span
											className="text-sm font-semibold shrink-0"
											style={{ color: "var(--text-primary)" }}
										>
											${formatCents(order.totalAmount)}
										</span>
									</div>

									<div className="flex items-center justify-between gap-2 mt-1">
										<span
											className="text-[11px] font-mono truncate"
											style={{ color: "var(--text-muted)" }}
											title={order._id}
										>
											#{order._id.slice(-6)}
										</span>
										<span className="relative group flex items-center gap-1 text-[11px] font-medium shrink-0 cursor-help">
											<span
												className="flex items-center gap-1 underline decoration-dotted decoration-from-font underline-offset-2"
												style={{ color: age.color }}
											>
												<Clock size={11} />
												{age.label}
											</span>
											<span
												className="invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-opacity duration-150 absolute right-0 top-full mt-1 whitespace-nowrap text-[10px] px-2 py-1 rounded shadow-lg pointer-events-none z-10"
												style={{
													backgroundColor: "var(--bg-elevated)",
													color: "var(--text-primary)",
													border: "1px solid var(--border-default)",
												}}
											>
												{absoluteTimestamp}
											</span>
										</span>
									</div>
								</div>

								<div className="p-4 space-y-2 flex-1 min-h-0 overflow-y-auto">
									{visibleItems.map((item: any) => (
										<OrderItemRow key={item._id} item={item} />
									))}
								</div>

								<div className="px-4 pb-4 pt-2 space-y-2 shrink-0">
									<button
										type="button"
										onClick={() => setFullOrder(order)}
										className="w-full text-right text-[11px] font-medium transition-opacity hover:opacity-70"
										style={{ color: "var(--text-muted)" }}
									>
										{viewFullOrderLabel}
									</button>

									{isCancelling ? (
										<div
											className="p-3 rounded-lg space-y-2"
											style={{
												backgroundColor: "rgba(220, 38, 38, 0.05)",
												border: "1px solid rgba(220, 38, 38, 0.2)",
											}}
										>
											<p
												className="text-xs font-medium"
												style={{ color: "var(--accent-danger)" }}
											>
												{order.stripePaymentIntentId
													? "This order has been paid. Cancelling will issue a refund."
													: "Cancel this order?"}
											</p>
											<div className="flex gap-2">
												<button
													onClick={() => {
														updateStatus({
															orderId: order._id,
															newStatus: "cancelled",
														});
														setCancelConfirm(null);
													}}
													className="flex-1 py-1.5 rounded-lg text-xs font-medium"
													style={{
														backgroundColor: "var(--accent-danger)",
														color: "white",
													}}
												>
													{order.stripePaymentIntentId
														? "Cancel & Refund"
														: "Confirm Cancel"}
												</button>
												<button
													onClick={() => setCancelConfirm(null)}
													className="flex-1 py-1.5 rounded-lg text-xs font-medium"
													style={{
														border: "1px solid var(--border-default)",
														color: "var(--text-secondary)",
													}}
												>
													Keep Order
												</button>
											</div>
										</div>
									) : (
										hasNextAction && (
											<div className="flex gap-2">
												{config.next && (
													<button
														onClick={() =>
															updateStatus({
																orderId: order._id,
																newStatus: config.next as any,
															})
														}
														className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-sm font-medium hover-btn-primary"
													>
														{config.next === "preparing" && <ChefHat size={14} />}
														{config.next === "ready" && <CheckCircle2 size={14} />}
														{config.next === "served" && <UtensilsCrossed size={14} />}
														{config.nextLabel}
													</button>
												)}
												<button
													onClick={() => setCancelConfirm(order._id)}
													className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm"
													style={{
														border: "1px solid var(--border-default)",
														color: "var(--accent-danger)",
													}}
												>
													<XCircle size={14} />
													Cancel
												</button>
											</div>
										)
									)}
								</div>
							</div>
						);
					})}
				</div>
			)}

			<Modal
				isOpen={fullOrder !== null}
				onClose={() => setFullOrder(null)}
				ariaLabel="Full order details"
				size="lg"
			>
				{fullOrder && (
					<div
						className="rounded-xl"
						style={{
							backgroundColor: "var(--bg-primary)",
							border: "1px solid var(--border-default)",
						}}
					>
						<div
							className="px-6 py-4 flex items-start justify-between gap-4"
							style={{ borderBottom: "1px solid var(--border-default)" }}
						>
							<div className="flex flex-col gap-1 min-w-0">
								<div className="flex items-center gap-2 flex-wrap">
									{fullOrderConfig && (
										<StatusBadge
											bgColor={getStatusToneStyle(fullOrderConfig.tone).solidBg}
											textColor={getStatusToneStyle(fullOrderConfig.tone).solidFg}
											label={fullOrderConfig.label}
										/>
									)}
									<h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
										Table {fullOrder.tableNumber}
									</h2>
									{fullOrder.paidAt && (
										<span
											className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full"
											style={{ backgroundColor: "var(--accent-success)", color: "white" }}
										>
											<CreditCard size={10} />
											Paid
										</span>
									)}
								</div>
								<span
									className="text-xs font-mono break-all"
									style={{ color: "var(--text-muted)" }}
								>
									#{fullOrder._id}
								</span>
							</div>
							<button
								onClick={() => setFullOrder(null)}
								className="p-1 rounded-md transition-colors hover:opacity-80 shrink-0"
								style={{ color: "var(--text-muted)" }}
								aria-label="Close"
							>
								<X size={18} />
							</button>
						</div>

						<div
							className="px-6 py-3 flex items-center justify-between text-xs gap-4 flex-wrap"
							style={{
								color: "var(--text-muted)",
								borderBottom: "1px solid var(--border-default)",
							}}
						>
							<div className="flex items-center gap-3 flex-wrap">
								{fullOrderAge && (
									<span
										className="px-2 py-0.5 rounded-full text-[11px] font-medium"
										style={{ backgroundColor: fullOrderAge.color, color: "white" }}
									>
										{fullOrderAge.label}
									</span>
								)}
								<span>
									{fullOrder.items.length} {fullOrder.items.length === 1 ? "item" : "items"}
								</span>
								<span className="flex items-center gap-1">
									<Clock size={12} />
									{formatOrderDate(fullOrder.createdAt)} · {formatOrderTime(fullOrder.createdAt)}
								</span>
							</div>
							<span className="font-medium" style={{ color: "var(--text-primary)" }}>
								${formatCents(fullOrder.totalAmount)}
							</span>
						</div>

						<div className="px-6 py-4 space-y-2 max-h-[60vh] overflow-y-auto">
							{fullOrder.items.map((item: any) => (
								<OrderItemRow key={item._id} item={item} />
							))}
						</div>
					</div>
				)}
			</Modal>
		</>
	);
}
