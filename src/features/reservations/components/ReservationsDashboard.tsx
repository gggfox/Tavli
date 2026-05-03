/**
 * Staff-facing reservations dashboard.
 *
 * - Date-range tab pills (today/week/month/quarter/year/all).
 * - Status filter chips (pending/confirmed/seated/no_show/...).
 * - Card list or table view (persisted via URL + localStorage).
 * - Per-row click opens the detail drawer.
 * - Auto-focuses the row whose ID is in `?focus=` (used by the toast deep link).
 *
 * The reservations list is a Convex reactive query, so new rows / state
 * transitions appear instantly without manual invalidation.
 */
import {
	AppDatePicker,
	DashboardShell,
	EmptyState,
	getStatusToneStyle,
	SegmentedControl,
	StatusBadge,
	StatusFilterChips,
	type StatusFilterOption,
	Surface,
	toneByValue,
} from "@/global/components";
import { todayLocalYmd } from "@/global/utils/calendarMonth";
import { ReservationsKeys } from "@/global/i18n";
import { useRestaurant } from "@/features/restaurants";
import { unwrapResult, type UnwrappedValue } from "@/global/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import type { Doc, Id } from "convex/_generated/dataModel";
import { CalendarClock, Clock, LayoutList, Table as TableIcon, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	type ReservationDashboardRangeValue,
	type ReservationsDashboardSearch,
	useReservationsDashboardPrefs,
} from "@/features/reservations/hooks/useReservationsDashboardPrefs";
import { useReservations } from "@/features/reservations/hooks/useReservations";
import {
	getReservationStatusConfig,
	RESERVATION_FALLBACK_TONE,
	RESERVATION_STATUS_CONFIG,
	type ReservationStatus,
} from "@/features/reservations/statusConfig";
import {
	ORDERED_RANGES,
	RANGE_LABEL_KEYS,
	formatTimeOnly,
	type ReservationRange,
} from "@/features/reservations/utils";
import { ReservationDetailDrawer } from "@/features/reservations/components/ReservationDetailDrawer";
import { ReservationsDashboardSkeleton } from "@/features/reservations/components/ReservationsDashboardSkeleton";
import { ReservationsTable } from "@/features/reservations/components/ReservationsTable";

const RES_DASH_DAY_ID = "reservations-dashboard-day";

type ReservationGetValue = UnwrappedValue<FunctionReturnType<typeof api.reservations.get>>;

