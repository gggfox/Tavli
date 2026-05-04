/**
 * Mobile-friendly fallback for the schedule view: a vertical list of days,
 * each with the shifts that occur on that day for the entire restaurant.
 *
 * Used in two places:
 *   - Manager schedule page when the viewport is narrow (the week-grid is
 *     hard to read on phones).
 *   - The user can also opt into it via the `Lista` view toggle.
 */
import { AdminStaffKeys } from "@/global/i18n";
import { Plus } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { addDaysToYmd, utcMsToYmdInTimezone } from "../timezone";
import { dayLabel } from "../roles";
import type { AssignableMember, ScheduledShiftView } from "../types";
import { ShiftCellChip } from "./ShiftCellChip";

interface ScheduleListViewProps {
	readonly members: readonly AssignableMember[];
	readonly shifts: readonly ScheduledShiftView[];
	readonly mondayYmd: string;
	readonly timezone: string;
	readonly localeTag: string;
	readonly onCreateShift: (memberId: string, ymd: string) => void;
	readonly onEditShift: (shift: ScheduledShiftView) => void;
}

export function ScheduleListView({
	shifts,
	mondayYmd,
	timezone,
	localeTag,
	onCreateShift,
	onEditShift,
	members,
}: Readonly<ScheduleListViewProps>) {
	const { t } = useTranslation();

	const days = useMemo(
		() =>
			Array.from({ length: 7 }, (_, i) => ({
				ymd: addDaysToYmd(mondayYmd, i),
				index: i,
			})),
		[mondayYmd]
	);

	const dateFormatter = useMemo(
		() =>
			new Intl.DateTimeFormat(localeTag, {
				month: "short",
				day: "numeric",
			}),
		[localeTag]
	);

	const shiftsByDay = useMemo(() => {
		const map = new Map<string, ScheduledShiftView[]>();
		for (const s of shifts) {
			const ymd = utcMsToYmdInTimezone(s.startsAt, timezone);
			const list = map.get(ymd);
			if (list) list.push(s);
			else map.set(ymd, [s]);
		}
		for (const list of map.values()) {
			list.sort((a, b) => a.startsAt - b.startsAt);
		}
		return map;
	}, [shifts, timezone]);

	const firstAssignableMember = members[0];
	const canQuickCreate = firstAssignableMember != null;

	return (
		<ul className="flex flex-col gap-3">
			{days.map((d) => {
				const list = shiftsByDay.get(d.ymd) ?? [];
				return (
					<li key={d.ymd} className="rounded-lg border border-border overflow-hidden">
						<div className="flex items-center justify-between bg-muted px-3 py-2 text-xs font-semibold text-faint-foreground">
							<span>
								{t(AdminStaffKeys.SCHEDULE_GRID_DAY_HEADER_FORMAT, {
									day: dayLabel(d.index, t),
									date: dateFormatter.format(new Date(`${d.ymd}T00:00:00Z`)),
								})}
							</span>
							{canQuickCreate ? (
								<button
									type="button"
									onClick={() => onCreateShift(String(firstAssignableMember.memberId), d.ymd)}
									className="text-xs text-foreground hover:underline flex items-center gap-1"
								>
									<Plus size={12} />
									{t(AdminStaffKeys.SCHEDULE_ASSIGN_SHIFT)}
								</button>
							) : null}
						</div>
						<div className="px-3 py-2">
							{list.length === 0 ? (
								<p className="text-xs text-faint-foreground">
									{t(AdminStaffKeys.SCHEDULE_LIST_DAY_EMPTY)}
								</p>
							) : (
								<div className="flex flex-col gap-1.5">
									{list.map((s) => (
										<ShiftMember key={s._id} shift={s} timezone={timezone} onEditShift={onEditShift} />
									))}
								</div>
							)}
						</div>
					</li>
				);
			})}
		</ul>
	);
}

interface ShiftMemberProps {
	readonly shift: ScheduledShiftView;
	readonly timezone: string;
	readonly onEditShift: (shift: ScheduledShiftView) => void;
}

function ShiftMember({ shift, timezone, onEditShift }: Readonly<ShiftMemberProps>) {
	const memberName = shift.member?.email?.trim()
		? shift.member.email
		: shift.member?.userId ?? "—";
	const memberMono = !shift.member?.email?.trim();
	return (
		<div className="grid grid-cols-[1fr_auto] gap-2 items-center">
			<span className={`text-xs ${memberMono ? "font-mono" : ""} truncate`}>{memberName}</span>
			<div className="min-w-[180px]">
				<ShiftCellChip
					shift={shift}
					timezone={timezone}
					compact
					onClick={() => onEditShift(shift)}
				/>
			</div>
		</div>
	);
}
