import { useTimelineData } from "@/features/reservations/hooks/useTimelineData";
import { useTimelineNow } from "@/features/reservations/hooks/useTimelineNow";
import {
	getReservationStatusConfig,
	RESERVATION_FALLBACK_TONE,
} from "@/features/reservations/statusConfig";
import type { ReservationRange } from "@/features/reservations/utils";
import { formatTimeOnly } from "@/features/reservations/utils";
import {
	clampStartsAtToHorizon,
	getTimelineMarkers,
	minuteOffsetToStartsAt,
	pointerRatioToSnappedMinute,
	pointerXToStartsAt,
} from "@/features/reservations/utils/timelineCoordinates";
import { useRestaurant } from "@/features/restaurants";
import { getStatusToneStyle, type StatusTone } from "@/global/components";
import { ReservationsKeys } from "@/global/i18n";
import { todayLocalYmd } from "@/global/utils/calendarMonth";
import {
	closestCenter,
	DndContext,
	DragOverlay,
	PointerSensor,
	useDraggable,
	useDroppable,
	useSensor,
	useSensors,
	type DragEndEvent,
	type DragStartEvent,
} from "@dnd-kit/core";
import type { Doc, Id } from "convex/_generated/dataModel";
import {
	ChevronDown,
	ChevronRight,
	Globe,
	GripVertical,
	MessageCircle,
	UserPlus,
	Users,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { TimelineReopenConfirmDialog } from "./TimelineReopenConfirmDialog";

const RESERVATION_DRAG_PREFIX = "reservation-drag";
const ROW_PREFIX = "row";
const UNASSIGNED_ROW_KEY = "unassigned";
const TERMINAL_RECOVERABLE_STATUSES = new Set(["cancelled", "no_show"]);

export interface TimelineRescheduleIntent {
	readonly reservationId: Id<"reservations">;
	readonly startsAt?: number;
	readonly endsAt?: number;
	readonly tableIds?: Id<"tables">[];
	readonly fromTableId?: Id<"tables">;
	readonly toTableId?: Id<"tables"> | null;
	readonly reopen?: boolean;
}

interface PendingReopenIntent {
	readonly intent: TimelineRescheduleIntent;
	readonly guestName: string;
}

function makeDragId(
	reservationId: Id<"reservations">,
	fromTableKey: Id<"tables"> | typeof UNASSIGNED_ROW_KEY
) {
	return `${RESERVATION_DRAG_PREFIX}:${reservationId}:from:${fromTableKey}`;
}

function parseDragId(
	id: string
): { reservationId: Id<"reservations">; fromTableId?: Id<"tables"> } | null {
	const match = id.match(/^reservation-drag:([^:]+):from:(.+)$/);
	if (!match) return null;
	const fromKey = match[2]!;
	return {
		reservationId: match[1] as Id<"reservations">,
		...(fromKey !== UNASSIGNED_ROW_KEY ? { fromTableId: fromKey as Id<"tables"> } : {}),
	};
}

function makeRowDropId(tableKey: Id<"tables"> | typeof UNASSIGNED_ROW_KEY) {
	return `${ROW_PREFIX}:${tableKey}`;
}

function parseRowDropId(id: string): { toTableId: Id<"tables"> | null } | null {
	const match = id.match(/^row:(.+)$/);
	if (!match) return null;
	const key = match[1]!;
	return { toTableId: key === UNASSIGNED_ROW_KEY ? null : (key as Id<"tables">) };
}

function isReservationDraggable(status: string, selectedDay: string): boolean {
	if (selectedDay < todayLocalYmd()) return false;
	if (status === "completed") return false;
	return true;
}

function isTerminalRecoverable(status: string): boolean {
	return TERMINAL_RECOVERABLE_STATUSES.has(status);
}

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
	readonly onReschedule?: (intent: TimelineRescheduleIntent) => void | Promise<void>;
}

