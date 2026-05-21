import { useRestaurant } from "@/features/restaurants";
import { useTimelineData } from "@/features/reservations/hooks/useTimelineData";
import {
	getReservationStatusConfig,
	RESERVATION_FALLBACK_TONE,
} from "@/features/reservations/statusConfig";
import { formatTimeOnly } from "@/features/reservations/utils";
import type { ReservationRange } from "@/features/reservations/utils";
import { getStatusToneStyle, type StatusTone } from "@/global/components";
import { ReservationsKeys } from "@/global/i18n";
import type { Doc, Id } from "convex/_generated/dataModel";
import {
	ChevronDown,
	ChevronRight,
	Globe,
	MessageCircle,
	UserPlus,
	Users,
} from "lucide-react";
import { todayLocalYmd, ymdToLocalDate } from "@/global/utils/calendarMonth";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export interface TimelineCreateIntent {
	tableId: Id<"tables">;
	tableLabel: string;
	startsAt: number;
}

interface ReservationTimelineProps {
	readonly restaurantIds: Id<"restaurants">[];
	readonly range: ReservationRange;
	readonly customDay: string | undefined;
	readonly selectedDay: string;
	readonly onOpenReservation: (id: Id<"reservations">) => void;
	readonly onCreateReservation?: (intent: TimelineCreateIntent) => void;
}

export function ReservationTimeline({
	restaurantIds,
	range,
	customDay,
	selectedDay,
	onOpenReservation,
	onCreateReservation,
}: ReservationTimelineProps) {
	const { restaurant } = useRestaurant();
	const restaurantId = restaurantIds[0] ?? null;

	const {
		sections,
		reservationsByTable,
		unassignedReservations,
		locksByTable,
		openHour,
		closeHour,
		isLoading,
	} = useTimelineData(restaurantId, restaurant, range, customDay);

	const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
	const { t, i18n } = useTranslation();

	const toggleSection = useCallback((sectionId: string) => {
		setCollapsedSections((prev) => {
			const next = new Set(prev);
			if (next.has(sectionId)) next.delete(sectionId);
			else next.add(sectionId);
			return next;
		});
	}, []);

	const hours = useMemo(() => {
		const result: number[] = [];
		const effectiveClose = closeHour <= openHour ? closeHour + 24 : closeHour;
		for (let h = openHour; h <= effectiveClose; h++) {
			result.push(h % 24);
		}
		return result;
	}, [openHour, closeHour]);

	const hourCount = hours.length;

	if (isLoading) {
		return (
			<div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
				Loading timeline...
			</div>
		);
	}

	if (sections.length === 0 && unassignedReservations.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-sm gap-2">
				<p className="font-medium">{t(ReservationsKeys.TIMELINE_EMPTY_TITLE)}</p>
				<p className="text-xs">{t(ReservationsKeys.TIMELINE_EMPTY_DESCRIPTION)}</p>
			</div>
		);
	}

	return (
		<div className="overflow-x-auto rounded-lg border border-border">
			<div
				role="grid"
				className="min-w-[900px] grid"
				style={{
					gridTemplateColumns: `minmax(140px, 180px) repeat(${hourCount}, minmax(80px, 1fr))`,
				}}
			>
				{/* Header row */}
				<div
					role="columnheader"
					className="sticky left-0 z-20 bg-muted text-xs font-semibold text-faint-foreground px-3 py-2 border-b border-border"
				>
					{t(ReservationsKeys.COLUMN_TABLES)}
				</div>
				{hours.map((h) => (
					<div
						key={h}
						role="columnheader"
						className="bg-muted text-xs font-semibold text-faint-foreground px-2 py-2 border-b border-l border-border text-center"
					>
						{String(h).padStart(2, "0")}:00
					</div>
				))}

				{/* Unassigned row */}
				{unassignedReservations.length > 0 && (
					<UnassignedRow
						reservations={unassignedReservations}
						hours={hours}
						hourCount={hourCount}
						openHour={openHour}
						locale={i18n.language}
						onOpenReservation={onOpenReservation}
					/>
				)}

				{/* Section groups */}
				{sections.map((sg) => {
					const sectionKey = sg.section._id as string;
					const isCollapsed = collapsedSections.has(sectionKey);
					return (
					<SectionGroup
						key={sectionKey}
						section={sg.section}
						tables={sg.tables}
						isCollapsed={isCollapsed}
						onToggle={() => toggleSection(sectionKey)}
						reservationsByTable={reservationsByTable}
						locksByTable={locksByTable}
						hours={hours}
						hourCount={hourCount}
						openHour={openHour}
						locale={i18n.language}
						selectedDay={selectedDay}
						onOpenReservation={onOpenReservation}
						onCreateReservation={onCreateReservation}
					/>
					);
				})}
			</div>
		</div>
	);
}

