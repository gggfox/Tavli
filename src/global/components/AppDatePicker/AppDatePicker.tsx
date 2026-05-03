import { useClickOutside } from "@/global/hooks/useClickOutside";
import { useCalendarVariant } from "@/global/hooks/useCalendarVariant";
import { useEscapeKey } from "@/global/hooks/useEscapeKey";
import { KEY } from "@/global/utils/keyboard";
import {
	addMonths,
	buildMonthGrid,
	getWeekStartsOnJsDay,
	isValidYmd,
	todayLocalYmd,
	ymdToLocalDate,
} from "@/global/utils/calendarMonth";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
	type KeyboardEvent,
	type RefObject,
} from "react";
import { FieldLabel } from "@/global/components/Form/FieldLabel";
import { formInputClasses, formInputStyle } from "@/global/components/Form/styles";

export interface AppDatePickerProps {
	readonly id: string;
	readonly label: string;
	/** Local calendar date as `YYYY-MM-DD`. */
	readonly value: string;
	readonly onChange: (ymd: string) => void;
	readonly description?: string;
	readonly disabled?: boolean;
	/** BCP 47 tag for weekday labels and display formatting. */
	readonly localeTag?: string;
	/**
	 * When true, shows month navigation + day grid inline (no popover).
	 * Always uses the custom grid, even on narrow viewports where the popover variant uses native `<input type="date">`.
	 */
	readonly embedded?: boolean;
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

const PAGE_UP = "PageUp";
const PAGE_DOWN = "PageDown";

const panelStyle: CSSProperties = {
	backgroundColor: "var(--bg-secondary)",
	border: "1px solid var(--border-default)",
	boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
};

interface CalendarGridBodyProps {
	readonly listId: string;
	/** When set, applied to the focusable `role="grid"` node (e.g. pairs with `<label htmlFor>`). */
	readonly gridHtmlId?: string;
	readonly monthTitle: string;
	readonly prevMonth: () => void;
	readonly nextMonth: () => void;
	readonly grid: ReturnType<typeof buildMonthGrid>;
	readonly weekdayLabels: readonly string[];
	readonly gridRef: RefObject<HTMLDivElement | null>;
	readonly focusedIdx: number;
	readonly setFocusedIdx: (idx: number | ((i: number) => number)) => void;
	readonly value: string;
	readonly onChange: (ymd: string) => void;
	readonly onGridKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
}

function CalendarGridBody({
	listId,
	gridHtmlId,
	monthTitle,
	prevMonth,
	nextMonth,
	grid,
	weekdayLabels,
	gridRef,
	focusedIdx,
	setFocusedIdx,
	value,
	onChange,
	onGridKeyDown,
}: CalendarGridBodyProps) {
	const rows = chunk7(grid);
	const activeDescendantId = `${listId}-cell-${focusedIdx}`;

	return (
		<>
			<div className="mb-2 flex items-center justify-between gap-2">
				<button
					type="button"
					tabIndex={-1}
					className="rounded p-1 hover:bg-muted"
					aria-label="Previous month"
					onClick={prevMonth}
				>
					<ChevronLeft size={18} />
				</button>
				<span className="text-sm font-medium">{monthTitle}</span>
				<button
					type="button"
					tabIndex={-1}
					className="rounded p-1 hover:bg-muted"
					aria-label="Next month"
					onClick={nextMonth}
				>
					<ChevronRight size={18} />
				</button>
			</div>
			<div
				ref={gridRef}
				{...(gridHtmlId != null ? { id: gridHtmlId } : {})}
				role="grid"
				tabIndex={0}
				aria-activedescendant={activeDescendantId}
				aria-readonly="true"
				title="Page Up / Page Down: change month"
				className="text-center text-xs outline-none focus:ring-2 focus:ring-(--btn-primary-bg) focus:ring-offset-2 focus:ring-offset-[var(--bg-secondary)]"
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
							const selected = isValidYmd(value) && cell.ymd === value;
							const focused = idx === focusedIdx;
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
										cell.inCurrentMonth ? "text-foreground" : "text-faint-foreground opacity-50",
										selected || focused ? "ring-2 ring-(--btn-primary-bg)" : "",
										selected ? "text-white" : "hover:bg-muted",
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
										onChange(cell.ymd);
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
					onChange(todayLocalYmd());
				}}
			>
				Today
			</button>
		</>
	);
}

