import { useClickOutside } from "@/global/hooks/useClickOutside";
import { useAnchoredPopoverPosition } from "@/global/hooks/useAnchoredPopoverPosition";
import { useCalendarVariant } from "@/global/hooks/useCalendarVariant";
import { useEscapeKey } from "@/global/hooks/useEscapeKey";
import { KEY } from "@/global/utils/keyboard";
import {
	addDaysToYmd,
	resolveRestaurantTimezone,
	utcMsToYmdInTimezone,
} from "@/global/utils/timezone";
import {
	addMonths,
	buildMonthGrid,
	getWeekStartsOnJsDay,
	isValidYmd,
	ymdToLocalDate,
} from "@/global/utils/calendarMonth";
import { ReservationsKeys } from "@/global/i18n";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
	type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";

interface TimelineDayNavigatorProps {
	readonly selectedDay: string;
	readonly onDayChange: (ymd: string) => void;
	readonly locale: string;
	readonly timezone?: string;
}

function shiftDay(ymd: string, delta: number): string {
	return addDaysToYmd(ymd, delta);
}

function weekdayShortLabels(localeTag: string, weekStartsOnJs: number): string[] {
	const sunday = new Date(2017, 0, 1);
	const labels: string[] = [];
	const fmt = new Intl.DateTimeFormat(localeTag, { weekday: "short" });
	for (let c = 0; c < 7; c++) {
		const jsDay = (weekStartsOnJs + c) % 7;
		const d = new Date(sunday);
		d.setDate(sunday.getDate() + jsDay);
		labels.push(fmt.format(d));
	}
	return labels;
}

function chunk7<T>(arr: readonly T[]): T[][] {
	const rows: T[][] = [];
	for (let i = 0; i < arr.length; i += 7) {
		rows.push(arr.slice(i, i + 7) as T[]);
	}
	return rows;
}

function moveFocus(idx: number, key: string): number {
	switch (key) {
		case KEY.ArrowRight:
			return Math.min(41, idx + 1);
		case KEY.ArrowLeft:
			return Math.max(0, idx - 1);
		case KEY.ArrowDown:
			return Math.min(41, idx + 7);
		case KEY.ArrowUp:
			return Math.max(0, idx - 7);
		case KEY.Home:
			return Math.floor(idx / 7) * 7;
		case KEY.End:
			return Math.floor(idx / 7) * 7 + 6;
		default:
			return idx;
	}
}

