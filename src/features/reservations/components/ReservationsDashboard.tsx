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
	type StatusTone,
	Surface,
	toneByValue,
} from "@/global/components";
import { useSearch } from "@tanstack/react-router";
import type { Doc, Id } from "convex/_generated/dataModel";
import { CalendarClock, Clock, Users } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useReservations } from "../hooks/useReservations";
import {
	ORDERED_RANGES,
	RANGE_LABELS,
	type ReservationRange,
	formatTimeOnly,
} from "../utils";
import { ReservationDetailDrawer } from "./ReservationDetailDrawer";
import { ReservationsDashboardSkeleton } from "./ReservationsDashboardSkeleton";

type StatusValue =
	| "pending"
	| "confirmed"
	| "seated"
	| "completed"
	| "cancelled"
	| "no_show";

const STATUS_CHIPS: ReadonlyArray<StatusFilterOption<StatusValue>> = [
	{ value: "pending", label: "Pending", tone: "warning" },
	{ value: "confirmed", label: "Confirmed", tone: "info" },
	{ value: "seated", label: "Seated", tone: "success" },
	{ value: "completed", label: "Completed", tone: "neutral" },
	{ value: "cancelled", label: "Cancelled", tone: "danger" },
	{ value: "no_show", label: "No show", tone: "warning" },
];

const FALLBACK_TONE: StatusTone = "neutral";

interface ReservationsDashboardProps {
	restaurantId: Id<"restaurants">;
}

export function ReservationsDashboard({ restaurantId }: Readonly<ReservationsDashboardProps>) {
	const [range, setRange] = useState<ReservationRange>("today");
	const [statusFilter, setStatusFilter] = useState<Set<StatusValue>>(new Set());
	const [openId, setOpenId] = useState<Id<"reservations"> | null>(null);
	const search = useSearch({ strict: false }) as { focus?: string };

	const { reservations, isLoading, error, confirm, cancel, markSeated, markCompleted } =
		useReservations(restaurantId, range);

	const toggleStatus = useCallback((value: StatusValue) => {
		setStatusFilter((prev) => {
			const next = new Set(prev);
			if (next.has(value)) next.delete(value);
			else next.add(value);
			return next;
		});
	}, []);

	const filtered = useMemo(() => {
		if (statusFilter.size === 0) return reservations;
		return reservations.filter((r) => statusFilter.has(r.status as StatusValue));
	}, [reservations, statusFilter]);

	const focusedReservation = useMemo(() => {
		const id = openId ?? (search.focus as Id<"reservations"> | undefined) ?? null;
		if (!id) return null;
		return reservations.find((r) => r._id === id) ?? null;
	}, [openId, search.focus, reservations]);

	const header = (
		<div className="flex flex-col gap-3">
			<SegmentedControl
				options={ORDERED_RANGES.map((r) => ({ value: r, label: RANGE_LABELS[r] }))}
				value={range}
				onChange={setRange}
				ariaLabel="Filter reservations by date range"
			/>
			<StatusFilterChips
				options={STATUS_CHIPS}
				selected={statusFilter}
				onToggle={toggleStatus}
				ariaLabel="Filter reservations by status"
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
					title="No reservations in this view."
					description="Try a different range or status filter."
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
	const tone = toneByValue(STATUS_CHIPS, reservation.status as StatusValue) ?? FALLBACK_TONE;
	const palette = getStatusToneStyle(tone);
	const chipMeta = STATUS_CHIPS.find((c) => c.value === reservation.status);
	const label = chipMeta?.label ?? reservation.status;

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
					className="text-sm font-medium truncate"
					style={{ color: "var(--text-primary)" }}
				>
					{reservation.contact.name}
				</span>
				<span
					className="text-xs flex items-center gap-1"
					style={{ color: "var(--text-muted)" }}
				>
					<Users size={12} /> {reservation.partySize}
				</span>
			</div>
			<div className="flex items-center gap-3 shrink-0">
				<span
					className="text-xs flex items-center gap-1"
					style={{ color: "var(--text-secondary)" }}
				>
					<Clock size={12} />
					{formatTimeOnly(reservation.startsAt)}
				</span>
				<span className="text-xs" style={{ color: "var(--text-muted)" }}>
					{new Date(reservation.startsAt).toLocaleDateString()}
				</span>
			</div>
		</Surface>
	);
}