export function ReservationTimeline({
	restaurantIds,
	range,
	customDay,
	selectedDay,
	onOpenReservation,
	onCreateReservation,
	onReschedule,
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
		minAdvanceMinutes,
		isLoading,
	} = useTimelineData(restaurantId, restaurant, range, customDay);

	const timelineMarkersEnabled = selectedDay <= todayLocalYmd();
	const nowMs = useTimelineNow(timelineMarkersEnabled);

	const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
	const [activeDragReservation, setActiveDragReservation] = useState<Doc<"reservations"> | null>(
		null
	);
	const [pendingReopen, setPendingReopen] = useState<PendingReopenIntent | null>(null);
	const [reopenConfirmBusy, setReopenConfirmBusy] = useState(false);
	const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
	const skipNextClickRef = useRef(false);
	const { t, i18n } = useTranslation();

	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

	const registerRowRef = useCallback((rowDropId: string, el: HTMLDivElement | null) => {
		if (el) rowRefs.current.set(rowDropId, el);
		else rowRefs.current.delete(rowDropId);
	}, []);

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
	const totalMinutes = hourCount * 60;

	const { blockedRatio, nowRatio } = useMemo(
		() =>
			getTimelineMarkers({
				selectedDay,
				openHour,
				totalMinutes,
				nowMs,
				minAdvanceMinutes,
			}),
		[selectedDay, openHour, totalMinutes, nowMs, minAdvanceMinutes]
	);

	const handleDragStart = useCallback((event: DragStartEvent) => {
		const reservation = event.active.data.current?.reservation as Doc<"reservations"> | undefined;
		if (reservation) setActiveDragReservation(reservation);
	}, []);

	const handleDragEnd = useCallback(
		(event: DragEndEvent) => {
			setActiveDragReservation(null);
			const { active, over } = event;
			if (!over || !onReschedule) return;

			const parsed = parseDragId(String(active.id));
			const rowParsed = parseRowDropId(String(over.id));
			if (!parsed || !rowParsed) return;

			const reservation = active.data.current?.reservation as Doc<"reservations"> | undefined;
			if (!reservation) return;

			const rowEl = rowRefs.current.get(String(over.id));
			if (!rowEl) return;

			const translated = active.rect.current.translated;
			if (!translated) return;

			const centerX = translated.left + translated.width / 2;
			const rawStartsAt = pointerXToStartsAt(
				centerX,
				rowEl.getBoundingClientRect(),
				openHour,
				totalMinutes,
				selectedDay
			);
			const newStartsAt = clampStartsAtToHorizon(
				rawStartsAt,
				selectedDay,
				openHour,
				minAdvanceMinutes,
				nowMs
			);

			const { fromTableId } = parsed;
			const { toTableId } = rowParsed;

			const timeChanged = newStartsAt !== reservation.startsAt;
			const tableChanged =
				(fromTableId !== undefined && toTableId !== fromTableId) ||
				(fromTableId === undefined && toTableId !== null) ||
				(fromTableId !== undefined && toTableId === null);

			if (!timeChanged && !tableChanged) return;

			skipNextClickRef.current = true;

			const intent: TimelineRescheduleIntent = {
				reservationId: parsed.reservationId,
				...(timeChanged ? { startsAt: newStartsAt } : {}),
				...(tableChanged
					? {
							...(fromTableId !== undefined ? { fromTableId } : {}),
							toTableId,
						}
					: {}),
			};

			if (isTerminalRecoverable(reservation.status)) {
				setPendingReopen({ intent, guestName: reservation.contact.name });
				return;
			}

			void onReschedule(intent);
		},
		[onReschedule, openHour, totalMinutes, selectedDay, minAdvanceMinutes, nowMs]
	);

	const handleReopenConfirm = useCallback(async () => {
		if (!pendingReopen || !onReschedule) return;
		setReopenConfirmBusy(true);
		try {
			await onReschedule({ ...pendingReopen.intent, reopen: true });
			setPendingReopen(null);
		} finally {
			setReopenConfirmBusy(false);
		}
	}, [pendingReopen, onReschedule]);

	const timelineCanDrag = Boolean(onReschedule) && selectedDay >= todayLocalYmd();

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

	const grid = (
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
					selectedDay={selectedDay}
					onOpenReservation={onOpenReservation}
					timelineCanDrag={timelineCanDrag}
					registerRowRef={registerRowRef}
					skipNextClickRef={skipNextClickRef}
					blockedRatio={blockedRatio}
					nowRatio={nowRatio}
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
						timelineCanDrag={timelineCanDrag}
						registerRowRef={registerRowRef}
						skipNextClickRef={skipNextClickRef}
						blockedRatio={blockedRatio}
						nowRatio={nowRatio}
					/>
				);
			})}
		</div>
	);

	return (
		<>
			<TimelineReopenConfirmDialog
				isOpen={pendingReopen !== null}
				guestName={pendingReopen?.guestName ?? ""}
				busy={reopenConfirmBusy}
				onClose={() => setPendingReopen(null)}
				onConfirm={() => void handleReopenConfirm()}
			/>
			<div className="overflow-x-auto rounded-lg border border-border">
				{timelineCanDrag ? (
					<DndContext
						sensors={sensors}
						collisionDetection={closestCenter}
						onDragStart={handleDragStart}
						onDragEnd={(e) => void handleDragEnd(e)}
						onDragCancel={() => setActiveDragReservation(null)}
					>
						{grid}
						<DragOverlay dropAnimation={null}>
							{activeDragReservation ? (
								<TimelineBlockOverlay reservation={activeDragReservation} locale={i18n.language} />
							) : null}
						</DragOverlay>
					</DndContext>
				) : (
					grid
				)}
			</div>
		</>
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
	readonly selectedDay: string;
	readonly onOpenReservation: (id: Id<"reservations">) => void;
	readonly timelineCanDrag: boolean;
	readonly registerRowRef: (rowDropId: string, el: HTMLDivElement | null) => void;
	readonly skipNextClickRef: React.RefObject<boolean>;
	readonly blockedRatio: number | null;
	readonly nowRatio: number | null;
}

