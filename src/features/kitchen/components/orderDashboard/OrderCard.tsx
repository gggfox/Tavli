import type { OrderDashboardStatusFilter } from "@/features";
import { getStatusToneStyle, StatusBadge, Surface } from "@/global/components";
import { OrdersKeys } from "@/global/i18n";
import { formatCents } from "@/global/utils/money";
import { getRelativeTime } from "@/global/utils/relativeTime";
import { CheckCircle2, ChefHat, Clock, CreditCard, UtensilsCrossed, XCircle } from "lucide-react";
import { type CSSProperties, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { OrderItemRow } from "./OrderItemRow";
import { STATION_CONFIG, type DashboardPrepStation } from "./stationConfig";
import {
	formatOrderDate,
	formatOrderTime,
	MAX_VISIBLE_ITEMS,
	STATUS_CONFIG,
	URGENCY_TEXT_CLASS,
	type DashboardOrder,
	type NextOrderStatus,
} from "./statusConfig";

interface OrderCardProps {
	order: DashboardOrder;
	now: number;
	cancelConfirm: string | null;
	/**
	 * Currently-active station filters on the dashboard. When non-empty,
	 * the card swaps the generic "Mark Ready" button for a station-scoped
	 * one ("Mark Bar Ready" / "Mark Kitchen Ready") that calls the
	 * `markStationReady` mutation. When the set has more than one station
	 * selected we fall back to the whole-order action.
	 */
	activeStationFilters: ReadonlySet<DashboardPrepStation>;
	onSelectFullOrder: (order: DashboardOrder) => void;
	onRequestCancel: (orderId: string) => void;
	onDismissCancel: () => void;
	onUpdateStatus: (args: {
		orderId: DashboardOrder["_id"];
		newStatus: NextOrderStatus;
	}) => void;
	onMarkStationReady: (args: {
		orderId: DashboardOrder["_id"];
		station: DashboardPrepStation;
	}) => void;
}

export function OrderCard({
	order,
	now,
	cancelConfirm,
	activeStationFilters,
	onSelectFullOrder,
	onRequestCancel,
	onDismissCancel,
	onUpdateStatus,
	onMarkStationReady,
}: Readonly<OrderCardProps>) {
	const { t, i18n } = useTranslation();
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

	// Distinct prep stations represented in this order. Drives the
	// per-station progress chips in the header — we only render a chip
	// for stations that actually have items here.
	const orderStations = useMemo<DashboardPrepStation[]>(() => {
		const set = new Set<DashboardPrepStation>();
		for (const item of order.items) set.add(item.prepStation);
		return ["kitchen", "bar"].filter((s): s is DashboardPrepStation => set.has(s as DashboardPrepStation));
	}, [order.items]);

	const stationStamps: Record<DashboardPrepStation, number | undefined> = {
		kitchen: order.kitchenReadyAt,
		bar: order.barReadyAt,
	};

	// When exactly one station is selected AND the order has work for
	// that station that has not yet been stamped, replace the generic
	// "Mark Ready" with the station-scoped action. Two-station selection
	// is treated as "no narrowing" and falls back to the whole-order
	// action so the dashboard does not silently choose for the user.
	const stationActionTarget: DashboardPrepStation | null = useMemo(() => {
		if (activeStationFilters.size !== 1) return null;
		const [only] = [...activeStationFilters];
		if (!only) return null;
		if (!orderStations.includes(only)) return null;
		if (stationStamps[only] !== undefined) return null;
		return only;
	}, [activeStationFilters, orderStations, stationStamps]);

	return (
		<Surface tone="secondary" rounded="xl" className="overflow-hidden flex flex-col aspect-video">
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
						{order.dailyOrderNumber != null && (
							<span
								className="text-sm font-bold tabular-nums shrink-0 text-foreground"
								title={order._id}
							>
								{t(OrdersKeys.CARD_DAY_NUMBER, { n: order.dailyOrderNumber })}
							</span>
						)}
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

				{orderStations.length > 0 && (
					<div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
						{orderStations.map((station) => {
							const stationConfig = STATION_CONFIG[station];
							const isReady = stationStamps[station] !== undefined;
							const Icon = stationConfig.icon;
							const chipStyle: CSSProperties = isReady
								? {
										backgroundColor: stationConfig.visual.solidBg,
										color: stationConfig.visual.solidFg,
									}
								: {
										backgroundColor: stationConfig.visual.tintedBg,
										color: stationConfig.visual.fg,
									};
							const labelKey = isReady
								? OrdersKeys.STATION_READY_BADGE
								: OrdersKeys.STATION_PENDING_BADGE;
							return (
								<span
									key={station}
									className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full"
									style={chipStyle}
								>
									<Icon size={10} />
									{t(labelKey, { station: t(stationConfig.labelKey) })}
								</span>
							);
						})}
					</div>
				)}

				<div className="flex items-center justify-between gap-2 mt-1">
					<span
						className="text-[11px] font-mono truncate text-faint-foreground"
						title={order._id}
					>
						{order.dailyOrderNumber != null
							? `${t(OrdersKeys.CARD_DAY_NUMBER, { n: order.dailyOrderNumber })} · ${order._id.slice(-6)}`
							: `#${order._id.slice(-6)}`}
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
					<OrderItemRow
						key={item._id}
						item={item}
						activeStationFilters={activeStationFilters}
					/>
				))}
			</div>

			<div className="px-4 pb-4 pt-2 space-y-2 shrink-0">
				<button
					type="button"
					onClick={() => onSelectFullOrder(order)}
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
									onUpdateStatus({
										orderId: order._id,
										newStatus: "cancelled",
									});
									onDismissCancel();
								}}
								className="flex-1 py-1.5 rounded-lg text-xs font-medium bg-destructive"
								style={{color: "white"}}
							>
								{order.stripePaymentIntentId
									? t(OrdersKeys.ACTION_CANCEL_AND_REFUND)
									: t(OrdersKeys.ACTION_CONFIRM_CANCEL)}
							</button>
							<button
								onClick={onDismissCancel}
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
								<NextActionButton
									order={order}
									config={config}
									stationActionTarget={stationActionTarget}
									onUpdateStatus={onUpdateStatus}
									onMarkStationReady={onMarkStationReady}
								/>
							)}
							<button
								onClick={() => onRequestCancel(order._id)}
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
}

