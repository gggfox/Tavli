import type { OrderDashboardPrepStationFilter, OrderDashboardStatusFilter } from "@/features";
import { useUserSettings } from "@/features/users/hooks/useUserSettings";
import {
	DashboardShell,
	EmptyState,
	StatusFilterChips,
	VirtualGrid,
	type StatusFilterOption,
} from "@/global/components";
import { useOptimisticUserSetting } from "@/global/hooks";
import { getErrorMessage } from "@/global/utils";
import { OrdersKeys } from "@/global/i18n";
import type { Id } from "convex/_generated/dataModel";
import { ChefHat, X } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrders } from "../../hooks/useOrders";
import { OrderCard } from "./OrderCard";
import { OrderDashboardSkeleton } from "./OrderDashboardSkeleton";
import { OrderDetailModal } from "./OrderDetailModal";
import { StationTicketCard } from "./StationTicketCard";
import { deriveStationTickets, type StationTicket } from "./stationTickets";
import { ALL_PREP_STATIONS, STATION_CONFIG } from "./stationConfig";
import {
	ALL_STATUSES,
	DEFAULT_STATUS_FILTERS,
	isDashboardStatus,
	STATUS_CONFIG,
	STATUS_SORT_PRIORITY,
	type DashboardOrder,
	type DashboardOrderItem,
} from "./statusConfig";

/**
 * Default prep-station filter set: empty = "no station filter applied"
 * (= show all stations). Mirrors the `null`/`[]` semantics of the
 * persisted user setting. See ADR 005.
 */
const DEFAULT_PREP_STATION_FILTERS: OrderDashboardPrepStationFilter[] = [];

/**
 * How long the undo strip stays offering to put a bumped ticket back. Long
 * enough to catch a mistap, short enough that it never lingers into the next
 * ticket's work.
 */
const UNDO_WINDOW_MS = 10_000;

interface OrderDashboardProps {
	restaurantId: Id<"restaurants">;
}

