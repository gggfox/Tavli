/**
 * Schedule grid: rows = members, columns = Mon→Sun.
 *
 * Each cell shows the shifts assigned to that member on that day, rendered as
 * `ShiftCellChip`s. Empty cells are clickable and open the `ShiftDrawer`
 * pre-filled with `(memberId, ymd)`. The sticky left-column member row header
 * is also clickable when `onOpenMemberDrawer` is supplied — used by both
 * `/admin/schedule` — managers click any row, employees click their own
 * single row to open the attendance drawer.
 *
 * Pending day-off requests surface in two places when the parent passes the
 * absence maps: a yellow asterisk before the row label (member-level signal,
 * counts pending across all dates) and a `pending` `absenceState` flag on
 * cells whose ymd matches a pending absence (day-level signal that the
 * `renderCell` callback forwards to `ShiftCellChip`). Approved absences feed
 * the same callback with `approved` so the chip renders muted + struck.
 *
 * The component is purely presentational — it doesn't fetch data or own any
 * mutation; the parent route shapes shifts + members and passes callbacks.
 */
import { AdminStaffKeys } from "@/global/i18n";
import { useIsTabletViewport } from "@/global/hooks";
import type { Doc, Id } from "convex/_generated/dataModel";
import { Plus } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { addDaysToYmd, utcMsToYmdInTimezone } from "../timezone";
import { dayLabel } from "../roles";
import type { ChipAbsenceState } from "./ShiftCellChip";
import type { AssignableMember, ScheduledShiftView } from "../types";

export type AbsenceDateMap = ReadonlyMap<
	Id<"restaurantMembers">,
	ReadonlyMap<string, Doc<"absences">>
>;

interface ScheduleWeekGridProps {
	readonly members: readonly AssignableMember[];
	readonly shifts: readonly ScheduledShiftView[];
	readonly mondayYmd: string;
	readonly timezone: string;
	readonly localeTag: string;
	/**
	 * Optional click handler for empty day cells. When provided, empty cells
	 * render a dashed "+" button that opens the ShiftDrawer in create mode.
	 * Omit for read-only views (employees viewing their own schedule) where
	 * shift creation is not allowed.
	 */
	readonly onCreateShift?: (memberId: string, ymd: string) => void;
	readonly onEditShift?: (shift: ScheduledShiftView) => void;
	/**
	 * Click handler for the sticky left-column member row header. When provided,
	 * the row header becomes a button with an underline-on-hover affordance and
	 * opens an attendance drawer scoped to that member.
	 */
	readonly onOpenMemberDrawer?: (memberId: Id<"restaurantMembers">) => void;
	/**
	 * `(memberId → ymd → absence)` for absences in `pending` status. When the
	 * lookup hits, the cell's `absenceState` becomes `"pending"` and the
	 * `renderCell` callback is expected to forward that to `ShiftCellChip`.
	 */
	readonly pendingDatesByMember?: AbsenceDateMap;
	/** Same as `pendingDatesByMember` but for `approved` status. */
	readonly approvedDatesByMember?: AbsenceDateMap;
	/**
	 * Total number of pending absences per member across all dates. Drives the
	 * yellow asterisk on the row header. Pass an empty map (or omit) to hide
	 * the asterisk for every row.
	 */
	readonly pendingCountByMember?: ReadonlyMap<Id<"restaurantMembers">, number>;
	readonly children: (args: {
		readonly day: { ymd: string; index: number };
		readonly member: AssignableMember;
		readonly shifts: ScheduledShiftView[];
		readonly absenceState?: ChipAbsenceState;
	}) => React.ReactNode;
}

interface DayInfo {
	readonly ymd: string;
	readonly index: number;
}