/* ============================================================================
 * Unassigned Row
 * ============================================================================ */

interface UnassignedRowProps {
	readonly reservations: Doc<"reservations">[];
	readonly hours: number[];
	readonly hourCount: number;
	readonly openHour: number;
	readonly locale: string;
	readonly onOpenReservation: (id: Id<"reservations">) => void;
}

function UnassignedRow({
	reservations,
	hours,
	hourCount,
	openHour,
	locale,
	onOpenReservation,
}: UnassignedRowProps) {
	const { t } = useTranslation();
	return (
		<>
			<div
				role="rowheader"
				className="sticky left-0 z-10 bg-amber-50 dark:bg-amber-950/30 border-b border-border px-3 py-2 flex items-center text-xs font-medium text-amber-700 dark:text-amber-400"
			>
				{t(ReservationsKeys.TIMELINE_UNASSIGNED_ROW)}
			</div>
			<div
				className="border-b border-border bg-amber-50/50 dark:bg-amber-950/20 col-span-full relative"
				style={{ gridColumn: `2 / span ${hourCount}` }}
			>
				<TimelineRowContent
					reservations={reservations}
					locks={[]}
					hours={hours}
					hourCount={hourCount}
					openHour={openHour}
					locale={locale}
					onOpenReservation={onOpenReservation}
				/>
			</div>
		</>
	);
}

/* ============================================================================
 * Section Group
 * ============================================================================ */

interface SectionGroupProps {
	readonly section: Doc<"sections">;
	readonly tables: Doc<"tables">[];
	readonly isCollapsed: boolean;
	readonly onToggle: () => void;
	readonly reservationsByTable: Map<string, Doc<"reservations">[]>;
	readonly locksByTable: Map<string, Doc<"tableLocks">[]>;
	readonly hours: number[];
	readonly hourCount: number;
	readonly openHour: number;
	readonly locale: string;
	readonly selectedDay: string;
	readonly onOpenReservation: (id: Id<"reservations">) => void;
	readonly onCreateReservation?: (intent: TimelineCreateIntent) => void;
}