export function OrderDashboard({ restaurantId }: Readonly<OrderDashboardProps>) {
	const { t } = useTranslation();
	const {
		orderDashboardStatusFilters,
		updateOrderDashboardStatusFilters,
		orderDashboardPrepStationFilters,
		updateOrderDashboardPrepStationFilters,
	} = useUserSettings();
	const [cancelConfirm, setCancelConfirm] = useState<string | null>(null);
	const [cancelPendingId, setCancelPendingId] = useState<string | null>(null);
	// Deliberately a persistent banner, not a toast: a failed refund means the
	// diner is owed money, and the cancelled order it belongs to is filtered out
	// of the default dashboard view, so a message that disappears would be the
	// only trace of it.
	const [refundFailure, setRefundFailure] = useState<{ number: string; message: string } | null>(
		null
	);
	const [fullOrder, setFullOrder] = useState<DashboardOrder | null>(null);
	const [now, setNow] = useState(() => Date.now());
	const [cancelItemPendingId, setCancelItemPendingId] = useState<string | null>(null);
	const [cancelItemError, setCancelItemError] = useState<string | null>(null);
	// Single slot: a second bump replaces the pending undo rather than stacking
	// strips. The window is short and the latest bump is the one a mistap is
	// most likely to belong to.
	const [undoStamp, setUndoStamp] = useState<{
		orderId: DashboardOrder["_id"];
		station: OrderDashboardPrepStationFilter;
		orderLabel: string;
	} | null>(null);

	const [activeFilters, setActiveFilters] = useOptimisticUserSetting<OrderDashboardStatusFilter[]>({
		serverValue: orderDashboardStatusFilters,
		persist: updateOrderDashboardStatusFilters,
		fallback: DEFAULT_STATUS_FILTERS,
	});

	const [activeStationFilters, setActiveStationFilters] = useOptimisticUserSetting<
		OrderDashboardPrepStationFilter[]
	>({
		serverValue: orderDashboardPrepStationFilters,
		persist: updateOrderDashboardPrepStationFilters,
		fallback: DEFAULT_PREP_STATION_FILTERS,
	});

	// Pass `undefined` (not `[]`) when no station filter is active so the
	// query treats it as "no filter" and short-circuits the per-order
	// presence check on the server side.
	const queryStations = activeStationFilters.length > 0 ? activeStationFilters : undefined;

	const {
		orders,
		isLoading,
		error,
		updateStatus,
		markStationReady,
		unmarkStationReady,
		cancelOrderItem,
		cancelOrderAndRefund,
	} = useOrders(restaurantId, activeFilters, queryStations);

	// Exactly one station selected → that station gets its own tickets. With no
	// filter or both stations selected the dashboard stays the whole-order
	// overview, where money, cross-station progress, and cancel live.
	const ticketStation = activeStationFilters.length === 1 ? activeStationFilters[0] : null;

	const handleCancelOrder = useCallback(
		async (orderId: DashboardOrder["_id"]) => {
			const order = (orders as ReadonlyArray<DashboardOrder>).find((o) => o._id === orderId);
			const orderLabel = order?.dailyOrderNumber?.toString() ?? orderId;
			setCancelPendingId(orderId);
			setRefundFailure(null);
			try {
				const [, cancelError] = await cancelOrderAndRefund({ orderId });
				if (cancelError) {
					setRefundFailure({
						number: orderLabel,
						message: getErrorMessage(cancelError, t),
					});
					return;
				}
				setCancelConfirm(null);
			} catch (err) {
				setRefundFailure({ number: orderLabel, message: getErrorMessage(err, t) });
			} finally {
				setCancelPendingId(null);
			}
		},
		[orders, cancelOrderAndRefund, t]
	);

	const handleCancelItem = useCallback(
		async (orderItemId: DashboardOrderItem["_id"]) => {
			setCancelItemPendingId(orderItemId);
			setCancelItemError(null);
			try {
				const [, itemError] = await cancelOrderItem({ orderItemId });
				if (itemError) setCancelItemError(getErrorMessage(itemError, t));
			} catch (err) {
				setCancelItemError(getErrorMessage(err, t));
			} finally {
				setCancelItemPendingId(null);
			}
		},
		[cancelOrderItem, t]
	);

	// Stamping bumps the ticket off this station's rail, so the strip is the
	// only way back to a mistapped order without clearing the station filter.
	const handleMarkStationReadyFromTicket = useCallback(
		async (args: { orderId: DashboardOrder["_id"]; station: OrderDashboardPrepStationFilter }) => {
			const order = (orders as ReadonlyArray<DashboardOrder>).find((o) => o._id === args.orderId);
			await markStationReady(args);
			setUndoStamp({
				orderId: args.orderId,
				station: args.station,
				orderLabel: order?.dailyOrderNumber?.toString() ?? args.orderId.slice(-6),
			});
		},
		[markStationReady, orders]
	);

	const handleUndoStationReady = useCallback(async () => {
		if (!undoStamp) return;
		const { orderId, station } = undoStamp;
		setUndoStamp(null);
		await unmarkStationReady({ orderId, station });
	}, [undoStamp, unmarkStationReady]);

	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), 30_000);
		return () => clearInterval(id);
	}, []);

	useEffect(() => {
		if (!undoStamp) return;
		const id = setTimeout(() => setUndoStamp(null), UNDO_WINDOW_MS);
		return () => clearTimeout(id);
	}, [undoStamp]);

	const activeFilterSet = useMemo(() => new Set(activeFilters), [activeFilters]);
	const activeStationFilterSet = useMemo<ReadonlySet<OrderDashboardPrepStationFilter>>(
		() => new Set(activeStationFilters),
		[activeStationFilters]
	);

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

	const handleToggleStationFilter = (station: OrderDashboardPrepStationFilter) => {
		const next = activeStationFilters.includes(station)
			? activeStationFilters.filter((s) => s !== station)
			: [...activeStationFilters, station];
		setActiveStationFilters(next);
	};

	const filterPills = (
		<div className="flex flex-col gap-2">
			<StatusFilterChips
				options={statusFilterOptions}
				selected={activeFilterSet}
				onToggle={handleToggleFilter}
				ariaLabel={t(OrdersKeys.ARIA_FILTER)}
			/>
			<StationFilterChips
				selected={activeStationFilterSet}
				onToggle={handleToggleStationFilter}
				ariaLabel={t(OrdersKeys.ARIA_STATION_FILTER)}
			/>
		</div>
	);

	const typedOrders = orders as ReadonlyArray<DashboardOrder>;

	const sorted = useMemo(
		() =>
			typedOrders
				.filter((o) => isDashboardStatus(o.status))
				.slice()
				.sort((a, b) => {
					const aPriority = STATUS_SORT_PRIORITY[a.status as OrderDashboardStatusFilter];
					const bPriority = STATUS_SORT_PRIORITY[b.status as OrderDashboardStatusFilter];
					return aPriority - bPriority || a.createdAt - b.createdAt;
				}),
		[typedOrders]
	);

	const renderOrderCard = useCallback(
		(order: DashboardOrder) => (
			<OrderCard
				order={order}
				now={now}
				cancelConfirm={cancelConfirm}
				cancelPendingId={cancelPendingId}
				activeStationFilters={activeStationFilterSet}
				onSelectFullOrder={setFullOrder}
				onRequestCancel={setCancelConfirm}
				onDismissCancel={() => setCancelConfirm(null)}
				onCancelOrder={handleCancelOrder}
				onUpdateStatus={updateStatus}
				onMarkStationReady={markStationReady}
			/>
		),
		[
			now,
			cancelConfirm,
			cancelPendingId,
			activeStationFilterSet,
			handleCancelOrder,
			updateStatus,
			markStationReady,
		]
	);

	const stationTickets = useMemo(
		() => (ticketStation ? deriveStationTickets(sorted, ticketStation) : []),
		[sorted, ticketStation]
	);

	const renderStationTicket = useCallback(
		(ticket: StationTicket) => (
			<StationTicketCard
				ticket={ticket}
				now={now}
				cancelItemPendingId={cancelItemPendingId}
				cancelItemError={cancelItemError}
				onSelectFullOrder={setFullOrder}
				onUpdateStatus={updateStatus}
				onMarkStationReady={handleMarkStationReadyFromTicket}
				onCancelItem={handleCancelItem}
			/>
		),
		[
			now,
			cancelItemPendingId,
			cancelItemError,
			updateStatus,
			handleMarkStationReadyFromTicket,
			handleCancelItem,
		]
	);

	return (
		<DashboardShell
			isLoading={isLoading}
			error={error}
			entityName="orders"
			skeleton={<OrderDashboardSkeleton />}
			header={filterPills}
		>
			{refundFailure && (
				<div
					role="alert"
					className="mb-3 flex items-start gap-2 rounded-lg p-3 text-xs font-medium text-destructive"
					style={{
						backgroundColor: "rgba(220, 38, 38, 0.05)",
						border: "1px solid rgba(220, 38, 38, 0.2)",
					}}
				>
					<span className="flex-1">
						{t(OrdersKeys.CANCEL_REFUND_FAILED_BANNER, { number: refundFailure.number })}{" "}
						{refundFailure.message}
					</span>
					<button
						onClick={() => setRefundFailure(null)}
						className="shrink-0 text-muted-foreground"
						aria-label={t(OrdersKeys.ACTION_KEEP_ORDER)}
					>
						<X size={14} />
					</button>
				</div>
			)}

			{undoStamp && (
				<div className="mb-3 flex items-center gap-3 rounded-lg border border-border bg-card p-3 text-xs">
					<span className="flex-1 text-muted-foreground">
						{t(OrdersKeys.TICKET_MARKED_READY, {
							station: t(STATION_CONFIG[undoStamp.station].labelKey),
							n: undoStamp.orderLabel,
						})}
					</span>
					<button
						onClick={handleUndoStationReady}
						className="shrink-0 rounded-lg border border-border px-3 py-1 font-medium text-foreground"
					>
						{t(OrdersKeys.TICKET_UNDO_READY)}
					</button>
				</div>
			)}

			{ticketStation ? (
				stationTickets.length === 0 ? (
					<EmptyState
						icon={STATION_CONFIG[ticketStation].icon}
						title={
							activeFilters.length === 0
								? t(OrdersKeys.EMPTY_NO_FILTERS)
								: t(OrdersKeys.TICKET_EMPTY_ALL_DONE, {
										station: t(STATION_CONFIG[ticketStation].labelKey),
									})
						}
						fill
					/>
				) : (
					<VirtualGrid
						items={stationTickets}
						// One ticket per order in single-station mode, so the order id
						// is still a unique key.
						getKey={(ticket) => ticket.order._id}
						renderItem={renderStationTicket}
						gap={16}
						estimateRowHeight={300}
					/>
				)
			) : sorted.length === 0 ? (
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
				// Virtualized: a busy service can hold hundreds of live orders,
				// and every one of them used to re-render on each Convex push.
				<VirtualGrid
					items={sorted}
					getKey={(order) => order._id}
					renderItem={renderOrderCard}
					gap={16}
					estimateRowHeight={260}
				/>
			)}

			<OrderDetailModal fullOrder={fullOrder} now={now} onClose={() => setFullOrder(null)} />
		</DashboardShell>
	);
}

