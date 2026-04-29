import type { OrderDashboardStatusFilter } from "@/features";
import { useUserSettings } from "@/features/users/hooks/useUserSettings";
import {
	DashboardShell,
	DialogHeader,
	EmptyState,
	getStatusToneStyle,
	Modal,
	StatusBadge,
	StatusFilterChips,
	type StatusFilterOption,
	type StatusTone,
	Surface,
} from "@/global/components";
import { useOptimisticUserSetting } from "@/global/hooks";
import { CommonKeys, localizeName, OrdersKeys, useLocalizedName } from "@/global/i18n";
import { formatCents } from "@/global/utils/money";
import { getRelativeTime, type Urgency } from "@/global/utils/relativeTime";

const URGENCY_TEXT_CLASS: Record<Urgency, string> = {
	fresh: "text-success",
	stale: "text-warning",
	cold: "text-destructive",
};

const URGENCY_BG_CLASS: Record<Urgency, string> = {
	fresh: "bg-success",
	stale: "bg-warning",
	cold: "bg-destructive",
};
import type { Doc, Id } from "convex/_generated/dataModel";
import {
	CheckCircle2,
	ChefHat,
	Clock,
	CreditCard,
	UtensilsCrossed,
	XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrders } from "../hooks/useOrders";
import { OrderDashboardSkeleton } from "./OrderDashboardSkeleton";

type LiveNameTranslations = Record<string, { name?: string }>;
type LiveNameDescriptionTranslations = Record<string, { name?: string; description?: string }>;

type DashboardSelectedOption = Doc<"orderItems">["selectedOptions"][number] & {
	readonly optionTranslations?: LiveNameTranslations;
	readonly optionGroupTranslations?: LiveNameTranslations;
};

type DashboardOrderItem = Omit<Doc<"orderItems">, "selectedOptions"> & {
	readonly menuItemTranslations?: LiveNameDescriptionTranslations;
	readonly selectedOptions: ReadonlyArray<DashboardSelectedOption>;
};

type DashboardOrder = Doc<"orders"> & {
	readonly items: ReadonlyArray<DashboardOrderItem>;
	readonly tableNumber: number;
};

interface OrderDashboardProps {
	restaurantId: Id<"restaurants">;
}

/**
 * Subset of order statuses accepted by `api.orders.updateStatus`. Note
 * the explicit absence of `"submitted"` -- the dashboard never advances
 * an order back into the queue.
 */
type NextOrderStatus = "preparing" | "ready" | "served" | "cancelled";

type StatusConfig = {
	labelKey: string;
	tone: StatusTone;
	next: NextOrderStatus | null;
	nextLabelKey: string | null;
};

const STATUS_CONFIG: Record<OrderDashboardStatusFilter, StatusConfig> = {
	submitted: {
		labelKey: OrdersKeys.STATUS_SUBMITTED,
		tone: "warning",
		next: "preparing",
		nextLabelKey: OrdersKeys.ACTION_ACCEPT,
	},
	preparing: {
		labelKey: OrdersKeys.STATUS_PREPARING,
		tone: "info",
		next: "ready",
		nextLabelKey: OrdersKeys.ACTION_MARK_READY,
	},
	ready: {
		labelKey: OrdersKeys.STATUS_READY,
		tone: "success",
		next: "served",
		nextLabelKey: OrdersKeys.ACTION_MARK_SERVED,
	},
	served: {
		labelKey: OrdersKeys.STATUS_SERVED,
		tone: "neutral",
		next: null,
		nextLabelKey: null,
	},
	cancelled: {
		labelKey: OrdersKeys.STATUS_CANCELLED,
		tone: "danger",
		next: null,
		nextLabelKey: null,
	},
};

const ALL_STATUSES: OrderDashboardStatusFilter[] = [
	"submitted",
	"preparing",
	"ready",
	"served",
	"cancelled",
];

const DEFAULT_STATUS_FILTERS: OrderDashboardStatusFilter[] = ["submitted", "preparing", "ready"];

const STATUS_SORT_PRIORITY: Record<OrderDashboardStatusFilter, number> = {
	submitted: 0,
	preparing: 1,
	ready: 2,
	served: 3,
	cancelled: 4,
};