function SectionGroup({
	section,
	tables,
	isCollapsed,
	onToggle,
	reservationsByTable,
	locksByTable,
	hours,
	hourCount,
	openHour,
	locale,
	selectedDay,
	onOpenReservation,
	onCreateReservation,
}: SectionGroupProps) {
	const { t } = useTranslation();
	const sectionName = section.name || "Other";

	return (
		<>
			{/* Section header spans full row */}
			<button
				type="button"
				onClick={onToggle}
				aria-label={t(ReservationsKeys.TIMELINE_SECTION_TOGGLE_ARIA, {
					section: sectionName,
				})}
				className="sticky left-0 z-10 bg-muted/80 border-b border-border px-3 py-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors col-span-full cursor-pointer"
				style={{ gridColumn: `1 / span ${hourCount + 1}` }}
			>
				{isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
				{sectionName}
				<span className="text-faint-foreground font-normal ml-1">
					({tables.length})
				</span>
			</button>

			{/* Table rows */}
			{!isCollapsed &&
				tables.map((table) => (
					<TableRow
						key={table._id}
						table={table}
						reservations={reservationsByTable.get(table._id as string) ?? []}
						locks={locksByTable.get(table._id as string) ?? []}
						hours={hours}
						hourCount={hourCount}
						openHour={openHour}
						locale={locale}
						selectedDay={selectedDay}
						onOpenReservation={onOpenReservation}
						onCreateReservation={onCreateReservation}
					/>
				))}
		</>
	);
}

/* ============================================================================
 * Table Row
 * ============================================================================ */

interface TableRowProps {
	readonly table: Doc<"tables">;
	readonly reservations: Doc<"reservations">[];
	readonly locks: Doc<"tableLocks">[];
	readonly hours: number[];
	readonly hourCount: number;
	readonly openHour: number;
	readonly locale: string;
	readonly selectedDay: string;
	readonly onOpenReservation: (id: Id<"reservations">) => void;
	readonly onCreateReservation?: (intent: TimelineCreateIntent) => void;
}

function TableRow({
	table,
	reservations,
	locks,
	hours,
	hourCount,
	openHour,
	locale,
	selectedDay,
	onOpenReservation,
	onCreateReservation,
}: TableRowProps) {
	const tableLabel = table.label || `#${table.tableNumber}`;

	return (
		<>
			<div
				role="rowheader"
				className="sticky left-0 z-10 bg-background border-b border-border px-3 py-2 flex items-center text-xs font-medium text-foreground truncate"
			>
				{tableLabel}
				{table.capacity != null && (
					<span className="ml-1.5 text-faint-foreground">
						({table.capacity})
					</span>
				)}
			</div>
			<div
				role="gridcell"
				className="border-b border-border bg-background relative"
				style={{ gridColumn: `2 / span ${hourCount}` }}
			>
				<TimelineRowContent
					reservations={reservations}
					locks={locks}
					hours={hours}
					hourCount={hourCount}
					openHour={openHour}
					locale={locale}
					selectedDay={selectedDay}
					onOpenReservation={onOpenReservation}
					tableId={table._id}
					tableLabel={tableLabel}
					onCreateReservation={onCreateReservation}
				/>
			</div>
		</>
	);
}

/* ============================================================================
 * Timeline Row Content (blocks positioned within)
 * ============================================================================ */

interface TimelineRowContentProps {
	readonly reservations: Doc<"reservations">[];
	readonly locks: Doc<"tableLocks">[];
	readonly hours: number[];
	readonly hourCount: number;
	readonly openHour: number;
	readonly locale: string;
	readonly selectedDay?: string;
	readonly onOpenReservation: (id: Id<"reservations">) => void;
	readonly tableId?: Id<"tables">;
	readonly tableLabel?: string;
	readonly onCreateReservation?: (intent: TimelineCreateIntent) => void;
}

function TimelineRowContent({
	reservations,
	locks,
	hours,
	hourCount,
	openHour,
	locale,
	selectedDay,
	onOpenReservation,
	tableId,
	tableLabel,
	onCreateReservation,
}: TimelineRowContentProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const totalMinutes = hourCount * 60;

	const getPosition = useCallback(
		(startsAt: number, endsAt: number) => {
			const startDate = new Date(startsAt);
			const startMinute = startDate.getHours() * 60 + startDate.getMinutes();
			const endDate = new Date(endsAt);
			const endMinute = endDate.getHours() * 60 + endDate.getMinutes();

			const baseMinute = openHour * 60;
			const leftMin = Math.max(0, startMinute - baseMinute);
			const rightMin = Math.min(totalMinutes, endMinute - baseMinute);
			const width = Math.max(rightMin - leftMin, 15);

			return {
				left: `${(leftMin / totalMinutes) * 100}%`,
				width: `${(width / totalMinutes) * 100}%`,
			};
		},
		[openHour, totalMinutes]
	);

	return (
		<div ref={containerRef} className="relative min-h-12">
			{/* Hour grid lines */}
			{hours.map((_, i) => (
				<div
					key={i}
					className="absolute top-0 bottom-0 border-l border-border/40"
					style={{ left: `${(i / hourCount) * 100}%` }}
				/>
			))}

			{/* Empty slot click handler (disabled for past days) */}
			{tableId && tableLabel && onCreateReservation && selectedDay && selectedDay >= todayLocalYmd() && (
				<EmptySlotClickArea
					containerRef={containerRef}
					openHour={openHour}
					totalMinutes={totalMinutes}
					tableId={tableId}
					tableLabel={tableLabel}
					selectedDay={selectedDay}
					onCreateReservation={onCreateReservation}
				/>
			)}

			{/* Lock blocks */}
			{locks.map((lock) => {
				const pos = getPosition(lock.startsAt, lock.endsAt);
				return (
					<TimelineLockBlock
						key={lock._id}
						lock={lock}
						style={pos}
					/>
				);
			})}

			{/* Reservation blocks */}
			{reservations.map((r) => {
				const pos = getPosition(r.startsAt, r.endsAt);
				return (
					<TimelineBlock
						key={r._id}
						reservation={r}
						style={pos}
						locale={locale}
						onClick={() => onOpenReservation(r._id)}
					/>
				);
			})}
		</div>
	);
}

/* ============================================================================
 * TimelineBlock (reservation)
 * ============================================================================ */

interface TimelineBlockProps {
	readonly reservation: Doc<"reservations">;
	readonly style: { left: string; width: string };
	readonly locale: string;
	readonly onClick: () => void;
}

function TimelineBlock({ reservation, style, locale, onClick }: TimelineBlockProps) {
	const { t } = useTranslation();
	const config = getReservationStatusConfig(reservation.status);
	const tone: StatusTone = config?.tone ?? RESERVATION_FALLBACK_TONE;
	const palette = getStatusToneStyle(tone);

	const startTime = formatTimeOnly(reservation.startsAt, locale);
	const endTime = formatTimeOnly(reservation.endsAt, locale);
	const sourceIcon = getSourceIcon(reservation.source);
	const isDimmed = reservation.status === "cancelled" || reservation.status === "no_show";

	const multiTableLabel =
		reservation.tableIds.length > 1
			? `T${reservation.tableIds.length}`
			: null;

	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={t(ReservationsKeys.TIMELINE_BLOCK_ARIA, {
				guest: reservation.contact.name,
				time: `${startTime}–${endTime}`,
			})}
			className={`absolute top-1 bottom-1 rounded px-1.5 py-0.5 flex items-center gap-1 overflow-hidden cursor-pointer border text-left transition-opacity hover:opacity-90 z-10${isDimmed ? " opacity-40" : ""}`}
			style={{
				left: style.left,
				width: style.width,
				backgroundColor: palette.tintedBg,
				borderColor: isDimmed ? "var(--border)" : palette.fg,
				color: palette.fg,
			}}
		>
			<span className={`truncate text-[10px] font-medium leading-tight${isDimmed ? " line-through" : ""}`}>
				{reservation.contact.name}
			</span>
			<span className="shrink-0 flex items-center gap-0.5 text-[9px] opacity-80">
				<Users size={9} />
				{reservation.partySize}
			</span>
			{sourceIcon && (
				<span className="shrink-0 opacity-60">{sourceIcon}</span>
			)}
			{multiTableLabel && (
				<span className="shrink-0 text-[8px] font-medium opacity-70 bg-black/10 dark:bg-white/10 rounded px-0.5">
					{multiTableLabel}
				</span>
			)}
		</button>
	);
}