function UnassignedRow({
	reservations,
	hours,
	hourCount,
	openHour,
	locale,
	selectedDay,
	onOpenReservation,
	timelineCanDrag,
	registerRowRef,
	skipNextClickRef,
	blockedRatio,
	nowRatio,
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
					selectedDay={selectedDay}
					onOpenReservation={onOpenReservation}
					rowDropId={makeRowDropId(UNASSIGNED_ROW_KEY)}
					fromTableKey={UNASSIGNED_ROW_KEY}
					timelineCanDrag={timelineCanDrag}
					registerRowRef={registerRowRef}
					skipNextClickRef={skipNextClickRef}
					blockedRatio={blockedRatio}
					nowRatio={nowRatio}
					nowLineAriaLabel={t(ReservationsKeys.TIMELINE_NOW_LINE_ARIA)}
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
	readonly timelineCanDrag: boolean;
	readonly registerRowRef: (rowDropId: string, el: HTMLDivElement | null) => void;
	readonly skipNextClickRef: React.RefObject<boolean>;
	readonly blockedRatio: number | null;
	readonly nowRatio: number | null;
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
	timelineCanDrag,
	registerRowRef,
	skipNextClickRef,
	blockedRatio,
	nowRatio,
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
				<span className="text-faint-foreground font-normal ml-1">({tables.length})</span>
			</button>

			{/* Table rows */}
			{!isCollapsed &&
				tables.map((table, rowIndex) => (
					<TableRow
						key={table._id}
						rowIndex={rowIndex}
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
						timelineCanDrag={timelineCanDrag}
						registerRowRef={registerRowRef}
						skipNextClickRef={skipNextClickRef}
						blockedRatio={blockedRatio}
						nowRatio={nowRatio}
					/>
				))}
		</>
	);
}

/* ============================================================================
 * Table Row
 * ============================================================================ */

function getTableRowSurfaceClasses(rowIndex: number): string {
	const zebra = rowIndex % 2 === 1 ? "bg-muted/20 dark:bg-muted/10" : "bg-background";
	return `${zebra} border-b border-border-strong`;
}

interface TableRowProps {
	readonly rowIndex: number;
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
	readonly timelineCanDrag: boolean;
	readonly registerRowRef: (rowDropId: string, el: HTMLDivElement | null) => void;
	readonly skipNextClickRef: React.RefObject<boolean>;
	readonly blockedRatio: number | null;
	readonly nowRatio: number | null;
}

