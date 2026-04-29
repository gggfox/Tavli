import type { OrderDashboardStatusFilter } from "@/features";
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
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrders } from "../../hooks/useOrders";
import { OrderCard } from "./OrderCard";
import { OrderDashboardSkeleton } from "./OrderDashboardSkeleton";
import { OrderDetailModal } from "./OrderDetailModal";
import {
	ALL_STATUSES,
	DEFAULT_STATUS_FILTERS,
	isDashboardStatus,
	STATUS_CONFIG,
	STATUS_SORT_PRIORITY,
	type DashboardOrder,
} from "./statusConfig";

interface OrderDashboardProps {
	restaurantId: Id<"restaurants">;
}

export function OrderDashboard({ restaurantId }: Readonly<OrderDashboardProps>) {
	const { t } = useTranslation();
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
							onSelectFullOrder={setFullOrder}
							onRequestCancel={setCancelConfirm}
							onDismissCancel={() => setCancelConfirm(null)}
							onUpdateStatus={updateStatus}
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