function getSourceIcon(source: string): React.ReactNode {
	switch (source) {
		case "ui":
			return <Globe size={9} />;
		case "whatsapp":
			return <MessageCircle size={9} />;
		case "staff":
			return <UserPlus size={9} />;
		default:
			return null;
	}
}

/* ============================================================================
 * TimelineLockBlock
 * ============================================================================ */

interface TimelineLockBlockProps {
	readonly lock: Doc<"tableLocks">;
	readonly style: { left: string; width: string };
}

function TimelineLockBlock({ lock, style }: TimelineLockBlockProps) {
	const { t } = useTranslation();
	return (
		<div
			aria-label={t(ReservationsKeys.TIMELINE_LOCK_BLOCK_ARIA, {
				reason: lock.reason || "Locked",
			})}
			className="absolute top-1 bottom-1 rounded px-1.5 py-0.5 flex items-center overflow-hidden z-10 border border-dashed border-border bg-muted/60"
			style={{
				left: style.left,
				width: style.width,
				backgroundImage:
					"repeating-linear-gradient(135deg, transparent, transparent 3px, var(--border) 3px, var(--border) 4px)",
			}}
		>
			<span className="truncate text-[10px] text-muted-foreground font-medium">
				{lock.reason || "Locked"}
			</span>
		</div>
	);
}

/* ============================================================================
 * Empty Slot Click Area
 * ============================================================================ */

interface EmptySlotClickAreaProps {
	readonly containerRef: React.RefObject<HTMLDivElement | null>;
	readonly openHour: number;
	readonly totalMinutes: number;
	readonly tableId: Id<"tables">;
	readonly tableLabel: string;
	readonly selectedDay: string;
	readonly onCreateReservation: (intent: TimelineCreateIntent) => void;
}

function EmptySlotClickArea({
	containerRef,
	openHour,
	totalMinutes,
	tableId,
	tableLabel,
	selectedDay,
	onCreateReservation,
}: EmptySlotClickAreaProps) {
	const { t } = useTranslation();

	const handleClick = useCallback(
		(e: React.MouseEvent) => {
			const container = containerRef.current;
			if (!container) return;
			if ((e.target as HTMLElement).closest("button")) return;

			const rect = container.getBoundingClientRect();
			const x = e.clientX - rect.left;
			const ratio = x / rect.width;
			const minuteOffset = Math.round(ratio * totalMinutes);
			const snapped = Math.round(minuteOffset / 15) * 15;
			const clickedHour = Math.floor((openHour * 60 + snapped) / 60);
			const clickedMinute = (openHour * 60 + snapped) % 60;

			const baseDate = ymdToLocalDate(selectedDay);
			baseDate.setHours(clickedHour, clickedMinute, 0, 0);
			const startsAt = baseDate.getTime();

			onCreateReservation({ tableId, tableLabel, startsAt });
		},
		[containerRef, openHour, totalMinutes, tableId, tableLabel, selectedDay, onCreateReservation]
	);

	return (
		<div
			className="absolute inset-0 cursor-pointer z-0"
			onClick={handleClick}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					handleClick(e as unknown as React.MouseEvent);
				}
			}}
			aria-label={t(ReservationsKeys.TIMELINE_EMPTY_SLOT_ARIA)}
			role="button"
			tabIndex={-1}
		/>
	);
}