export function ReservationsDashboard() {
	const { t, i18n } = useTranslation();
	const { restaurants, isMultiRestaurant } = useRestaurant();
	const restaurantIds = useMemo(() => restaurants.map((r) => r._id), [restaurants]);

	const restaurantNameById = useMemo(
		() => Object.fromEntries(restaurants.map((r) => [r._id, r.name] as const)),
		[restaurants]
	);

	const {
		range,
		customDay,
		rangeSegmentValue,
		setRange,
		setCustomDay,
		statusFilter,
		toggleStatus,
		viewMode,
		setViewMode,
	} = useReservationsDashboardPrefs();

	const [openId, setOpenId] = useState<Id<"reservations"> | null>(null);
	const search = useSearch({ strict: false }) as ReservationsDashboardSearch & {
		focus?: string;
	};

	const statusesForQuery = useMemo((): ReservationStatus[] | undefined => {
		if (statusFilter.size === 0) return undefined;
		return [...statusFilter].sort((a, b) => a.localeCompare(b));
	}, [statusFilter]);

	const { reservations, isLoading, error, confirm, cancel, markSeated, markCompleted } =
		useReservations(
			restaurantIds.length ? restaurantIds : undefined,
			range,
			customDay,
			statusesForQuery
		);

	const enriched = useMemo(
		() =>
			reservations.map((r) => ({
				...r,
				restaurantName: restaurantNameById[r.restaurantId],
			})),
		[reservations, restaurantNameById]
	);

	const focusId = useMemo(
		() => openId ?? (search.focus as Id<"reservations"> | undefined) ?? null,
		[openId, search.focus]
	);

	const focusedFromList = useMemo(() => {
		if (!focusId) return null;
		return reservations.find((r) => r._id === focusId) ?? null;
	}, [focusId, reservations]);

	const needsFocusedFetch = Boolean(focusId && !focusedFromList);

	const focusedFetchQuery = useQuery({
		...convexQuery(
			api.reservations.get,
			needsFocusedFetch && focusId ? { reservationId: focusId } : "skip"
		),
		enabled: needsFocusedFetch,
		select: unwrapResult<ReservationGetValue>,
	});

	const focusedReservation = useMemo(() => {
		if (!focusId) return null;
		if (focusedFromList) return focusedFromList;
		return focusedFetchQuery.data ?? null;
	}, [focusId, focusedFromList, focusedFetchQuery.data]);

	const rangeOptions = useMemo(
		(): ReadonlyArray<{ value: ReservationDashboardRangeValue; label: string }> => [
			...ORDERED_RANGES.map((r) => ({
				value: r as ReservationDashboardRangeValue,
				label: t(RANGE_LABEL_KEYS[r]),
			})),
			{
				value: "custom",
				label: t(ReservationsKeys.RANGE_CUSTOM),
			},
		],
		[t]
	);

	const viewModeOptions = useMemo(
		() => [
			{
				value: "cards" as const,
				label: t(ReservationsKeys.VIEW_MODE_CARDS),
				icon: LayoutList,
			},
			{
				value: "table" as const,
				label: t(ReservationsKeys.VIEW_MODE_TABLE),
				icon: TableIcon,
			},
		],
		[t]
	);

	const statusChipOptions = useMemo<
		ReadonlyArray<StatusFilterOption<ReservationStatus>>
	>(
		() =>
			RESERVATION_STATUS_CONFIG.map(({ value, labelKey, tone }) => ({
				value,
				label: t(labelKey),
				tone,
			})),
		[t]
	);

	const header = (
		<div className="flex flex-wrap items-center gap-3">
			<StatusFilterChips
				options={statusChipOptions}
				selected={statusFilter}
				onToggle={toggleStatus}
				ariaLabel={t(ReservationsKeys.ARIA_FILTER_STATUS)}
			/>
			<div className="ml-auto flex flex-wrap items-center gap-2">
				<SegmentedControl
					options={viewModeOptions}
					value={viewMode}
					onChange={setViewMode}
					ariaLabel={t(ReservationsKeys.ARIA_FILTER_VIEW_MODE)}
					iconOnly
					size="sm"
				/>
				<SegmentedControl<ReservationDashboardRangeValue>
					options={rangeOptions}
					value={rangeSegmentValue}
					onChange={(v) => {
						if (v === "custom") {
							setCustomDay(todayLocalYmd());
							return;
						}
						setRange(v as ReservationRange);
					}}
					ariaLabel={t(ReservationsKeys.ARIA_FILTER_RANGE)}
				/>
				<AppDatePicker
					id={RES_DASH_DAY_ID}
					label={t(ReservationsKeys.DASHBOARD_DAY_PICKER_LABEL)}
					value={customDay ?? ""}
					onChange={setCustomDay}
					localeTag={i18n.language}
				/>
			</div>
		</div>
	);

	return (
		<DashboardShell
			isLoading={isLoading}
			error={error}
			entityName="reservations"
			skeleton={<ReservationsDashboardSkeleton />}
			header={header}
			gap="6"
		>
			{enriched.length === 0 ? (
				<EmptyState
					icon={CalendarClock}
					title={t(ReservationsKeys.EMPTY_TITLE)}
					description={t(ReservationsKeys.EMPTY_DESCRIPTION)}
					fill
				/>
			) : viewMode === "table" ? (
				<ReservationsTable
					data={enriched}
					isMultiRestaurant={isMultiRestaurant}
					onOpen={setOpenId}
				/>
			) : (
				<div className="space-y-2">
					{enriched.map((r) => (
						<ReservationRow
							key={r._id}
							reservation={r}
							restaurantLabel={isMultiRestaurant ? r.restaurantName : undefined}
							onClick={() => setOpenId(r._id)}
						/>
					))}
				</div>
			)}

			{focusedReservation && (
				<ReservationDetailDrawer
					reservation={focusedReservation}
					onClose={() => setOpenId(null)}
					onConfirm={async (reservationId, tableIds) => {
						await confirm({ reservationId, tableIds });
					}}
					onCancel={async (reservationId, reason) => {
						await cancel({ reservationId, reason });
					}}
					onMarkSeated={async (reservationId, tableId) => {
						await markSeated({ reservationId, tableId });
					}}
					onMarkCompleted={async (reservationId) => {
						await markCompleted({ reservationId });
					}}
				/>
			)}
		</DashboardShell>
	);
}

function ReservationRow({
	reservation,
	restaurantLabel,
	onClick,
}: Readonly<{
	reservation: Doc<"reservations">;
	restaurantLabel?: string;
	onClick: () => void;
}>) {
	const { t, i18n } = useTranslation();
	const tone =
		toneByValue(RESERVATION_STATUS_CONFIG, reservation.status as ReservationStatus) ??
		RESERVATION_FALLBACK_TONE;
	const palette = getStatusToneStyle(tone);
	const config = getReservationStatusConfig(reservation.status);
	const label = config ? t(config.labelKey) : reservation.status;
	const startTime = formatTimeOnly(reservation.startsAt, i18n.language);

	return (
		<Surface
			as="button"
			type="button"
			onClick={onClick}
			tone="secondary"
			className="w-full flex items-center justify-between gap-4 px-4 py-3 text-left"
		>
			<div className="flex items-center gap-3 min-w-0">
				<StatusBadge bgColor={palette.solidBg} textColor={palette.solidFg} label={label} />
				<span className="text-sm font-medium truncate text-foreground">
					{reservation.contact.name}
				</span>
				{restaurantLabel ? (
					<span className="text-xs text-faint-foreground truncate max-w-[8rem]">
						· {restaurantLabel}
					</span>
				) : null}
				<span className="text-xs flex items-center gap-1 text-faint-foreground">
					<Users size={12} /> {reservation.partySize}
				</span>
			</div>
			<div className="flex items-center gap-3 shrink-0">
				<span className="text-xs flex items-center gap-1 text-muted-foreground">
					<Clock size={12} />
					{startTime}
				</span>
				<span className="text-xs text-faint-foreground">
					{new Date(reservation.startsAt).toLocaleDateString(i18n.language)}
				</span>
			</div>
		</Surface>
	);
}
