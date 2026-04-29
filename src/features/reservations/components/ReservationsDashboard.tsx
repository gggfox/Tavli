/**
 * Staff-facing reservations dashboard.
 *
 * - Date-range tab pills (today/week/month/quarter/year/all).
 * - Status filter chips (pending/confirmed/seated/no_show/...).
 * - Per-row click opens the detail drawer.
 * - Auto-focuses the row whose ID is in `?focus=` (used by the toast deep link).
 *
 * The reservations list is a Convex reactive query, so new rows / state
 * transitions appear instantly without manual invalidation.
 */
import {
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
import { ReservationsKeys } from "@/global/i18n";
import { useSearch } from "@tanstack/react-router";
import type { Doc, Id } from "convex/_generated/dataModel";
import { CalendarClock, Clock, Users } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useReservations } from "../hooks/useReservations";
import {
	getReservationStatusConfig,
	RESERVATION_FALLBACK_TONE,
	RESERVATION_STATUS_CONFIG,
	type ReservationStatus,
} from "../statusConfig";
import {
	ORDERED_RANGES,
	RANGE_LABEL_KEYS,
	type ReservationRange,
	formatTimeOnly,
} from "../utils";
import { ReservationDetailDrawer } from "./ReservationDetailDrawer";
import { ReservationsDashboardSkeleton } from "./ReservationsDashboardSkeleton";

interface ReservationsDashboardProps {
	restaurantId: Id<"restaurants">;
}

export function ReservationsDashboard({ restaurantId }: Readonly<ReservationsDashboardProps>) {
	const { t } = useTranslation();
	const [range, setRange] = useState<ReservationRange>("today");
	const [statusFilter, setStatusFilter] = useState<Set<ReservationStatus>>(new Set());
	const [openId, setOpenId] = useState<Id<"reservations"> | null>(null);
	const search = useSearch({ strict: false }) as { focus?: string };

	const { reservations, isLoading, error, confirm, cancel, markSeated, markCompleted } =
		useReservations(restaurantId, range);

	const toggleStatus = useCallback((value: ReservationStatus) => {
		setStatusFilter((prev) => {
			const next = new Set(prev);
			if (next.has(value)) next.delete(value);
			else next.add(value);
			return next;
		});
	}, []);

	const filtered = useMemo(() => {
		if (statusFilter.size === 0) return reservations;
		return reservations.filter((r) => statusFilter.has(r.status as ReservationStatus));
	}, [reservations, statusFilter]);

	const focusedReservation = useMemo(() => {
		const id = openId ?? (search.focus as Id<"reservations"> | undefined) ?? null;
		if (!id) return null;
		return reservations.find((r) => r._id === id) ?? null;
	}, [openId, search.focus, reservations]);

	const rangeOptions = useMemo(
		() => ORDERED_RANGES.map((r) => ({ value: r, label: t(RANGE_LABEL_KEYS[r]) })),
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
		<div className="flex flex-col gap-3">
			<SegmentedControl
				options={rangeOptions}
				value={range}
				onChange={setRange}
				ariaLabel={t(ReservationsKeys.ARIA_FILTER_RANGE)}
			/>
			<StatusFilterChips
				options={statusChipOptions}
				selected={statusFilter}
				onToggle={toggleStatus}
				ariaLabel={t(ReservationsKeys.ARIA_FILTER_STATUS)}
			/>
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
			{filtered.length === 0 ? (
				<EmptyState
					icon={CalendarClock}
					title={t(ReservationsKeys.EMPTY_TITLE)}
					description={t(ReservationsKeys.EMPTY_DESCRIPTION)}
					fill
				/>
			) : (
				<div className="space-y-2">
					{filtered.map((r) => (
						<ReservationRow
							key={r._id}
							reservation={r}
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
	onClick,
}: Readonly<{ reservation: Doc<"reservations">; onClick: () => void }>) {
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
				<span
					className="text-sm font-medium truncate text-foreground"
					
				>
					{reservation.contact.name}
				</span>
				<span
					className="text-xs flex items-center gap-1 text-faint-foreground"
					
				>
					<Users size={12} /> {reservation.partySize}
				</span>
			</div>
			<div className="flex items-center gap-3 shrink-0">
				<span
					className="text-xs flex items-center gap-1 text-muted-foreground"
					
				>
					<Clock size={12} />
					{startTime}
				</span>
				<span className="text-xs text-faint-foreground" >
					{new Date(reservation.startsAt).toLocaleDateString(i18n.language)}
				</span>
			</div>
		</Surface>
	);
}