export function ScheduleWeekGrid({
	members,
	shifts,
	mondayYmd,
	timezone,
	localeTag,
	onCreateShift,
	onEditShift: _onEditShift,
	onOpenMemberDrawer,
	pendingDatesByMember,
	approvedDatesByMember,
	pendingCountByMember,
	children,
}: Readonly<ScheduleWeekGridProps>) {
	const { t } = useTranslation();

	const days: ReadonlyArray<DayInfo> = useMemo(() => {
		return Array.from({ length: 7 }, (_, i) => ({
			ymd: addDaysToYmd(mondayYmd, i),
			index: i,
		}));
	}, [mondayYmd]);

	const dateFormatter = useMemo(
		() =>
			new Intl.DateTimeFormat(localeTag, {
				month: "short",
				day: "numeric",
			}),
		[localeTag]
	);

	const shiftsByMemberAndDay = useMemo(() => {
		const map = new Map<string, ScheduledShiftView[]>();
		for (const s of shifts) {
			const ymd = utcMsToYmdInTimezone(s.startsAt, timezone);
			const key = `${s.memberId}|${ymd}`;
			const list = map.get(key);
			if (list) list.push(s);
			else map.set(key, [s]);
		}
		for (const list of map.values()) {
			list.sort((a, b) => a.startsAt - b.startsAt);
		}
		return map;
	}, [shifts, timezone]);

	const isTablet = useIsTabletViewport();
	const gridTemplateColumns = isTablet
		? "minmax(72px, 0.9fr) repeat(7, minmax(52px, 1fr))"
		: "minmax(160px, 1.2fr) repeat(7, minmax(120px, 1fr))";
	const headerClass = isTablet
		? "bg-muted text-[10px] font-semibold text-faint-foreground px-1.5 py-1.5 border-b border-border"
		: "bg-muted text-xs font-semibold text-faint-foreground px-3 py-2 border-b border-border";

	return (
		<div className="overflow-x-auto rounded-lg border border-border">
			<div
				role="grid"
				className={isTablet ? "min-w-0 grid" : "min-w-[720px] grid"}
				style={{ gridTemplateColumns }}
			>
				<div
					role="columnheader"
					className={`sticky left-0 z-10 border-b border-border ${headerClass}`}
				>
					{t(AdminStaffKeys.SCHEDULE_COL_MEMBER)}
				</div>
				{days.map((d) => {
					const date = new Date(`${d.ymd}T00:00:00Z`);
					const dateStr = dateFormatter.format(date);
					return (
						<div
							key={d.ymd}
							role="columnheader"
							className={`border-l border-border ${headerClass}`}
						>
							{t(AdminStaffKeys.SCHEDULE_GRID_DAY_HEADER_FORMAT, {
								day: dayLabel(d.index, t),
								date: dateStr,
							})}
						</div>
					);
				})}

				{members.map((m) => (
					<MemberRow
						key={m.memberId}
						member={m}
						days={days}
						isTablet={isTablet}
						shiftsByMemberAndDay={shiftsByMemberAndDay}
						onCreateShift={onCreateShift}
						onOpenMemberDrawer={onOpenMemberDrawer}
						renderCell={children}
						pendingDatesForMember={pendingDatesByMember?.get(m.memberId)}
						approvedDatesForMember={approvedDatesByMember?.get(m.memberId)}
						pendingCount={pendingCountByMember?.get(m.memberId) ?? 0}
					/>
				))}
			</div>
		</div>
	);
}

interface MemberRowProps {
	readonly member: AssignableMember;
	readonly days: ReadonlyArray<DayInfo>;
	readonly isTablet: boolean;
	readonly shiftsByMemberAndDay: Map<string, ScheduledShiftView[]>;
	readonly onCreateShift?: (memberId: string, ymd: string) => void;
	readonly onOpenMemberDrawer?: (memberId: Id<"restaurantMembers">) => void;
	readonly renderCell: ScheduleWeekGridProps["children"];
	readonly pendingDatesForMember?: ReadonlyMap<string, Doc<"absences">>;
	readonly approvedDatesForMember?: ReadonlyMap<string, Doc<"absences">>;
	readonly pendingCount: number;
}