function TableRow({
	rowIndex,
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
	timelineCanDrag,
	registerRowRef,
	skipNextClickRef,
	blockedRatio,
	nowRatio,
}: TableRowProps) {
	const tableLabel = table.label || `#${table.tableNumber}`;
	const { t } = useTranslation();
	const rowSurfaceClasses = getTableRowSurfaceClasses(rowIndex);

	return (
		<>
			<div
				role="rowheader"
				className={`sticky left-0 z-10 px-3 py-2 flex items-center text-xs font-medium text-foreground truncate ${rowSurfaceClasses}`}
			>
				{tableLabel}
				{table.capacity != null && (
					<span className="ml-1.5 text-faint-foreground">({table.capacity})</span>
				)}
			</div>
			<div
				role="gridcell"
				className={`relative ${rowSurfaceClasses}`}
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
					rowDropId={makeRowDropId(table._id)}
					fromTableKey={table._id}
					timelineCanDrag={timelineCanDrag}
					registerRowRef={registerRowRef}
					skipNextClickRef={skipNextClickRef}
					blockedRatio={blockedRatio}
					nowRatio={nowRatio}
					nowLineAriaLabel={t(ReservationsKeys.TIMELINE_NOW_LINE_ARIA)}
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
	readonly selectedDay: string;
	readonly onOpenReservation: (id: Id<"reservations">) => void;
	readonly rowDropId: string;
	readonly fromTableKey: Id<"tables"> | typeof UNASSIGNED_ROW_KEY;
	readonly timelineCanDrag: boolean;
	readonly registerRowRef: (rowDropId: string, el: HTMLDivElement | null) => void;
	readonly skipNextClickRef: React.RefObject<boolean>;
	readonly tableId?: Id<"tables">;
	readonly tableLabel?: string;
	readonly onCreateReservation?: (intent: TimelineCreateIntent) => void;
	readonly blockedRatio: number | null;
	readonly nowRatio: number | null;
	readonly nowLineAriaLabel: string;
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
	rowDropId,
	fromTableKey,
	timelineCanDrag,
	registerRowRef,
	skipNextClickRef,
	tableId,
	tableLabel,
	onCreateReservation,
	blockedRatio,
	nowRatio,
	nowLineAriaLabel,
}: TimelineRowContentProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const totalMinutes = hourCount * 60;

	const { setNodeRef, isOver } = useDroppable({ id: rowDropId, disabled: !timelineCanDrag });

	const mergeContainerRef = useCallback(
		(node: HTMLDivElement | null) => {
			containerRef.current = node;
			setNodeRef(node);
			registerRowRef(rowDropId, node);
		},
		[setNodeRef, registerRowRef, rowDropId]
	);

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
		<div
			ref={mergeContainerRef}
			className={`relative min-h-12${isOver && timelineCanDrag ? " ring-2 ring-inset ring-primary/40" : ""}`}
		>
			{/* Hour grid lines */}
			{hours.map((_, i) => (
				<div
					key={i}
					className="absolute top-1 bottom-1 border-l border-border/40"
					style={{ left: `${(i / hourCount) * 100}%` }}
				/>
			))}

			{blockedRatio !== null ? <TimelinePastOverlay blockedRatio={blockedRatio} /> : null}
			{nowRatio !== null ? <TimelineNowLine ratio={nowRatio} ariaLabel={nowLineAriaLabel} /> : null}

			{/* Empty slot click handler (disabled for past days) */}
			{tableId &&
				tableLabel &&
				onCreateReservation &&
				selectedDay &&
				selectedDay >= todayLocalYmd() && (
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
				return <TimelineLockBlock key={lock._id} lock={lock} style={pos} />;
			})}

			{/* Reservation blocks */}
			{reservations.map((r) => {
				const pos = getPosition(r.startsAt, r.endsAt);
				return (
					<DraggableTimelineBlock
						key={`${r._id}-${fromTableKey}`}
						reservation={r}
						style={pos}
						locale={locale}
						fromTableKey={fromTableKey}
						canDrag={timelineCanDrag && isReservationDraggable(r.status, selectedDay)}
						onOpen={() => {
							if (skipNextClickRef.current) {
								skipNextClickRef.current = false;
								return;
							}
							onOpenReservation(r._id);
						}}
					/>
				);
			})}
		</div>
	);
}

/* ============================================================================
 * Draggable timeline block (reservation)
 * ============================================================================ */

interface DraggableTimelineBlockProps {
	readonly reservation: Doc<"reservations">;
	readonly style: { left: string; width: string };
	readonly locale: string;
	readonly fromTableKey: Id<"tables"> | typeof UNASSIGNED_ROW_KEY;
	readonly canDrag: boolean;
	readonly onOpen: () => void;
}

function DraggableTimelineBlock({
	reservation,
	style,
	locale,
	fromTableKey,
	canDrag,
	onOpen,
}: DraggableTimelineBlockProps) {
	const dragId = makeDragId(reservation._id, fromTableKey);
	const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
		id: dragId,
		disabled: !canDrag,
		data: { reservation, fromTableKey },
	});

	return (
		<div
			ref={setNodeRef}
			className={`absolute top-1 bottom-1 z-10${isDragging ? " opacity-30" : ""}`}
			style={{ left: style.left, width: style.width }}
		>
			<TimelineBlockContent
				reservation={reservation}
				locale={locale}
				onClick={onOpen}
				dragHandleProps={canDrag ? { ...attributes, ...listeners } : undefined}
			/>
		</div>
	);
}

