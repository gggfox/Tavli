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
 * The component is purely presentational — it doesn't fetch data or own any
 * mutation; the parent route shapes shifts + members and passes callbacks.
 */
import { AdminStaffKeys } from "@/global/i18n";
import type { Id } from "convex/_generated/dataModel";
import { Plus } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
	addDaysToYmd,
	utcMsToYmdInTimezone,
} from "../timezone";
import { dayLabel } from "../roles";
import type { AssignableMember, ScheduledShiftView } from "../types";

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
	readonly children: (args: {
		readonly day: { ymd: string; index: number };
		readonly member: AssignableMember;
		readonly shifts: ScheduledShiftView[];
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

	return (
		<div className="overflow-x-auto rounded-lg border border-border">
			<div
				role="grid"
				className="min-w-[720px] grid"
				style={{ gridTemplateColumns: "minmax(160px, 1.2fr) repeat(7, minmax(120px, 1fr))" }}
			>
				<div
					role="columnheader"
					className="sticky left-0 z-10 bg-muted text-xs font-semibold text-faint-foreground px-3 py-2 border-b border-border"
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
							className="bg-muted text-xs font-semibold text-faint-foreground px-3 py-2 border-b border-l border-border"
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
						shiftsByMemberAndDay={shiftsByMemberAndDay}
						onCreateShift={onCreateShift}
						onOpenMemberDrawer={onOpenMemberDrawer}
						renderCell={children}
					/>
				))}
			</div>
		</div>
	);
}

interface MemberRowProps {
	readonly member: AssignableMember;
	readonly days: ReadonlyArray<DayInfo>;
	readonly shiftsByMemberAndDay: Map<string, ScheduledShiftView[]>;
	readonly onCreateShift?: (memberId: string, ymd: string) => void;
	readonly onOpenMemberDrawer?: (memberId: Id<"restaurantMembers">) => void;
	readonly renderCell: ScheduleWeekGridProps["children"];
}

function MemberRow({
	member,
	days,
	shiftsByMemberAndDay,
	onCreateShift,
	onOpenMemberDrawer,
	renderCell,
}: Readonly<MemberRowProps>) {
	const { t } = useTranslation();
	const label = member.email?.trim() ? member.email : member.userId;
	const labelMono = !member.email?.trim();
	const labelClasses = `text-xs font-medium truncate ${labelMono ? "font-mono" : ""}`;

	return (
		<>
			<div
				role="rowheader"
				className="sticky left-0 z-10 bg-background border-b border-border px-3 py-2 flex items-center min-w-0"
			>
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
				return (
					<div
						key={`${member.memberId}-${d.ymd}`}
						role="gridcell"
						className="border-b border-l border-border min-h-20 p-1.5 bg-background hover:bg-(--bg-hover) transition-colors"
					>
						<DayCellContent
							day={d}
							member={member}
							label={label}
							cellShifts={cellShifts}
							onCreateShift={onCreateShift}
							renderCell={renderCell}
						/>
					</div>
				);
			})}
		</>
	);
}

interface DayCellContentProps {
	readonly day: DayInfo;
	readonly member: AssignableMember;
	readonly label: string;
	readonly cellShifts: ScheduledShiftView[];
	readonly onCreateShift?: (memberId: string, ymd: string) => void;
	readonly renderCell: ScheduleWeekGridProps["children"];
}

function DayCellContent({
	day,
	member,
	label,
	cellShifts,
	onCreateShift,
	renderCell,
}: Readonly<DayCellContentProps>) {
	const { t } = useTranslation();

	if (cellShifts.length > 0) {
		return (
			<div className="flex flex-col gap-1">
				{renderCell({ day, member, shifts: cellShifts })}
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