export function AppDatePicker({
	id,
	label,
	value,
	onChange,
	description,
	disabled,
	localeTag = "en",
	embedded = false,
}: AppDatePickerProps) {
	const variant = useCalendarVariant();
	const listId = useId();
	const triggerRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const gridRef = useRef<HTMLDivElement>(null);
	const [open, setOpen] = useState(false);

	const weekStartsOn = useMemo(() => getWeekStartsOnJsDay(localeTag), [localeTag]);
	const weekdayLabels = useMemo(
		() => weekdayShortLabels(localeTag, weekStartsOn),
		[localeTag, weekStartsOn]
	);

	const initialView = useMemo(() => {
		if (isValidYmd(value)) {
			const d = ymdToLocalDate(value);
			return { year: d.getFullYear(), monthIndex: d.getMonth() };
		}
		const t = new Date();
		return { year: t.getFullYear(), monthIndex: t.getMonth() };
	}, [value]);

	const [viewYear, setViewYear] = useState(initialView.year);
	const [viewMonthIndex, setViewMonthIndex] = useState(initialView.monthIndex);

	useEffect(() => {
		if (embedded || !open) {
			setViewYear(initialView.year);
			setViewMonthIndex(initialView.monthIndex);
		}
	}, [embedded, open, initialView.year, initialView.monthIndex]);

	const grid = useMemo(
		() => buildMonthGrid(viewYear, viewMonthIndex, weekStartsOn),
		[viewYear, viewMonthIndex, weekStartsOn]
	);

	const valueIndex = useMemo(() => {
		if (!isValidYmd(value)) return 0;
		const i = grid.findIndex((c) => c.ymd === value);
		return i >= 0 ? i : 0;
	}, [grid, value]);

	const [focusedIdx, setFocusedIdx] = useState(valueIndex);

	useEffect(() => {
		if (open || embedded) setFocusedIdx(valueIndex);
	}, [open, embedded, valueIndex]);

	useEffect(() => {
		if (!open || embedded) return;
		const raf = requestAnimationFrame(() => {
			gridRef.current?.focus();
		});
		return () => cancelAnimationFrame(raf);
	}, [open, embedded]);

	const close = useCallback(() => setOpen(false), []);
	useClickOutside([triggerRef, panelRef], close, { enabled: open && !embedded });
	useEscapeKey(close, { enabled: open && !embedded });

	const monthTitle = useMemo(
		() =>
			new Intl.DateTimeFormat(localeTag, { month: "long", year: "numeric" }).format(
				new Date(viewYear, viewMonthIndex, 1)
			),
		[localeTag, viewYear, viewMonthIndex]
	);

	const displayValue = useMemo(() => {
		if (!isValidYmd(value)) return "—";
		return new Intl.DateTimeFormat(localeTag, {
			year: "numeric",
			month: "short",
			day: "numeric",
		}).format(ymdToLocalDate(value));
	}, [value, localeTag]);

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
		if (e.key === PAGE_UP) {
			e.preventDefault();
			prevMonth();
			return;
		}
		if (e.key === PAGE_DOWN) {
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
				onChange(cell.ymd);
				if (!embedded) {
					setOpen(false);
					triggerRef.current?.focus();
				}
			}
		}
	};

	if (!embedded && variant === "native") {
		return (
			<div className="flex flex-col gap-1 text-xs">
				<FieldLabel htmlFor={id} label={label} description={description} />
				<input
					id={id}
					type="date"
					disabled={disabled}
					value={isValidYmd(value) ? value : ""}
					onChange={(e) => {
						const v = e.target.value;
						if (v) onChange(v);
					}}
					className={formInputClasses}
					style={formInputStyle}
				/>
			</div>
		);
	}

	if (embedded) {
		return (
			<div className="flex flex-col gap-1 text-xs">
				<FieldLabel htmlFor={id} label={label} description={description} />
				<div className="rounded-lg p-3 text-foreground" style={panelStyle}>
					<CalendarGridBody
						listId={listId}
						gridHtmlId={id}
						monthTitle={monthTitle}
						prevMonth={prevMonth}
						nextMonth={nextMonth}
						grid={grid}
						weekdayLabels={weekdayLabels}
						gridRef={gridRef}
						focusedIdx={focusedIdx}
						setFocusedIdx={setFocusedIdx}
						value={value}
						onChange={onChange}
						onGridKeyDown={onGridKeyDown}
					/>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-1 text-xs">
			<FieldLabel htmlFor={id} label={label} description={description} />
			<div className="relative">
				<button
					ref={triggerRef}
					id={id}
					type="button"
					disabled={disabled}
					aria-haspopup="dialog"
					aria-expanded={open}
					aria-controls={open ? listId : undefined}
					onClick={() => !disabled && setOpen((o) => !o)}
					className={`${formInputClasses} text-left`}
					style={formInputStyle}
				>
					{displayValue}
				</button>
				{open ? (
					<div
						ref={panelRef}
						id={listId}
						role="dialog"
						aria-label={label}
						className="absolute left-0 z-50 mt-1 w-[min(100vw-2rem,20rem)] rounded-lg p-3 text-foreground"
						style={panelStyle}
					>
						<CalendarGridBody
							listId={listId}
							monthTitle={monthTitle}
							prevMonth={prevMonth}
							nextMonth={nextMonth}
							grid={grid}
							weekdayLabels={weekdayLabels}
							gridRef={gridRef}
							focusedIdx={focusedIdx}
							setFocusedIdx={setFocusedIdx}
							value={value}
							onChange={(ymd) => {
								onChange(ymd);
								setOpen(false);
								triggerRef.current?.focus();
							}}
							onGridKeyDown={onGridKeyDown}
						/>
					</div>
				) : null}
			</div>
		</div>
	);
}