function MemberRow({
	member,
	days,
	isTablet,
	shiftsByMemberAndDay,
	onCreateShift,
	onOpenMemberDrawer,
	renderCell,
	pendingDatesForMember,
	approvedDatesForMember,
	pendingCount,
}: Readonly<MemberRowProps>) {
	const { t } = useTranslation();
	const label = member.displayName || "—";
	const initials = (member.displayName.charAt(0) || "?").toUpperCase();
	const labelClasses = "text-xs font-medium truncate";
	const rowHeaderPadding = isTablet ? "px-1.5 py-1.5" : "px-3 py-2";
	const cellPadding = isTablet ? "p-1" : "p-1.5";
	const asterisk =
		pendingCount > 0 ? (
			<span
				aria-label={t(AdminStaffKeys.SCHEDULE_GRID_PENDING_ASTERISK_ARIA, {
					count: pendingCount,
				})}
				className="text-yellow-600 dark:text-yellow-400 mr-1 select-none"
			>
				*
			</span>
		) : null;

	return (
		<>
			<div
				role="rowheader"
				className={`sticky left-0 z-10 bg-background border-b border-border flex items-center min-w-0 ${rowHeaderPadding}`}
			>
				{asterisk}
				{member.photoUrl ? (
					<img
						src={member.photoUrl}
						alt=""
						className="w-5 h-5 rounded-full object-cover shrink-0 mr-1.5"
					/>
				) : (
					<span className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[9px] font-medium text-muted-foreground shrink-0 mr-1.5">
						{initials}
					</span>
				)}
				{onOpenMemberDrawer ? (
					<button
						type="button"
						onClick={() => onOpenMemberDrawer(member.memberId)}
						aria-label={t(AdminStaffKeys.ATTENDANCE_MEMBER_ROW_OPEN_ARIA, { member: label })}
						className={`${labelClasses} text-left underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none cursor-pointer bg-transparent border-0 p-0`}
					>
						{label}
					</button>
				) : (
					<span className={labelClasses}>{label}</span>
				)}
			</div>
			{days.map((d) => {
				const cellShifts = shiftsByMemberAndDay.get(`${member.memberId}|${d.ymd}`) ?? [];
				const absenceState = absenceStateForDay(
					d.ymd,
					pendingDatesForMember,
					approvedDatesForMember
				);
				return (
					<div
						key={`${member.memberId}-${d.ymd}`}
						role="gridcell"
						className={`border-b border-l border-border min-h-20 bg-background hover:bg-(--bg-hover) transition-colors ${cellPadding}`}
					>
						<DayCellContent
							day={d}
							member={member}
							label={label}
							cellShifts={cellShifts}
							onCreateShift={onCreateShift}
							renderCell={renderCell}
							absenceState={absenceState}
						/>
					</div>
				);
			})}
		</>
	);
}

function absenceStateForDay(
	ymd: string,
	pendingDatesForMember: ReadonlyMap<string, Doc<"absences">> | undefined,
	approvedDatesForMember: ReadonlyMap<string, Doc<"absences">> | undefined
): ChipAbsenceState | undefined {
	if (pendingDatesForMember?.has(ymd)) return "pending";
	if (approvedDatesForMember?.has(ymd)) return "approved";
	return undefined;
}

interface DayCellContentProps {
	readonly day: DayInfo;
	readonly member: AssignableMember;
	readonly label: string;
	readonly cellShifts: ScheduledShiftView[];
	readonly onCreateShift?: (memberId: string, ymd: string) => void;
	readonly renderCell: ScheduleWeekGridProps["children"];
	readonly absenceState?: ChipAbsenceState;
}

function DayCellContent({
	day,
	member,
	label,
	cellShifts,
	onCreateShift,
	renderCell,
	absenceState,
}: Readonly<DayCellContentProps>) {
	const { t } = useTranslation();

	if (cellShifts.length > 0) {
		return (
			<div className="flex flex-col gap-1">
				{renderCell({ day, member, shifts: cellShifts, absenceState })}
			</div>
		);
	}
	if (!onCreateShift) return null;
	return (
		<button
			type="button"
			onClick={() => onCreateShift(String(member.memberId), day.ymd)}
			aria-label={t(AdminStaffKeys.SCHEDULE_GRID_ADD_SHIFT_ARIA, {
				member: label,
				date: day.ymd,
			})}
			className="w-full h-full min-h-16 flex items-center justify-center rounded border border-dashed border-border/60 text-faint-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
		>
			<Plus size={14} />
		</button>
	);
}