export function TimelineDayNavigator({
	selectedDay,
	onDayChange,
	locale,
	timezone: timezoneProp,
}: TimelineDayNavigatorProps) {
	const { t } = useTranslation();
	const variant = useCalendarVariant();
	const timezone = resolveRestaurantTimezone(timezoneProp);
	const listId = useId();
	const triggerRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const gridRef = useRef<HTMLDivElement>(null);
	const nativeRef = useRef<HTMLInputElement>(null);
	const [open, setOpen] = useState(false);

	const today = utcMsToYmdInTimezone(Date.now(), timezone);
	const isToday = selectedDay === today;

	const displayLabel = useMemo(() => {
		if (!isValidYmd(selectedDay)) return "—";
		return new Intl.DateTimeFormat(locale, {
			weekday: "short",
			month: "long",
			day: "numeric",
			year: "numeric",
		}).format(ymdToLocalDate(selectedDay));
	}, [selectedDay, locale]);

	const weekStartsOn = useMemo(() => getWeekStartsOnJsDay(locale), [locale]);
	const weekdayLabels = useMemo(
		() => weekdayShortLabels(locale, weekStartsOn),
		[locale, weekStartsOn]
	);

	const initialView = useMemo(() => {
		if (isValidYmd(selectedDay)) {
			const d = ymdToLocalDate(selectedDay);
			return { year: d.getFullYear(), monthIndex: d.getMonth() };
		}
		const t = new Date();
		return { year: t.getFullYear(), monthIndex: t.getMonth() };
	}, [selectedDay]);

	const [viewYear, setViewYear] = useState(initialView.year);
	const [viewMonthIndex, setViewMonthIndex] = useState(initialView.monthIndex);

	useEffect(() => {
		if (!open) {
			setViewYear(initialView.year);
			setViewMonthIndex(initialView.monthIndex);
		}
	}, [open, initialView.year, initialView.monthIndex]);

	const grid = useMemo(
		() => buildMonthGrid(viewYear, viewMonthIndex, weekStartsOn),
		[viewYear, viewMonthIndex, weekStartsOn]
	);

	const valueIndex = useMemo(() => {
		if (!isValidYmd(selectedDay)) return 0;
		const i = grid.findIndex((c) => c.ymd === selectedDay);
		return i >= 0 ? i : 0;
	}, [grid, selectedDay]);

	const [focusedIdx, setFocusedIdx] = useState(valueIndex);

	useEffect(() => {
		if (open) setFocusedIdx(valueIndex);
	}, [open, valueIndex]);

	useEffect(() => {
		if (!open) return;
		const raf = requestAnimationFrame(() => {
			gridRef.current?.focus();
		});
		return () => cancelAnimationFrame(raf);
	}, [open]);

	const close = useCallback(() => setOpen(false), []);
	useClickOutside([triggerRef, panelRef], close, { enabled: open });
	useEscapeKey(close, { enabled: open });

	const monthTitle = useMemo(
		() =>
			new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(
				new Date(viewYear, viewMonthIndex, 1)
			),
		[locale, viewYear, viewMonthIndex]
	);

	const prevMonth = () => {
		const n = addMonths(viewYear, viewMonthIndex, -1);
		setViewYear(n.year);
		setViewMonthIndex(n.monthIndex);
	};

	const nextMonth = () => {
		const n = addMonths(viewYear, viewMonthIndex, 1);
		setViewYear(n.year);
		setViewMonthIndex(n.monthIndex);
	};

	const onGridKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		if (e.key === "PageUp") {
			e.preventDefault();
			prevMonth();
			return;
		}
		if (e.key === "PageDown") {
			e.preventDefault();
			nextMonth();
			return;
		}
		if (
			e.key === KEY.ArrowDown ||
			e.key === KEY.ArrowUp ||
			e.key === KEY.ArrowLeft ||
			e.key === KEY.ArrowRight ||
			e.key === KEY.Home ||
			e.key === KEY.End
		) {
			e.preventDefault();
			setFocusedIdx((i) => moveFocus(i, e.key));
			return;
		}
		if (e.key === KEY.Enter || e.key === KEY.Space) {
			e.preventDefault();
			const cell = grid[focusedIdx];
			if (cell) {
				onDayChange(cell.ymd);
				setOpen(false);
				triggerRef.current?.focus();
			}
		}
	};

	const handleDateClick = () => {
		if (variant === "native") {
			nativeRef.current?.showPicker?.();
			return;
		}
		setOpen((o) => !o);
	};

	const rows = chunk7(grid);
	const activeDescendantId = `${listId}-cell-${focusedIdx}`;

	const popoverPosition = useAnchoredPopoverPosition(triggerRef, panelRef, {
		open: open && variant === "custom",
		repositionKey: `${viewYear}-${viewMonthIndex}`,
	});

	return (
		<div className="flex items-center gap-1.5">
			<button
				type="button"
				onClick={() => onDayChange(shiftDay(selectedDay, -1))}
				aria-label={t(ReservationsKeys.TIMELINE_DAY_NAV_PREV)}
				className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
			>
				<ChevronLeft size={16} />
			</button>

			<div className="relative">
				<button
					ref={triggerRef}
					type="button"
					onClick={handleDateClick}
					aria-label={t(ReservationsKeys.TIMELINE_DAY_NAV_PICK_DATE_ARIA)}
					aria-haspopup="dialog"
					aria-expanded={open}
					aria-controls={open ? listId : undefined}
					className="rounded-md px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
				>
					{displayLabel}
				</button>

				{/* Native date input (hidden, for mobile) */}
				{variant === "native" && (
					<input
						ref={nativeRef}
						type="date"
						value={isValidYmd(selectedDay) ? selectedDay : ""}
						onChange={(e) => {
							if (e.target.value) onDayChange(e.target.value);
						}}
						className="absolute inset-0 opacity-0 pointer-events-none"
						tabIndex={-1}
					/>
				)}

				{/* Custom calendar popover */}
				{open && variant === "custom" && (
					<div
						ref={panelRef}
						id={listId}
						popover="manual"
						role="dialog"
						aria-label={t(ReservationsKeys.TIMELINE_DAY_NAV_PICK_DATE_ARIA)}
						className="w-[min(100vw-2rem,20rem)] rounded-lg p-3 text-foreground"
						style={{
							position: "fixed",
							top: popoverPosition?.top ?? -9999,
							left: popoverPosition?.left ?? -9999,
							margin: 0,
							visibility: popoverPosition === null ? "hidden" : "visible",
							backgroundColor: "var(--bg-secondary)",
							border: "1px solid var(--border-default)",
							boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
						}}
					>
						<div className="mb-2 flex items-center justify-between gap-2">
							<button
								type="button"
								tabIndex={-1}
								className="rounded p-1 hover:bg-muted"
								aria-label={t(ReservationsKeys.TIMELINE_DAY_NAV_PREV)}
								onClick={prevMonth}
							>
								<ChevronLeft size={18} />
							</button>
							<span className="text-sm font-medium">{monthTitle}</span>
							<button
								type="button"
								tabIndex={-1}
								className="rounded p-1 hover:bg-muted"
								aria-label={t(ReservationsKeys.TIMELINE_DAY_NAV_NEXT)}
								onClick={nextMonth}
							>
								<ChevronRight size={18} />
							</button>
						</div>
						<div
							ref={gridRef}
							role="grid"
							tabIndex={0}
							aria-activedescendant={activeDescendantId}
							aria-readonly="true"
							className="text-center text-xs outline-none focus:ring-2 focus:ring-(--btn-primary-bg) focus:ring-offset-2 focus:ring-offset-(--bg-secondary)"
							onKeyDown={onGridKeyDown}
						>
							<div role="row" className="mb-1 grid grid-cols-7 gap-0.5">
								{weekdayLabels.map((w) => (
									<div key={w} role="columnheader" className="text-faint-foreground font-medium">
										{w}
									</div>
								))}
							</div>
							{rows.map((row) => (
								<div key={row[0]?.ymd ?? "row"} role="row" className="grid grid-cols-7 gap-0.5">
									{row.map((cell) => {
										const idx = grid.indexOf(cell);
										const selected = isValidYmd(selectedDay) && cell.ymd === selectedDay;
										const focused = idx === focusedIdx;
										const isCellToday = cell.ymd === today;
										return (
											<button
												key={cell.ymd}
												type="button"
												role="gridcell"
												id={`${listId}-cell-${idx}`}
												tabIndex={-1}
												aria-selected={selected}
												className={[
													"aspect-square max-h-9 rounded text-sm transition-colors focus:outline-none",
													cell.inCurrentMonth
														? "text-foreground"
														: "text-faint-foreground opacity-50",
													selected || focused ? "ring-2 ring-(--btn-primary-bg)" : "",
													selected ? "text-white" : "hover:bg-muted",
													isCellToday && !selected ? "font-bold underline" : "",
												].join(" ")}
												style={
													selected
														? { backgroundColor: "var(--btn-primary-bg)" }
														: focused
															? { backgroundColor: "var(--bg-muted)" }
															: undefined
												}
												onMouseEnter={() => setFocusedIdx(idx)}
												onClick={() => {
													onDayChange(cell.ymd);
													setOpen(false);
													triggerRef.current?.focus();
												}}
											>
												{cell.dayOfMonth}
											</button>
										);
									})}
								</div>
							))}
						</div>
						<button
							type="button"
							className="mt-2 w-full rounded py-1.5 text-xs text-muted-foreground hover:bg-muted"
							onClick={() => {
								onDayChange(today);
								setOpen(false);
								triggerRef.current?.focus();
							}}
						>
							{t(ReservationsKeys.TIMELINE_DAY_NAV_TODAY)}
						</button>
					</div>
				)}
			</div>

			<button
				type="button"
				onClick={() => onDayChange(shiftDay(selectedDay, 1))}
				aria-label={t(ReservationsKeys.TIMELINE_DAY_NAV_NEXT)}
				className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
			>
				<ChevronRight size={16} />
			</button>

			{!isToday && (
				<button
					type="button"
					onClick={() => onDayChange(today)}
					className="ml-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
				>
					{t(ReservationsKeys.TIMELINE_DAY_NAV_TODAY)}
				</button>
			)}
		</div>
	);
}
