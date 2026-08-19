import type { OrderDashboardStatusFilterValue } from "@/features";
import { getStatusToneStyle, StatusBadge, Surface } from "@/global/components";
import { OrdersKeys } from "@/global/i18n";
import { formatCents } from "@/global/utils/money";
import { getRelativeTime } from "@/global/utils/relativeTime";
import {
	BadgeDollarSign,
	CheckCircle2,
	ChefHat,
	Clock,
	UtensilsCrossed,
	XCircle,
} from "lucide-react";
import { type CSSProperties, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { OrderItemRow } from "./OrderItemRow";
import { PaymentStateBadge } from "./PaymentStateBadge";
import { STATION_CONFIG, type DashboardPrepStation } from "./stationConfig";
import { TableBadge } from "./TableBadge";
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
	/** Order id whose cancel is in flight, if any. Disables the confirm button. */
	cancelPendingId: string | null;
	/** Order id currently showing the mark-paid confirmation, if any (ADR 008). */
	markPaidConfirm: string | null;
	/** Order id whose mark-paid mutation is in flight, if any. */
	markPaidPendingId: string | null;
	/** Localized failure message of the last mark-paid attempt on this card. */
	markPaidError: string | null;
	onSelectFullOrder: (order: DashboardOrder) => void;
	onRequestCancel: (orderId: string) => void;
	onDismissCancel: () => void;
	onCancelOrder: (orderId: DashboardOrder["_id"]) => void;
	onRequestMarkPaid: (orderId: string) => void;
	onDismissMarkPaid: () => void;
	onMarkPaidInPerson: (orderId: DashboardOrder["_id"]) => void;
	onUpdateStatus: (args: { orderId: DashboardOrder["_id"]; newStatus: NextOrderStatus }) => void;
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
	cancelPendingId,
	markPaidConfirm,
	markPaidPendingId,
	markPaidError,
	onSelectFullOrder,
	onRequestCancel,
	onDismissCancel,
	onCancelOrder,
	onRequestMarkPaid,
	onDismissMarkPaid,
	onMarkPaidInPerson,
	onUpdateStatus,
	onMarkStationReady,
}: Readonly<OrderCardProps>) {
	const { t, i18n } = useTranslation();
	const config = STATUS_CONFIG[order.status as OrderDashboardStatusFilterValue];
	// The money UI on an awaiting-payment card — amount due, mark-paid confirm
	// panel, mark-paid button — takes that status's own tone, so recoloring the
	// status never leaves the card mixing two palettes.
	const awaitingPaymentTone = getStatusToneStyle(STATUS_CONFIG.awaiting_payment.tone);
	const visibleItems = order.items.slice(0, MAX_VISIBLE_ITEMS);
	const hiddenCount = order.items.length - visibleItems.length;
	const isAwaitingPayment = order.status === "awaiting_payment";
	// For an awaiting-payment card the clock that matters is "how long has
	// this table owed cash", not "when was the order created".
	const ageBasis = isAwaitingPayment
		? (order.awaitingPaymentAt ?? order.createdAt)
		: order.createdAt;
	const age = getRelativeTime(ageBasis, now);
	const absoluteTimestamp = `${formatOrderDate(ageBasis, i18n.language)}, ${formatOrderTime(ageBasis, i18n.language)}`;
	const hasNextAction = config.next !== null && config.nextLabelKey !== null;
	const isCancelling = cancelConfirm === order._id;
	const isCancelPending = cancelPendingId === order._id;
	const isMarkPaidConfirming = markPaidConfirm === order._id;
	const isMarkPaidPending = markPaidPendingId === order._id;
	// `stripePaymentIntentId` is only ever set on legacy per-order payments — it
	// is undefined for every tab-paid order, which is all of them in practice.
	// `paymentState` is the field that actually tracks the money.
	const isPaid = order.paymentState === "paid";
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
		return ["kitchen", "bar"].filter((s): s is DashboardPrepStation =>
			set.has(s as DashboardPrepStation)
		);
	}, [order.items]);

	const stationStamps = useMemo<Record<DashboardPrepStation, number | undefined>>(
		() => ({ kitchen: order.kitchenReadyAt, bar: order.barReadyAt }),
		[order.kitchenReadyAt, order.barReadyAt]
	);

	const stationActionTarget: DashboardPrepStation | null = useMemo(() => {
		if (activeStationFilters.size !== 1) return null;
		const [only] = [...activeStationFilters];
		if (!only) return null;
		if (!orderStations.includes(only)) return null;
		if (stationStamps[only] !== undefined) return null;
		return only;
	}, [activeStationFilters, orderStations, stationStamps]);

	return (
		<Surface tone="secondary" rounded="xl" className="overflow-hidden flex flex-col">
			<div className="px-4 py-3 shrink-0 border-b border-border">
				<div className="flex items-center justify-between gap-2">
					<div className="flex items-center gap-2 min-w-0">
						{/* Table first and loudest: a server reads the destination before
						    anything else on the card (TAVLI-80). */}
						<TableBadge
							tableNumber={order.tableNumber}
							className="shrink-0 text-xl font-bold leading-tight text-foreground"
						/>
						<StatusBadge
							bgColor={getStatusToneStyle(config.tone).solidBg}
							textColor={getStatusToneStyle(config.tone).solidFg}
							label={t(config.labelKey)}
						/>
						{order.dailyOrderNumber != null && (
							<span
								className="text-sm font-bold tabular-nums shrink-0 text-foreground"
								title={order._id}
							>
								{t(OrdersKeys.CARD_DAY_NUMBER, { n: order.dailyOrderNumber })}
							</span>
						)}
						<PaymentStateBadge paymentState={order.paymentState} />
					</div>
					<span className="text-sm font-semibold shrink-0 text-foreground">
						${formatCents(order.totalAmount)}
					</span>
				</div>

				{isAwaitingPayment && (
					<div
						className="flex items-center justify-between gap-2 mt-2 px-3 py-2 rounded-lg"
						style={{
							backgroundColor: awaitingPaymentTone.tintedBg,
							color: awaitingPaymentTone.fg,
						}}
					>
						<div className="min-w-0">
							{/* Same swap as the header: the table leads, the order number
							    identifies (TAVLI-80). */}
							<TableBadge
								tableNumber={order.tableNumber}
								className="block truncate text-xl font-bold leading-tight"
							/>
							<span className="block text-xs font-medium tabular-nums truncate">
								{order.dailyOrderNumber != null
									? t(OrdersKeys.CARD_DAY_NUMBER, { n: order.dailyOrderNumber })
									: `#${order._id.slice(-6)}`}
							</span>
						</div>
						<div className="text-right shrink-0">
							<span className="block text-[10px] font-medium uppercase tracking-wide">
								{t(OrdersKeys.MARK_PAID_AMOUNT_DUE)}
							</span>
							<span className="block text-xl font-bold tabular-nums leading-tight">
								${formatCents(order.totalAmount)}
							</span>
						</div>
					</div>
				)}

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
					<span className="text-[11px] font-mono truncate text-faint-foreground" title={order._id}>
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
						<span className="invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-opacity duration-150 absolute right-0 top-full mt-1 whitespace-nowrap text-[10px] px-2 py-1 rounded shadow-lg pointer-events-none z-10 bg-card text-foreground border border-border">
							{absoluteTimestamp}
						</span>
					</span>
				</div>

				{order.specialInstructions && (
					<p className="mt-1.5 text-xs italic text-warning">
						<span className="font-medium not-italic">{t(OrdersKeys.TICKET_ORDER_NOTE)}: </span>
						{order.specialInstructions}
					</p>
				)}
			</div>

			<div className="p-4 space-y-2 flex-1 min-h-0 max-h-72 overflow-y-auto">
				{visibleItems.map((item) => (
					<OrderItemRow key={item._id} item={item} activeStationFilters={activeStationFilters} />
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
						style={{
							backgroundColor: "rgba(220, 38, 38, 0.05)",
							border: "1px solid rgba(220, 38, 38, 0.2)",
						}}
					>
						<p className="text-xs font-medium text-destructive">
							{isPaid ? t(OrdersKeys.CANCEL_PAID_PROMPT) : t(OrdersKeys.CANCEL_PROMPT)}
						</p>
						<div className="flex gap-2">
							<button
								onClick={() => onCancelOrder(order._id)}
								disabled={isCancelPending}
								className="flex-1 py-1.5 rounded-lg text-xs font-medium bg-destructive disabled:opacity-60"
								style={{ color: "white" }}
							>
								{isCancelPending
									? t(OrdersKeys.CANCEL_REFUND_PENDING)
									: isPaid
										? t(OrdersKeys.ACTION_CANCEL_AND_REFUND)
										: t(OrdersKeys.ACTION_CONFIRM_CANCEL)}
							</button>
							<button
								onClick={onDismissCancel}
								disabled={isCancelPending}
								className="flex-1 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground disabled:opacity-60"
							>
								{t(OrdersKeys.ACTION_KEEP_ORDER)}
							</button>
						</div>
					</div>
				) : isAwaitingPayment ? (
					isMarkPaidConfirming ? (
						<div
							className="p-3 rounded-lg space-y-2"
							style={{
								backgroundColor: awaitingPaymentTone.tintedBg,
								border: `1px solid ${awaitingPaymentTone.solidBg}`,
							}}
						>
							<p className="text-xs font-semibold text-foreground">
								{t(OrdersKeys.MARK_PAID_PROMPT_TITLE)}
							</p>
							<p className="text-xs text-muted-foreground">
								{t(OrdersKeys.MARK_PAID_PROMPT_BODY, {
									amount: `$${formatCents(order.totalAmount)}`,
								})}
							</p>
							{markPaidError && (
								<p role="alert" className="text-xs font-medium text-destructive">
									{markPaidError}
								</p>
							)}
							<div className="flex gap-2">
								<button
									onClick={() => onMarkPaidInPerson(order._id)}
									disabled={isMarkPaidPending}
									className="flex-1 py-1.5 rounded-lg text-xs font-medium disabled:opacity-60"
									style={{
										backgroundColor: awaitingPaymentTone.solidBg,
										color: awaitingPaymentTone.solidFg,
									}}
								>
									{isMarkPaidPending
										? t(OrdersKeys.MARK_PAID_PENDING)
										: t(OrdersKeys.MARK_PAID_CONFIRM)}
								</button>
								<button
									onClick={onDismissMarkPaid}
									disabled={isMarkPaidPending}
									className="flex-1 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground disabled:opacity-60"
								>
									{t(OrdersKeys.MARK_PAID_DISMISS)}
								</button>
							</div>
						</div>
					) : (
						<div className="flex gap-2">
							<button
								onClick={() => onRequestMarkPaid(order._id)}
								className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-sm font-medium"
								style={{
									backgroundColor: awaitingPaymentTone.solidBg,
									color: awaitingPaymentTone.solidFg,
								}}
							>
								<BadgeDollarSign size={14} />
								{t(OrdersKeys.ACTION_MARK_PAID_IN_PERSON)}
							</button>
							<button
								onClick={() => onRequestCancel(order._id)}
								className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm border border-border text-destructive"
							>
								<XCircle size={14} />
								{t(OrdersKeys.ACTION_CANCEL)}
							</button>
						</div>
					)
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
	readonly config: (typeof STATUS_CONFIG)[OrderDashboardStatusFilterValue];
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
				onClick={() => onMarkStationReady({ orderId: order._id, station: stationActionTarget })}
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
