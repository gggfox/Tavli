import type { OrderDashboardPrepStationFilter, OrderDashboardStatusFilterValue } from "@/features";
import { useUserSettings } from "@/features/users/hooks/useUserSettings";
import {
	DashboardShell,
	EmptyState,
	SegmentedControl,
	VirtualGrid,
	type SegmentedControlOption,
} from "@/global/components";
import { useConvexMutate, useOptimisticUserSetting } from "@/global/hooks";
import { getErrorMessage } from "@/global/utils";
import { OrdersKeys } from "@/global/i18n";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { SERVED_VISIBLE_WINDOW_MS } from "convex/constants";
import { isServedOrderVisible } from "convex/orderHelpers";
import { ChefHat, UserCheck, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrders, useOrderScopeContext, useOrderStatusCounts } from "../../hooks/useOrders";
import { OrderCard } from "./OrderCard";
import { OrderDashboardSkeleton } from "./OrderDashboardSkeleton";
import { OrderDetailModal } from "./OrderDetailModal";
import { StationTicketCard } from "./StationTicketCard";
import { SubstitutionProposalDialog, type SubstitutionTarget } from "./SubstitutionProposalDialog";
import { deriveStationTickets, type StationTicket } from "./stationTickets";
import {
	ALL_SCOPE_VALUES,
	DEFAULT_SCOPE,
	SCOPE_ICON,
	SCOPE_LABEL_KEY,
	type ScopeFilterValue,
} from "./scopeConfig";
import {
	ALL_SERVICE_DATE_VALUES,
	DEFAULT_SERVICE_DATE,
	SERVICE_DATE_ICON,
	SERVICE_DATE_LABEL_KEY,
	type ServiceDateFilterValue,
} from "./serviceDateConfig";
import {
	ALL_STATION_FILTER_VALUES,
	STATION_CONFIG,
	STATION_FILTER_ICON,
	STATION_FILTER_LABEL_KEY,
	stationFilterToValue,
	stationValueToFilters,
	type StationFilterValue,
} from "./stationConfig";
import {
	ALL_STATUSES,
	collapseLegacyStatusFilters,
	DEFAULT_STATUS,
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

/** The served window, in the unit the copy talks in. */
const SERVED_WINDOW_MINUTES = Math.round(SERVED_VISIBLE_WINDOW_MS / 60_000);

interface OrderDashboardProps {
	restaurantId: Id<"restaurants">;
}

export function OrderDashboard({ restaurantId }: Readonly<OrderDashboardProps>) {
	const { t } = useTranslation();
	const {
		orderDashboardStatusFilter,
		orderDashboardStatusFilters,
		updateOrderDashboardStatusFilter,
		orderDashboardPrepStationFilters,
		updateOrderDashboardPrepStationFilters,
		orderDashboardServiceDateFilter,
		updateOrderDashboardServiceDateFilter,
		orderDashboardScope,
		updateOrderDashboardScope,
	} = useUserSettings();
	const [cancelConfirm, setCancelConfirm] = useState<string | null>(null);
	const [cancelPendingId, setCancelPendingId] = useState<string | null>(null);
	// Mark-paid-in-person confirm flow (ADR 008). Single slot like the cancel
	// confirm above: only one card shows the confirmation at a time.
	const [markPaidConfirm, setMarkPaidConfirm] = useState<string | null>(null);
	const [markPaidPendingId, setMarkPaidPendingId] = useState<string | null>(null);
	const [markPaidError, setMarkPaidError] = useState<string | null>(null);
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
	// Line a substitution is being proposed for (ADR 008); opens the dialog.
	const [substitutionTarget, setSubstitutionTarget] = useState<SubstitutionTarget | null>(null);
	// Single slot: a second bump replaces the pending undo rather than stacking
	// strips. The window is short and the latest bump is the one a mistap is
	// most likely to belong to.
	const [undoStamp, setUndoStamp] = useState<{
		orderId: DashboardOrder["_id"];
		station: OrderDashboardPrepStationFilter;
		orderLabel: string;
	} | null>(null);

	// The new single-select setting wins; a user who never touched the new
	// control falls back to the collapse of their legacy multi-select array
	// (same rule as the Phase 0 backfill migration); a brand-new user starts
	// on the queue ("submitted"). Writes always go to the new setting.
	const serverStatus =
		orderDashboardStatusFilter ?? collapseLegacyStatusFilters(orderDashboardStatusFilters);
	const [selectedStatus, setSelectedStatus] =
		useOptimisticUserSetting<OrderDashboardStatusFilterValue>({
			serverValue: serverStatus,
			persist: updateOrderDashboardStatusFilter,
			fallback: DEFAULT_STATUS,
		});

	const [activeStationFilters, setActiveStationFilters] = useOptimisticUserSetting<
		OrderDashboardPrepStationFilter[]
	>({
		serverValue: orderDashboardPrepStationFilters,
		persist: updateOrderDashboardPrepStationFilters,
		fallback: DEFAULT_PREP_STATION_FILTERS,
	});

	const [selectedServiceDate, setSelectedServiceDate] =
		useOptimisticUserSetting<ServiceDateFilterValue>({
			serverValue: orderDashboardServiceDateFilter,
			persist: updateOrderDashboardServiceDateFilter,
			fallback: DEFAULT_SERVICE_DATE,
		});

	// Who the caller is on the floor right now. Drives both whether the scope
	// control appears at all and, for someone who has never touched it, which
	// side it starts on.
	const scopeContext = useOrderScopeContext(restaurantId);
	const canScope = scopeContext?.canScopeToOwnSections ?? false;

	// The fallback is the role-derived default: a server working a server
	// shift opens onto their own section, everyone else onto the whole floor.
	// It only applies until the user picks a side themselves, at which point
	// the persisted value wins on every device.
	const [storedScope, setStoredScope] = useOptimisticUserSetting<ScopeFilterValue>({
		serverValue: orderDashboardScope,
		persist: updateOrderDashboardScope,
		fallback: scopeContext?.defaultsToMine ? "mine" : DEFAULT_SCOPE,
	});

	// A stored "mine" must not strand someone who has since left the roster on
	// a board that can only ever be empty: without a membership there is no
	// section to scope to, so the whole floor is the only honest answer.
	const selectedScope: ScopeFilterValue = canScope ? storedScope : "all";

	// Pass `undefined` (not `[]`) when no station filter is active so the
	// query treats it as "no filter" and short-circuits the per-order
	// presence check on the server side.
	const queryStations = activeStationFilters.length > 0 ? activeStationFilters : undefined;

	// Strict single-select: the query only ever asks for the one visible status.
	const queryStatuses = useMemo(() => [selectedStatus], [selectedStatus]);

	const {
		orders,
		isLoading,
		error,
		updateStatus,
		markStationReady,
		unmarkStationReady,
		cancelOrderItem,
		cancelOrderAndRefund,
		markOrderPaidInPerson,
	} = useOrders(restaurantId, queryStatuses, queryStations, selectedServiceDate, selectedScope);

	// Exactly one station selected → that station gets its own tickets. With no
	// filter or both stations selected the dashboard stays the whole-order
	// overview, where money, cross-station progress, and cancel live.
	// `awaiting_payment` never enters rail mode (ADR 008): those orders carry
	// money actions, not station work, so the ordinary card grid stays up even
	// with a single station selected.
	const ticketStation =
		selectedStatus !== "awaiting_payment" && activeStationFilters.length === 1
			? activeStationFilters[0]
			: null;

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

	// On success the order flips to `submitted` server-side and leaves the
	// awaiting-payment view through the live query subscription — no manual
	// refetch. Errors stay pinned to the confirm panel: money is involved, so
	// a silent failure is not acceptable.
	const handleMarkPaidInPerson = useCallback(
		async (orderId: DashboardOrder["_id"]) => {
			setMarkPaidPendingId(orderId);
			setMarkPaidError(null);
			try {
				const [, markError] = await markOrderPaidInPerson({ orderId });
				if (markError) {
					setMarkPaidError(getErrorMessage(markError, t));
					return;
				}
				setMarkPaidConfirm(null);
			} catch (err) {
				setMarkPaidError(getErrorMessage(err, t));
			} finally {
				setMarkPaidPendingId(null);
			}
		},
		[markOrderPaidInPerson, t]
	);

	const handleRequestMarkPaid = useCallback((orderId: string) => {
		setMarkPaidError(null);
		setMarkPaidConfirm(orderId);
	}, []);

	const handleDismissMarkPaid = useCallback(() => {
		setMarkPaidError(null);
		setMarkPaidConfirm(null);
	}, []);

	// Per-segment card counts, under the same station filter and scope as the
	// board — a count that disagreed with the cards behind it would read as a
	// bug.
	const statusCounts = useOrderStatusCounts(
		restaurantId,
		queryStations,
		selectedServiceDate,
		selectedScope
	);

	// Pending substitution proposals for the badge + withdraw affordances on
	// station tickets (ADR 008). Live query — a diner answering removes the
	// badge without a refetch.
	const { data: pendingProposals = [] } = useQuery(
		convexQuery(api.substitutions.getPendingForRestaurant, { restaurantId })
	);
	const pendingProposalsByItem = useMemo(() => {
		const map = new Map<string, Id<"substitutionProposals">>();
		for (const proposal of pendingProposals as Doc<"substitutionProposals">[]) {
			map.set(proposal.orderItemId, proposal._id);
		}
		return map;
	}, [pendingProposals]);

	const proposeSubstitution = useConvexMutate(api.substitutions.proposeSubstitution);
	const cancelProposal = useConvexMutate(api.substitutions.cancelProposal);

	const handleProposeSubstitution = useCallback(
		async (args: {
			orderId: DashboardOrder["_id"];
			orderItemId: DashboardOrderItem["_id"];
			proposedMenuItemId: Id<"menuItems">;
		}) => {
			const [, proposeError] = await proposeSubstitution.mutateAsync(args);
			// Surfaced by the dialog through getErrorMessage.
			if (proposeError) throw proposeError;
		},
		[proposeSubstitution]
	);

	const handleCancelProposal = useCallback(
		async (proposalId: Id<"substitutionProposals">) => {
			try {
				await cancelProposal.mutateAsync({ proposalId });
			} catch (err) {
				// Already answered/withdrawn — the live query reflects reality.
				console.error("[OrderDashboard] cancelProposal failed", err);
			}
		},
		[cancelProposal]
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

	const activeStationFilterSet = useMemo<ReadonlySet<OrderDashboardPrepStationFilter>>(
		() => new Set(activeStationFilters),
		[activeStationFilters]
	);

	const statusSegments = useMemo<
		ReadonlyArray<SegmentedControlOption<OrderDashboardStatusFilterValue>>
	>(
		() =>
			ALL_STATUSES.map((status) => {
				const tally = statusCounts?.[status];
				return {
					value: status,
					// No count until the query resolves — a momentary "(0)" on a
					// segment that in fact has work would be worse than no number.
					label:
						tally === undefined
							? t(STATUS_CONFIG[status].labelKey)
							: `${t(STATUS_CONFIG[status].labelKey)} (${tally.count}${tally.capped ? "+" : ""})`,
					tone: STATUS_CONFIG[status].tone,
					icon: STATUS_CONFIG[status].icon,
				};
			}),
		[t, statusCounts]
	);

	const stationSegments = useMemo<ReadonlyArray<SegmentedControlOption<StationFilterValue>>>(
		() =>
			ALL_STATION_FILTER_VALUES.map((station) => ({
				value: station,
				label: t(STATION_FILTER_LABEL_KEY[station]),
				icon: STATION_FILTER_ICON[station],
			})),
		[t]
	);

	const scopeSegments = useMemo<ReadonlyArray<SegmentedControlOption<ScopeFilterValue>>>(
		() =>
			ALL_SCOPE_VALUES.map((value) => ({
				value,
				label: t(SCOPE_LABEL_KEY[value]),
				icon: SCOPE_ICON[value],
			})),
		[t]
	);

	const serviceDateSegments = useMemo<
		ReadonlyArray<SegmentedControlOption<ServiceDateFilterValue>>
	>(
		() =>
			ALL_SERVICE_DATE_VALUES.map((value) => ({
				value,
				label: t(SERVICE_DATE_LABEL_KEY[value]),
				icon: SERVICE_DATE_ICON[value],
			})),
		[t]
	);

	const stationFilterValue = stationFilterToValue(activeStationFilters);

	const handleStationFilterChange = useCallback(
		(next: StationFilterValue) => setActiveStationFilters(stationValueToFilters(next)),
		[setActiveStationFilters]
	);

	const filterPills = (
		<div className="flex flex-wrap items-center justify-between gap-2">
			<SegmentedControl
				options={statusSegments}
				value={selectedStatus}
				onChange={setSelectedStatus}
				ariaLabel={t(OrdersKeys.ARIA_STATUS_SEGMENTS)}
				size="sm"
			/>
			<div className="flex flex-wrap items-center gap-2">
				{/* Only offered to someone the floor plan can actually scope: an
				    owner or admin who is not on this restaurant's roster has no
				    section, so the control would be a dead end. */}
				{canScope && (
					<SegmentedControl
						options={scopeSegments}
						value={storedScope}
						onChange={setStoredScope}
						ariaLabel={t(OrdersKeys.ARIA_SCOPE_FILTER)}
						size="sm"
					/>
				)}
				<SegmentedControl
					options={stationSegments}
					value={stationFilterValue}
					onChange={handleStationFilterChange}
					ariaLabel={t(OrdersKeys.ARIA_STATION_FILTER)}
					size="sm"
				/>
				<SegmentedControl
					options={serviceDateSegments}
					value={selectedServiceDate}
					onChange={setSelectedServiceDate}
					ariaLabel={t(OrdersKeys.ARIA_SERVICE_DATE_FILTER)}
					size="sm"
				/>
			</div>
		</div>
	);

	const typedOrders = orders as ReadonlyArray<DashboardOrder>;

	// `now` is in the dependency list on purpose: the served window is the one
	// filter that expires on the clock rather than on a write, and a Convex
	// subscription only re-runs when the data it read changes. The server
	// keeps stale served rows off the wire; this keeps the last card of the
	// night from sitting on an idle board (TAVLI-84).
	const sorted = useMemo(
		() =>
			typedOrders
				.filter((o) => isDashboardStatus(o.status) && isServedOrderVisible(o, now))
				.slice()
				.sort((a, b) => {
					const aPriority = STATUS_SORT_PRIORITY[a.status as OrderDashboardStatusFilterValue];
					const bPriority = STATUS_SORT_PRIORITY[b.status as OrderDashboardStatusFilterValue];
					return aPriority - bPriority || a.createdAt - b.createdAt;
				}),
		[typedOrders, now]
	);

	const renderOrderCard = useCallback(
		(order: DashboardOrder) => (
			<OrderCard
				order={order}
				now={now}
				cancelConfirm={cancelConfirm}
				cancelPendingId={cancelPendingId}
				markPaidConfirm={markPaidConfirm}
				markPaidPendingId={markPaidPendingId}
				markPaidError={markPaidError}
				activeStationFilters={activeStationFilterSet}
				onSelectFullOrder={setFullOrder}
				onRequestCancel={setCancelConfirm}
				onDismissCancel={() => setCancelConfirm(null)}
				onCancelOrder={handleCancelOrder}
				onRequestMarkPaid={handleRequestMarkPaid}
				onDismissMarkPaid={handleDismissMarkPaid}
				onMarkPaidInPerson={handleMarkPaidInPerson}
				onUpdateStatus={updateStatus}
				onMarkStationReady={markStationReady}
			/>
		),
		[
			now,
			cancelConfirm,
			cancelPendingId,
			markPaidConfirm,
			markPaidPendingId,
			markPaidError,
			activeStationFilterSet,
			handleCancelOrder,
			handleRequestMarkPaid,
			handleDismissMarkPaid,
			handleMarkPaidInPerson,
			updateStatus,
			markStationReady,
		]
	);

	const stationTickets = useMemo(
		() => (ticketStation ? deriveStationTickets(sorted, ticketStation) : []),
		[sorted, ticketStation]
	);

	// Scoped to a section the caller does not have. This answers for the whole
	// board, ahead of the station-rail and card-grid branches below: "all
	// caught up" would be a lie when the real reason the board is blank is
	// that nobody assigned this server a section for the shift they are on.
	const scopedWithoutSection =
		selectedScope === "mine" && scopeContext?.hasActiveCoverage === false;

	const renderStationTicket = useCallback(
		(ticket: StationTicket) => (
			<StationTicketCard
				ticket={ticket}
				now={now}
				cancelItemPendingId={cancelItemPendingId}
				cancelItemError={cancelItemError}
				pendingProposalsByItem={pendingProposalsByItem}
				onSelectFullOrder={setFullOrder}
				onUpdateStatus={updateStatus}
				onMarkStationReady={handleMarkStationReadyFromTicket}
				onCancelItem={handleCancelItem}
				onProposeSubstitution={setSubstitutionTarget}
				onCancelProposal={handleCancelProposal}
			/>
		),
		[
			now,
			cancelItemPendingId,
			cancelItemError,
			pendingProposalsByItem,
			updateStatus,
			handleMarkStationReadyFromTicket,
			handleCancelItem,
			handleCancelProposal,
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

			{/* Standing note, not only an empty state: a manager looking at two
			    cards after a busy service needs to know the rest aged off the
			    board rather than vanished. */}
			{selectedStatus === "served" && (
				<p className="mb-3 text-xs text-muted-foreground">
					{t(OrdersKeys.SERVED_WINDOW_HINT, { minutes: SERVED_WINDOW_MINUTES })}
				</p>
			)}

			{scopedWithoutSection ? (
				<EmptyState
					icon={UserCheck}
					title={t(OrdersKeys.EMPTY_NO_ACTIVE_SECTION)}
					description={t(OrdersKeys.EMPTY_NO_ACTIVE_SECTION_HINT)}
					fill
				/>
			) : ticketStation ? (
				stationTickets.length === 0 ? (
					<EmptyState
						icon={STATION_CONFIG[ticketStation].icon}
						title={t(OrdersKeys.TICKET_EMPTY_ALL_DONE, {
							station: t(STATION_CONFIG[ticketStation].labelKey),
						})}
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
						uniformCardHeight
					/>
				)
			) : sorted.length === 0 ? (
				<EmptyState
					icon={ChefHat}
					title={
						selectedStatus === "served"
							? t(OrdersKeys.EMPTY_NO_RECENT_SERVED, { minutes: SERVED_WINDOW_MINUTES })
							: selectedScope === "mine"
								? t(OrdersKeys.EMPTY_NO_ORDERS_IN_MY_SECTIONS)
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
					uniformCardHeight
				/>
			)}

			<OrderDetailModal fullOrder={fullOrder} now={now} onClose={() => setFullOrder(null)} />

			{substitutionTarget && (
				<SubstitutionProposalDialog
					restaurantId={restaurantId}
					target={substitutionTarget}
					onClose={() => setSubstitutionTarget(null)}
					onPropose={handleProposeSubstitution}
				/>
			)}
		</DashboardShell>
	);
}