interface StationFilterChipsProps {
	readonly selected: ReadonlySet<OrderDashboardPrepStationFilter>;
	readonly onToggle: (station: OrderDashboardPrepStationFilter) => void;
	readonly ariaLabel: string;
}

/**
 * Prep-station equivalent of `StatusFilterChips`. Renders a small
 * fieldset of toggle pills using the station-specific palette in
 * `STATION_CONFIG` so the row is visually distinct from the status row
 * above it.
 */
function StationFilterChips({ selected, onToggle, ariaLabel }: StationFilterChipsProps) {
	const { t } = useTranslation();
	return (
		<fieldset className="flex flex-wrap gap-2 m-0 p-0 border-0">
			<legend className="sr-only">{ariaLabel}</legend>
			{ALL_PREP_STATIONS.map((station) => {
				const config = STATION_CONFIG[station];
				const Icon = config.icon;
				const isActive = selected.has(station);
				const style: CSSProperties = isActive
					? { backgroundColor: config.visual.solidBg, color: config.visual.solidFg }
					: { backgroundColor: config.visual.tintedBg, color: config.visual.fg };
				return (
					<button
						key={station}
						type="button"
						aria-pressed={isActive}
						onClick={() => onToggle(station)}
						className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
						style={style}
					>
						<Icon size={12} />
						{t(config.labelKey)}
					</button>
				);
			})}
		</fieldset>
	);
}