const MAX_VISIBLE_ITEMS = 7;

function formatOrderTime(timestamp: number, locale: string): string {
	return new Date(timestamp).toLocaleTimeString(locale, {
		hour: "numeric",
		minute: "2-digit",
	});
}

function formatOrderDate(timestamp: number, locale: string): string {
	return new Intl.DateTimeFormat(locale, {
		day: "2-digit",
		month: "short",
		year: "numeric",
	}).format(new Date(timestamp));
}

function OrderItemRow({ item }: Readonly<{ item: DashboardOrderItem }>) {
	const { i18n } = useTranslation();
	const itemName = useLocalizedName(item.menuItemName, item.menuItemTranslations);
	const optionsLabel = useMemo(
		() =>
			item.selectedOptions
				.map((option) => localizeName(option.optionName, option.optionTranslations, i18n.language))
				.join(", "),
		[item.selectedOptions, i18n.language]
	);

	return (
		<div className="text-sm text-foreground" >
			<span className="font-medium">{item.quantity}x</span> {itemName}
			{item.selectedOptions.length > 0 && (
				<span className="text-xs ml-1 text-faint-foreground" >
					({optionsLabel})
				</span>
			)}
			{item.specialInstructions && (
				<p className="text-xs italic text-warning" >
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
	const { t, i18n } = useTranslation();
	const { orderDashboardStatusFilters, updateOrderDashboardStatusFilters } = useUserSettings();
	const [cancelConfirm, setCancelConfirm] = useState<string | null>(null);
	const [fullOrder, setFullOrder] = useState<DashboardOrder | null>(null);
	const [now, setNow] = useState(() => Date.now());

	const [activeFilters, setActiveFilters] = useOptimisticUserSetting<
		OrderDashboardStatusFilter[]
	>({
		serverValue: orderDashboardStatusFilters,
		persist: updateOrderDashboardStatusFilters,
		fallback: DEFAULT_STATUS_FILTERS,
	});

	const { orders, isLoading, error, updateStatus } = useOrders(restaurantId, activeFilters);

	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), 30_000);
		return () => clearInterval(id);
	}, []);

	const activeFilterSet = useMemo(() => new Set(activeFilters), [activeFilters]);

	const statusFilterOptions = useMemo<
		ReadonlyArray<StatusFilterOption<OrderDashboardStatusFilter>>
	>(
		() =>
			ALL_STATUSES.map((status) => ({
				value: status,
				label: t(STATUS_CONFIG[status].labelKey),
				tone: STATUS_CONFIG[status].tone,
			})),
		[t]
	);

	const handleToggleFilter = (status: OrderDashboardStatusFilter) => {
		const next = activeFilters.includes(status)
			? activeFilters.filter((s) => s !== status)
			: [...activeFilters, status];
		setActiveFilters(next);
	};

	const filterPills = (
		<StatusFilterChips
			options={statusFilterOptions}
			selected={activeFilterSet}
			onToggle={handleToggleFilter}
			ariaLabel={t(OrdersKeys.ARIA_FILTER)}
		/>
	);

	const typedOrders = orders as ReadonlyArray<DashboardOrder>;

	const sorted = typedOrders
		.filter((o) => isDashboardStatus(o.status))
		.slice()
		.sort((a, b) => {
			const aPriority = STATUS_SORT_PRIORITY[a.status as OrderDashboardStatusFilter];
			const bPriority = STATUS_SORT_PRIORITY[b.status as OrderDashboardStatusFilter];
			return aPriority - bPriority || a.createdAt - b.createdAt;
		});

	const fullOrderConfig =
		fullOrder && isDashboardStatus(fullOrder.status) ? STATUS_CONFIG[fullOrder.status] : null;
	const fullOrderAge = fullOrder ? getRelativeTime(fullOrder.createdAt, now) : null;

	return (
		<DashboardShell
			isLoading={isLoading}
			error={error}
			entityName="orders"
			skeleton={<OrderDashboardSkeleton />}
			header={filterPills}
		>
			{sorted.length === 0 ? (
				<EmptyState
					icon={ChefHat}
					title={
						activeFilters.length === 0
							? t(OrdersKeys.EMPTY_NO_FILTERS)
							: t(OrdersKeys.EMPTY_NO_ORDERS)
					}
					fill
				/>
			) : (
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
					{sorted.map((order) => {
						const config = STATUS_CONFIG[order.status as OrderDashboardStatusFilter];
						const visibleItems = order.items.slice(0, MAX_VISIBLE_ITEMS);
						const hiddenCount = order.items.length - visibleItems.length;
						const age = getRelativeTime(order.createdAt, now);
						const absoluteTimestamp = `${formatOrderDate(order.createdAt, i18n.language)}, ${formatOrderTime(order.createdAt, i18n.language)}`;
						const hasNextAction = config.next !== null && config.nextLabelKey !== null;
						const isCancelling = cancelConfirm === order._id;
						const moreItemsLabel =
							hiddenCount > 0
								? `${t(OrdersKeys.CARD_MORE_ITEMS, { count: hiddenCount })} · ${t(OrdersKeys.ACTION_VIEW_FULL_ORDER)}`
								: t(OrdersKeys.ACTION_VIEW_FULL_ORDER);

						return (
							<Surface
								key={order._id}
								tone="secondary"
								rounded="xl"
								className="overflow-hidden flex flex-col aspect-video"
							>
								<div
									className="px-4 py-3 shrink-0 border-b border-border"
									
								>
									<div className="flex items-center justify-between gap-2">
										<div className="flex items-center gap-2 min-w-0">
											<StatusBadge
												bgColor={getStatusToneStyle(config.tone).solidBg}
												textColor={getStatusToneStyle(config.tone).solidFg}
												label={t(config.labelKey)}
											/>
											<span
												className="text-sm font-medium truncate text-foreground"
												
											>
												{t(OrdersKeys.CARD_TABLE, { number: order.tableNumber })}
											</span>
											{order.paidAt && (
												<span
													className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 bg-success"
													style={{color: "white"}}
												>
													<CreditCard size={10} />
													{t(OrdersKeys.CARD_PAID)}
												</span>
											)}
										</div>
										<span
											className="text-sm font-semibold shrink-0 text-foreground"
											
										>
											${formatCents(order.totalAmount)}
										</span>
									</div>

									<div className="flex items-center justify-between gap-2 mt-1">
										<span
											className="text-[11px] font-mono truncate text-faint-foreground"
											
											title={order._id}
										>
											#{order._id.slice(-6)}
										</span>
										<span className="relative group flex items-center gap-1 text-[11px] font-medium shrink-0 cursor-help">
											<span
												className={`flex items-center gap-1 underline decoration-dotted decoration-from-font underline-offset-2 ${URGENCY_TEXT_CLASS[age.urgency]}`}
											>
												<Clock size={11} />
												{t(age.key, age.vars)}
											</span>
											<span
												className="invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-opacity duration-150 absolute right-0 top-full mt-1 whitespace-nowrap text-[10px] px-2 py-1 rounded shadow-lg pointer-events-none z-10 bg-card text-foreground border border-border"
												
											>
												{absoluteTimestamp}
											</span>
										</span>
									</div>
								</div>

								<div className="p-4 space-y-2 flex-1 min-h-0 overflow-y-auto">
									{visibleItems.map((item) => (
										<OrderItemRow key={item._id} item={item} />
									))}
								</div>

								<div className="px-4 pb-4 pt-2 space-y-2 shrink-0">
									<button
										type="button"
										onClick={() => setFullOrder(order)}
										className="w-full text-right text-[11px] font-medium transition-opacity hover:opacity-70 text-faint-foreground"
										
									>
										{moreItemsLabel}
									</button>

									{isCancelling ? (
										<div
											className="p-3 rounded-lg space-y-2"
											style={{backgroundColor: "rgba(220, 38, 38, 0.05)",
				border: "1px solid rgba(220, 38, 38, 0.2)"}}
										>
											<p
												className="text-xs font-medium text-destructive"
												
											>
												{order.stripePaymentIntentId
													? t(OrdersKeys.CANCEL_PAID_PROMPT)
													: t(OrdersKeys.CANCEL_PROMPT)}
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
													className="flex-1 py-1.5 rounded-lg text-xs font-medium bg-destructive"
													style={{color: "white"}}
												>
													{order.stripePaymentIntentId
														? t(OrdersKeys.ACTION_CANCEL_AND_REFUND)
														: t(OrdersKeys.ACTION_CONFIRM_CANCEL)}
												</button>
												<button
													onClick={() => setCancelConfirm(null)}
													className="flex-1 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground"
													
												>
													{t(OrdersKeys.ACTION_KEEP_ORDER)}
												</button>
											</div>
										</div>
									) : (
										hasNextAction && (
											<div className="flex gap-2">
												{config.next && config.nextLabelKey && (
													<button
														onClick={() =>
															updateStatus({
																orderId: order._id,
																newStatus: config.next as NextOrderStatus,
															})
														}
														className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-sm font-medium hover-btn-primary"
													>
														{config.next === "preparing" && <ChefHat size={14} />}
														{config.next === "ready" && <CheckCircle2 size={14} />}
														{config.next === "served" && <UtensilsCrossed size={14} />}
														{t(config.nextLabelKey)}
													</button>
												)}
												<button
													onClick={() => setCancelConfirm(order._id)}
													className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm border border-border text-destructive"
													
												>
													<XCircle size={14} />
													{t(OrdersKeys.ACTION_CANCEL)}
												</button>
											</div>
										)
									)}
								</div>
							</Surface>
						);
					})}
				</div>
			)}

			<Modal
				isOpen={fullOrder !== null}
				onClose={() => setFullOrder(null)}
				ariaLabel={t(OrdersKeys.ARIA_FULL_ORDER)}
				size="lg"
			>
				{fullOrder && (
					<Surface tone="primary" rounded="xl">
						<DialogHeader
							title={
								<div className="flex items-center gap-2 flex-wrap">
									{fullOrderConfig && (
										<StatusBadge
											bgColor={getStatusToneStyle(fullOrderConfig.tone).solidBg}
											textColor={getStatusToneStyle(fullOrderConfig.tone).solidFg}
											label={t(fullOrderConfig.labelKey)}
										/>
									)}
									<h2
										className="text-lg font-semibold text-foreground"
										
									>
										{t(OrdersKeys.CARD_TABLE, { number: fullOrder.tableNumber })}
									</h2>
									{fullOrder.paidAt && (
										<span
											className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-success"
											style={{color: "white"}}
										>
											<CreditCard size={10} />
											{t(OrdersKeys.CARD_PAID)}
										</span>
									)}
								</div>
							}
							subtitle={
								<span
									className="text-xs font-mono break-all text-faint-foreground"
									
								>
									#{fullOrder._id}
								</span>
							}
							onClose={() => setFullOrder(null)}
						/>

						<div
							className="px-6 py-3 flex items-center justify-between text-xs gap-4 flex-wrap text-faint-foreground border-b border-border"
							
						>
							<div className="flex items-center gap-3 flex-wrap">
								{fullOrderAge && (
									<span
										className={`px-2 py-0.5 rounded-full text-[11px] font-medium text-inverse-foreground ${URGENCY_BG_CLASS[fullOrderAge.urgency]}`}
									>
										{t(fullOrderAge.key, fullOrderAge.vars)}
									</span>
								)}
								<span>
									{t(CommonKeys.ITEMS_COUNT, { count: fullOrder.items.length })}
								</span>
								<span className="flex items-center gap-1">
									<Clock size={12} />
									{formatOrderDate(fullOrder.createdAt, i18n.language)} ·{" "}
									{formatOrderTime(fullOrder.createdAt, i18n.language)}
								</span>
							</div>
							<span className="font-medium text-foreground" >
								${formatCents(fullOrder.totalAmount)}
							</span>
						</div>

						<div className="px-6 py-4 space-y-2 max-h-[60vh] overflow-y-auto">
							{fullOrder.items.map((item) => (
								<OrderItemRow key={item._id} item={item} />
							))}
						</div>
					</Surface>
				)}
			</Modal>
		</DashboardShell>
	);
}