function TimelineBlockOverlay({
	reservation,
	locale,
}: {
	readonly reservation: Doc<"reservations">;
	readonly locale: string;
}) {
	return (
		<div className="w-32 opacity-90 shadow-lg">
			<TimelineBlockContent reservation={reservation} locale={locale} onClick={() => {}} />
		</div>
	);
}

interface TimelineBlockContentProps {
	readonly reservation: Doc<"reservations">;
	readonly locale: string;
	readonly onClick: () => void;
	readonly dragHandleProps?: Record<string, unknown>;
}

function TimelineBlockContent({
	reservation,
	locale,
	onClick,
	dragHandleProps,
}: TimelineBlockContentProps) {
	const { t } = useTranslation();
	const config = getReservationStatusConfig(reservation.status);
	const tone: StatusTone = config?.tone ?? RESERVATION_FALLBACK_TONE;
	const palette = getStatusToneStyle(tone);

	const startTime = formatTimeOnly(reservation.startsAt, locale);
	const endTime = formatTimeOnly(reservation.endsAt, locale);
	const sourceIcon = getSourceIcon(reservation.source);
	const isDimmed = reservation.status === "cancelled" || reservation.status === "no_show";

	const multiTableLabel =
		reservation.tableIds.length > 1 ? `T${reservation.tableIds.length}` : null;

	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={t(ReservationsKeys.TIMELINE_BLOCK_ARIA, {
				guest: reservation.contact.name,
				time: `${startTime}–${endTime}`,
			})}
			className={`h-full w-full rounded px-1.5 py-0.5 flex items-center gap-1 overflow-hidden cursor-pointer border text-left transition-opacity hover:opacity-90${isDimmed ? " opacity-40" : ""}`}
			style={{
				backgroundColor: palette.tintedBg,
				borderColor: isDimmed ? "var(--border)" : palette.fg,
				color: palette.fg,
			}}
		>
			{dragHandleProps && (
				<span
					{...dragHandleProps}
					className="shrink-0 cursor-grab active:cursor-grabbing touch-none text-faint-foreground"
					aria-label={t(ReservationsKeys.TIMELINE_DRAG_HANDLE_ARIA, {
						guest: reservation.contact.name,
					})}
					onClick={(e) => e.stopPropagation()}
				>
					<GripVertical size={10} />
				</span>
			)}
			<span
				className={`truncate text-[10px] font-medium leading-tight${isDimmed ? " line-through" : ""}`}
			>
				{reservation.contact.name}
			</span>
			<span className="shrink-0 flex items-center gap-0.5 text-[9px] opacity-80">
				<Users size={9} />
				{reservation.partySize}
			</span>
			{sourceIcon && <span className="shrink-0 opacity-60">{sourceIcon}</span>}
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
			className="timeline-lock-stripe absolute top-1 bottom-1 rounded px-1.5 py-0.5 flex items-center overflow-hidden z-10 border border-dashed border-border"
			style={{
				left: style.left,
				width: style.width,
			}}
		>
			<span className="truncate text-[10px] text-muted-foreground font-medium">
				{lock.reason || "Locked"}
			</span>
		</div>
	);
}

/* ============================================================================
 * Past-time overlay & now marker
 * ============================================================================ */

function TimelinePastOverlay({ blockedRatio }: { readonly blockedRatio: number }) {
	if (blockedRatio <= 0) return null;

	return (
		<div
			className="timeline-blocked-overlay absolute top-1 bottom-1 left-0 z-[1] rounded-sm pointer-events-none"
			style={{ width: `${blockedRatio * 100}%` }}
			aria-hidden
		/>
	);
}

function TimelineNowLine({
	ratio,
	ariaLabel,
}: {
	readonly ratio: number;
	readonly ariaLabel: string;
}) {
	return (
		<div
			className="absolute inset-y-0 z-[2] w-0.5 -translate-x-1/2 pointer-events-none bg-primary/70"
			style={{ left: `${ratio * 100}%` }}
			role="presentation"
			aria-label={ariaLabel}
		/>
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
			const ratio = (e.clientX - rect.left) / rect.width;
			const snapped = pointerRatioToSnappedMinute(ratio, totalMinutes);
			const startsAt = minuteOffsetToStartsAt(selectedDay, openHour, snapped);

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