interface NextActionButtonProps {
	readonly order: DashboardOrder;
	readonly config: (typeof STATUS_CONFIG)[OrderDashboardStatusFilter];
	readonly stationActionTarget: DashboardPrepStation | null;
	readonly onUpdateStatus: (args: {
		orderId: DashboardOrder["_id"];
		newStatus: NextOrderStatus;
	}) => void;
	readonly onMarkStationReady: (args: {
		orderId: DashboardOrder["_id"];
		station: DashboardPrepStation;
	}) => void;
}

/**
 * The primary "advance this order" button. When the dashboard is
 * filtered to a single station and the order's next transition is
 * "ready", this button switches to the station-scoped variant
 * (markStationReady), which only stamps that station's `*ReadyAt` and
 * defers flipping `Order.status` until every applicable station is
 * stamped. In every other case it behaves exactly like the original
 * whole-order action.
 */
function NextActionButton({
	order,
	config,
	stationActionTarget,
	onUpdateStatus,
	onMarkStationReady,
}: Readonly<NextActionButtonProps>) {
	const { t } = useTranslation();
	const stationOnlyAdvance = stationActionTarget !== null && config.next === "ready";

	if (stationOnlyAdvance) {
		const stationConfig = STATION_CONFIG[stationActionTarget];
		const Icon = stationConfig.icon;
		return (
			<button
				onClick={() =>
					onMarkStationReady({ orderId: order._id, station: stationActionTarget })
				}
				className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-sm font-medium"
				style={{
					backgroundColor: stationConfig.visual.solidBg,
					color: stationConfig.visual.solidFg,
				}}
			>
				<Icon size={14} />
				{t(stationConfig.readyActionKey)}
			</button>
		);
	}

	if (!config.next || !config.nextLabelKey) return null;
	return (
		<button
			onClick={() =>
				onUpdateStatus({
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
	);
}
