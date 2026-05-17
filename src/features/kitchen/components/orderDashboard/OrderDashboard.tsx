import type {
	OrderDashboardPrepStationFilter,
	OrderDashboardStatusFilter,
} from "@/features";
import { useUserSettings } from "@/features/users/hooks/useUserSettings";
import {
	DashboardShell,
	EmptyState,
	StatusFilterChips,
	type StatusFilterOption,
} from "@/global/components";
import { useOptimisticUserSetting } from "@/global/hooks";
import { OrdersKeys } from "@/global/i18n";
import type { Id } from "convex/_generated/dataModel";
import { ChefHat } from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrders } from "../../hooks/useOrders";
import { OrderCard } from "./OrderCard";
import { OrderDashboardSkeleton } from "./OrderDashboardSkeleton";
import { OrderDetailModal } from "./OrderDetailModal";
import { ALL_PREP_STATIONS, STATION_CONFIG } from "./stationConfig";
import {
	ALL_STATUSES,
	DEFAULT_STATUS_FILTERS,
	isDashboardStatus,
	STATUS_CONFIG,
	STATUS_SORT_PRIORITY,
	type DashboardOrder,
} from "./statusConfig";

/**
 * Default prep-station filter set: empty = "no station filter applied"
 * (= show all stations). Mirrors the `null`/`[]` semantics of the
 * persisted user setting. See ADR 005.
 */
const DEFAULT_PREP_STATION_FILTERS: OrderDashboardPrepStationFilter[] = [];

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
	const [fullOrder, setFullOrder] = useState<DashboardOrder | null>(null);
	const [now, setNow] = useState(() => Date.now());

	const [activeFilters, setActiveFilters] = useOptimisticUserSetting<
		OrderDashboardStatusFilter[]
	>({
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
	const queryStations =
		activeStationFilters.length > 0 ? activeStationFilters : undefined;

	const { orders, isLoading, error, updateStatus, markStationReady } = useOrders(
		restaurantId,
		activeFilters,
		queryStations
	);

	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), 30_000);
		return () => clearInterval(id);
	}, []);

	const activeFilterSet = useMemo(() => new Set(activeFilters), [activeFilters]);
	const activeStationFilterSet = useMemo<
		ReadonlySet<OrderDashboardPrepStationFilter>
	>(() => new Set(activeStationFilters), [activeStationFilters]);

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

	const sorted = typedOrders
		.filter((o) => isDashboardStatus(o.status))
		.slice()
		.sort((a, b) => {
			const aPriority = STATUS_SORT_PRIORITY[a.status as OrderDashboardStatusFilter];
			const bPriority = STATUS_SORT_PRIORITY[b.status as OrderDashboardStatusFilter];
			return aPriority - bPriority || a.createdAt - b.createdAt;
		});

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
					{sorted.map((order) => (
						<OrderCard
							key={order._id}
							order={order}
							now={now}
							cancelConfirm={cancelConfirm}
							activeStationFilters={activeStationFilterSet}
							onSelectFullOrder={setFullOrder}
							onRequestCancel={setCancelConfirm}
							onDismissCancel={() => setCancelConfirm(null)}
							onUpdateStatus={updateStatus}
							onMarkStationReady={markStationReady}
						/>
					))}
				</div>
			)}

			<OrderDetailModal
				fullOrder={fullOrder}
				now={now}
				onClose={() => setFullOrder(null)}
			/>
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
